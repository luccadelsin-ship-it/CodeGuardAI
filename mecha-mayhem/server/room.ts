/**
 * Authoritative match logic. The server owns positions, health, energy, heat,
 * cooldowns, hits and match results; clients only send inputs and fire intents.
 */
import { createArena, rayMech, type Arena, type ArenaLayout } from '../src/shared/arena.ts';
import { isPalette, type MechPalette } from '../src/shared/palette.ts';
import { MODE_RULES, type ClientMessage, type InputFrame, type MatchPhase, type MissileSnap, type OnlineMode, type PlayerInfo, type PlayerSnap, type ServerMessage } from '../src/shared/protocol.ts';
import { aimOrigin, applyShotCost, createMechState, damageTaken, MOVE, stepMech, switchWeapon, type MechState } from '../src/shared/sim.ts';
import { WEAPONS, damageAtDistance, isWeaponId, laserDamage, laserEnergy, spreadDirections, type WeaponId } from '../src/shared/weapons.ts';

type Vec = { x: number; y: number; z: number };

export interface Connection {
  send(message: ServerMessage): void;
  close(): void;
}

interface Player {
  id: number;
  conn: Connection;
  name: string;
  palette: MechPalette;
  state: MechState;
  alive: boolean;
  respawnAt: number;
  kills: number;
  deaths: number;
  score: number;
  ping: number;
  inputs: InputFrame[];
  ack: number;
  budget: number;
  history: Array<{ t: number; x: number; y: number; z: number }>;
  charge: number;
  lastHitBy: number;
}

interface Missile { id: number; owner: number; pos: Vec; vel: Vec; target: number | null; ttl: number }

const now = () => performance.now() / 1000;
const len = (v: Vec) => Math.hypot(v.x, v.y, v.z);
const round = (v: number) => Math.round(v * 1000) / 1000;

let nextPlayerId = 1;
let nextMissileId = 1;

export class Room {
  readonly players = new Map<number, Player>();
  readonly arena: Arena;
  phase: MatchPhase = 'waiting';
  timer = 0;
  private missiles: Missile[] = [];

  readonly code: string;
  readonly mode: OnlineMode;
  readonly isPrivate: boolean;

  // Plain fields instead of parameter properties: Node runs this file with type stripping only.
  constructor(code: string, mode: OnlineMode, isPrivate: boolean, layout: ArenaLayout) {
    this.code = code;
    this.mode = mode;
    this.isPrivate = isPrivate;
    this.arena = createArena(layout);
  }

  get rules() { return MODE_RULES[this.mode]; }
  get full(): boolean { return this.players.size >= this.rules.maxPlayers; }
  get empty(): boolean { return this.players.size === 0; }

  private info(p: Player): PlayerInfo { return { id: p.id, name: p.name, palette: p.palette, weapon: p.state.weapon }; }

  private broadcast(message: ServerMessage, except?: number): void {
    for (const p of this.players.values()) if (p.id !== except) p.conn.send(message);
  }

  join(conn: Connection, name: string, palette: unknown, weapon: unknown): Player {
    const spawn = this.pickSpawn(-1);
    const player: Player = {
      id: nextPlayerId++, conn, name, palette: isPalette(palette) ? palette : 'arctic',
      state: createMechState(spawn.x, spawn.y, spawn.z, spawn.yaw, isWeaponId(weapon) ? weapon : 'mg'),
      alive: true, respawnAt: 0, kills: 0, deaths: 0, score: 0, ping: 0, inputs: [], ack: 0, budget: 0.1, history: [], charge: 0, lastHitBy: -1,
    };
    player.state.invulnerable = 1.5;
    this.players.set(player.id, player);
    conn.send({ t: 'welcome', id: player.id, room: this.code, mode: this.mode, private: this.isPrivate, players: [...this.players.values()].map((p) => this.info(p)), time: now() });
    conn.send({ t: 'spawn', id: player.id, x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw });
    conn.send({ t: 'phase', phase: this.phase, timer: this.timer });
    this.broadcast({ t: 'join', player: this.info(player) }, player.id);
    if (this.phase === 'waiting' && this.players.size >= 2) this.setPhase('countdown', 4);
    return player;
  }

  leave(id: number): void {
    if (!this.players.delete(id)) return;
    this.missiles = this.missiles.filter((m) => m.owner !== id);
    this.broadcast({ t: 'leave', id });
    if (this.players.size < 2 && this.phase === 'countdown') this.setPhase('waiting', 0);
    if (this.players.size < 2 && this.phase === 'playing') this.endMatch();
  }

  handle(id: number, message: ClientMessage): void {
    const p = this.players.get(id);
    if (!p) return;
    switch (message.t) {
      case 'input': {
        if (!Array.isArray(message.frames)) return;
        for (const f of message.frames.slice(0, 120)) {
          if (typeof f?.seq !== 'number' || f.seq <= p.ack || !Number.isFinite(f.dt)) continue;
          p.inputs.push({
            seq: f.seq, dt: Math.max(0, Math.min(0.05, f.dt)),
            mx: clampNum(f.mx, -1, 1), mz: clampNum(f.mz, -1, 1),
            yaw: Number.isFinite(f.yaw) ? f.yaw : p.state.yaw, pitch: Number.isFinite(f.pitch) ? f.pitch : p.state.pitch,
            sprint: !!f.sprint, jump: !!f.jump, dash: !!f.dash, shield: !!f.shield,
          });
        }
        if (p.inputs.length > 180) p.inputs.splice(0, p.inputs.length - 180);
        this.processInputs(p, 0);
        break;
      }
      case 'weapon':
        if (isWeaponId(message.weapon) && switchWeapon(p.state, message.weapon)) this.broadcast({ t: 'info', player: this.info(p) });
        break;
      case 'fire': this.fire(p, message); break;
      case 'impact': this.impact(p, message.rt); break;
      case 'charge': p.charge = clampNum(message.amount, 0, 1); break;
      case 'ping': p.conn.send({ t: 'pong', c: message.c, s: now() }); if (typeof message.p === 'number' && Number.isFinite(message.p)) p.ping = Math.round(Math.max(0, Math.min(9999, message.p))); break;
      default: break;
    }
  }

  /** Apply queued inputs within the player's real-time budget (anti speed-hack). */
  private processInputs(p: Player, addBudget: number): void {
    p.budget = Math.min(0.3, p.budget + addBudget);
    while (p.inputs.length && p.budget > -0.03) {
      const frame = p.inputs.shift()!;
      p.budget -= frame.dt;
      p.ack = frame.seq;
      if (!p.alive || this.phase === 'ended') continue;
      if (this.phase === 'countdown') { frame.mx = frame.mz = 0; frame.jump = frame.dash = frame.shield = false; }
      stepMech(p.state, frame, frame.dt, this.arena);
    }
  }

  private positionAt(p: Player, t: number): Vec {
    const h = p.history;
    if (!h.length) return { x: p.state.x, y: p.state.y, z: p.state.z };
    if (t >= h[h.length - 1].t) return h[h.length - 1];
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1], b = h[i];
      if (t >= a.t && t <= b.t) {
        const k = (t - a.t) / Math.max(1e-4, b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
      }
    }
    return h[0];
  }

  private canFight(): boolean { return this.phase === 'playing' || this.phase === 'waiting'; }

  private fire(p: Player, msg: Extract<ClientMessage, { t: 'fire' }>): void {
    if (!p.alive || !this.canFight() || !isWeaponId(msg.weapon)) return;
    const s = p.state;
    if (msg.weapon !== s.weapon) switchWeapon(s, msg.weapon);
    const def = WEAPONS[msg.weapon];
    if (s.fireCd > 0.08 || (def.kind !== 'charge' && s.overheated)) return;
    const charge = clampNum(msg.charge, 0, 1);
    if (def.kind === 'charge') {
      const cost = laserEnergy(charge);
      if (s.energy < cost * 0.6) return;
      s.energy = Math.max(0, s.energy - cost);
      s.energyDelay = MOVE.energyDelay;
      s.fireCd = def.interval;
      s.sinceShot = 0;
    } else applyShotCost(s, def);
    p.charge = 0;

    // Validate the origin against the authoritative mech and normalise the direction.
    const expected = aimOrigin(s);
    let o: Vec = Array.isArray(msg.o) ? { x: +msg.o[0], y: +msg.o[1], z: +msg.o[2] } : expected;
    if (![o.x, o.y, o.z].every(Number.isFinite) || len({ x: o.x - expected.x, y: o.y - expected.y, z: o.z - expected.z }) > 3.5) o = expected;
    const raw: Vec = Array.isArray(msg.d) ? { x: +msg.d[0], y: +msg.d[1], z: +msg.d[2] } : { x: 0, y: 0, z: 1 };
    const l = len(raw);
    if (!Number.isFinite(l) || l < 1e-6) return;
    const dir = { x: raw.x / l, y: raw.y / l, z: raw.z / l };
    const t = now();
    const rewind = Math.max(t - 0.35, Math.min(t, Number.isFinite(msg.rt) ? msg.rt : t));

    if (def.kind === 'projectile') {
      const lock = typeof msg.target === 'number' && this.players.get(msg.target)?.alive ? msg.target : null;
      this.missiles.push({ id: nextMissileId++, owner: p.id, pos: { x: o.x + dir.x, y: o.y + dir.y, z: o.z + dir.z }, vel: { x: dir.x * def.projectileSpeed, y: dir.y * def.projectileSpeed, z: dir.z * def.projectileSpeed }, target: lock, ttl: 6 });
      this.broadcast({ t: 'shot', id: p.id, weapon: def.id, o: [o.x, o.y, o.z], ends: [], charge: 1 }, p.id);
      return;
    }

    const dirs = def.pellets > 1 ? spreadDirections(dir, def.pellets, def.spread, msg.seed >>> 0) : [dir];
    const ends: Array<[number, number, number]> = [];
    const totals = new Map<number, { amount: number; crit: boolean; at: Vec; push: Vec }>();
    for (const d of dirs) {
      let limit = this.arena.raycastCover(o, d, def.range) ?? def.range;
      if (d.y < -0.01) { const deckT = (this.arena.deckY - o.y) / d.y; if (deckT > 0) limit = Math.min(limit, deckT); }
      const hits: Array<{ t: number; crit: boolean; victim: Player }> = [];
      for (const victim of this.players.values()) {
        if (victim.id === p.id || !victim.alive) continue;
        const base = this.positionAt(victim, rewind);
        const hit = rayMech(o, d, limit, base, 1);
        if (hit) hits.push({ t: hit.t, crit: hit.critical, victim });
      }
      hits.sort((a, b) => a.t - b.t);
      const applied = def.pierce ? hits : hits.slice(0, 1);
      const endT = !def.pierce && applied.length ? applied[0].t : limit;
      ends.push([round(o.x + d.x * endT), round(o.y + d.y * endT), round(o.z + d.z * endT)]);
      for (const h of applied) {
        const base = def.kind === 'charge' ? laserDamage(charge) : damageAtDistance(def, def.damage, h.t);
        const entry = totals.get(h.victim.id) ?? { amount: 0, crit: false, at: { x: o.x + d.x * h.t, y: o.y + d.y * h.t, z: o.z + d.z * h.t }, push: { x: 0, y: 0, z: 0 } };
        entry.amount += base * (h.crit ? 1.5 : 1);
        entry.crit ||= h.crit;
        entry.push.x += d.x * def.knockback / dirs.length * (def.pellets > 1 ? 3 : 1);
        entry.push.z += d.z * def.knockback / dirs.length * (def.pellets > 1 ? 3 : 1);
        totals.set(h.victim.id, entry);
      }
    }
    this.broadcast({ t: 'shot', id: p.id, weapon: def.id, o: [round(o.x), round(o.y), round(o.z)], ends, charge }, p.id);
    for (const [victimId, info] of totals) {
      const victim = this.players.get(victimId)!;
      victim.state.pushX += info.push.x;
      victim.state.pushZ += info.push.z;
      this.damage(victim, p, info.amount, info.crit, info.at, def.id);
    }
  }

  private impact(p: Player, rt: number): void {
    const s = p.state;
    if (!p.alive || !this.canFight() || s.impactCd > 0 || s.energy < MOVE.impactCost) return;
    s.impactCd = MOVE.impactCooldown;
    s.energy -= MOVE.impactCost;
    s.energyDelay = MOVE.energyDelay;
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    s.pushX += fx * 9;
    s.pushZ += fz * 9;
    this.broadcast({ t: 'impact', id: p.id }, p.id);
    const t = now();
    const rewind = Math.max(t - 0.35, Math.min(t, Number.isFinite(rt) ? rt : t));
    for (const victim of this.players.values()) {
      if (victim.id === p.id || !victim.alive) continue;
      const pos = this.positionAt(victim, rewind);
      const dx = pos.x - s.x, dz = pos.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > 4.4 || Math.abs(pos.y - s.y) > 2.5) continue;
      if ((dx * fx + dz * fz) / Math.max(0.01, d) < 0.35 && d > 1.5) continue;
      victim.state.pushX += (dx / Math.max(0.01, d)) * 8;
      victim.state.pushZ += (dz / Math.max(0.01, d)) * 8;
      this.damage(victim, p, 38, false, { x: pos.x, y: pos.y + 1.8, z: pos.z }, 'impact');
    }
  }

  private damage(victim: Player, attacker: Player | undefined, raw: number, crit: boolean, at: Vec, weapon: WeaponId | 'impact' | 'missile'): void {
    if (!victim.alive) return;
    const amount = damageTaken(victim.state, raw);
    if (amount <= 0) return;
    victim.state.health = Math.max(0, victim.state.health - amount);
    if (attacker) { attacker.score += Math.round(amount); victim.lastHitBy = attacker.id; }
    this.broadcast({ t: 'hit', target: victim.id, by: attacker?.id ?? -1, amount: Math.round(amount * 10) / 10, crit, hp: Math.round(victim.state.health), at: [round(at.x), round(at.y), round(at.z)] });
    if (victim.state.health > 0) return;
    victim.alive = false;
    victim.deaths++;
    victim.respawnAt = now() + 3;
    victim.inputs.length = 0;
    const killer = attacker && attacker.id !== victim.id ? attacker : undefined;
    if (killer) { killer.kills++; killer.score += 100; }
    this.broadcast({ t: 'kill', killer: killer?.id ?? victim.id, victim: victim.id, weapon });
    if (killer && this.phase === 'playing' && killer.kills >= this.rules.fragLimit) this.endMatch();
  }

  private explode(at: Vec, radius: number, damage: number, owner: number, direct?: Player): void {
    this.broadcast({ t: 'boom', x: round(at.x), y: round(at.y), z: round(at.z), r: radius });
    const attacker = this.players.get(owner);
    for (const victim of this.players.values()) {
      if (!victim.alive || victim.id === owner) continue;
      const c = { x: victim.state.x, y: victim.state.y + 1.6, z: victim.state.z };
      const d = len({ x: c.x - at.x, y: c.y - at.y, z: c.z - at.z });
      if (d > radius) continue;
      const falloff = 1 - d / radius;
      const blocked = !this.arena.lineOfSight({ x: at.x, y: at.y + 0.5, z: at.z }, c);
      let amount = damage * (0.35 + 0.65 * falloff) * (blocked ? 0.4 : 1);
      if (victim === direct) amount += WEAPONS.missile.damage;
      const k = 2.4 * falloff / Math.max(0.5, d);
      victim.state.pushX += (c.x - at.x) * k;
      victim.state.pushZ += (c.z - at.z) * k;
      this.damage(victim, attacker, amount, false, c, 'missile');
    }
  }

  private updateMissiles(dt: number): void {
    const def = WEAPONS.missile;
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.ttl -= dt;
      const target = m.target !== null ? this.players.get(m.target) : undefined;
      if (target?.alive) {
        const speed = len(m.vel);
        const want = { x: target.state.x - m.pos.x, y: target.state.y + 1.7 - m.pos.y, z: target.state.z - m.pos.z };
        const wl = len(want) || 1;
        const k = Math.min(1, dt * def.homing);
        m.vel = { x: m.vel.x + (want.x / wl * speed - m.vel.x) * k, y: m.vel.y + (want.y / wl * speed - m.vel.y) * k, z: m.vel.z + (want.z / wl * speed - m.vel.z) * k };
        const nl = len(m.vel) || 1;
        m.vel = { x: m.vel.x / nl * speed, y: m.vel.y / nl * speed, z: m.vel.z / nl * speed };
      }
      const step = { x: m.vel.x * dt, y: m.vel.y * dt, z: m.vel.z * dt };
      const sl = len(step);
      const dir = { x: step.x / sl, y: step.y / sl, z: step.z / sl };
      let hitT: number | null = this.arena.raycastCover(m.pos, dir, sl);
      let direct: Player | undefined;
      for (const victim of this.players.values()) {
        if (victim.id === m.owner || !victim.alive) continue;
        const hit = rayMech(m.pos, dir, hitT ?? sl, { x: victim.state.x, y: victim.state.y, z: victim.state.z }, 1);
        if (hit) { hitT = hit.t; direct = victim; }
      }
      const next = { x: m.pos.x + step.x, y: m.pos.y + step.y, z: m.pos.z + step.z };
      if (hitT === null && next.y < this.arena.deckY + 0.05 && this.arena.onDeck(next.x, next.z, 0)) hitT = sl;
      if (hitT !== null || m.ttl <= 0) {
        const at = hitT !== null ? { x: m.pos.x + dir.x * hitT, y: m.pos.y + dir.y * hitT, z: m.pos.z + dir.z * hitT } : m.pos;
        this.missiles.splice(i, 1);
        this.explode(at, def.splashRadius, def.splashDamage, m.owner, direct);
        continue;
      }
      m.pos = next;
    }
  }

  private pickSpawn(excludeId: number): { x: number; y: number; z: number; yaw: number } {
    const others = [...this.players.values()].filter((p) => p.id !== excludeId && p.alive);
    let best = this.arena.spawnPoints[0];
    let bestScore = -Infinity;
    for (const s of this.arena.spawnPoints) {
      if (!this.arena.canMoveTo(s.x, s.z, MOVE.radius)) continue;
      const nearest = others.reduce((min, o) => Math.min(min, Math.hypot(o.state.x - s.x, o.state.z - s.z)), 80);
      const score = nearest + Math.random() * 6;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return { x: best.x, y: this.arena.deckY, z: best.z, yaw: best.yaw };
  }

  private respawn(p: Player): void {
    const s = this.pickSpawn(p.id);
    p.state = createMechState(s.x, s.y, s.z, s.yaw, p.state.weapon);
    p.state.invulnerable = 1.5;
    p.alive = true;
    p.inputs.length = 0;
    p.history.length = 0;
    this.broadcast({ t: 'spawn', id: p.id, x: s.x, y: s.y, z: s.z, yaw: s.yaw });
  }

  private setPhase(phase: MatchPhase, timer: number, ranking?: Extract<ServerMessage, { t: 'phase' }>['ranking']): void {
    this.phase = phase;
    this.timer = timer;
    this.broadcast({ t: 'phase', phase, timer, ranking });
  }

  private ranking() {
    return [...this.players.values()]
      .map((p) => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, score: p.score }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.score - a.score);
  }

  private endMatch(): void {
    if (this.phase === 'ended') return;
    this.missiles.length = 0;
    this.setPhase('ended', 10, this.ranking());
  }

  private startMatch(): void {
    this.missiles.length = 0;
    for (const p of this.players.values()) { p.kills = p.deaths = p.score = 0; this.respawn(p); }
    this.setPhase('playing', this.rules.timeLimit);
  }

  tick(dt: number): void {
    const t = now();
    for (const p of this.players.values()) {
      this.processInputs(p, dt);
      if (!p.alive && t >= p.respawnAt && this.phase !== 'ended') this.respawn(p);
      p.history.push({ t, x: p.state.x, y: p.state.y, z: p.state.z });
      while (p.history.length && p.history[0].t < t - 1) p.history.shift();
    }
    this.updateMissiles(dt);
    if (this.phase === 'countdown') {
      this.timer -= dt;
      if (this.timer <= 0) this.startMatch();
    } else if (this.phase === 'playing') {
      this.timer -= dt;
      if (this.timer <= 0) this.endMatch();
    } else if (this.phase === 'ended') {
      this.timer -= dt;
      if (this.timer <= 0) {
        for (const p of this.players.values()) { p.kills = p.deaths = p.score = 0; }
        if (this.players.size >= 2) this.setPhase('countdown', 4); else this.setPhase('waiting', 0);
      }
    }
    this.snapshot(t);
  }

  private snapshot(t: number): void {
    const players: PlayerSnap[] = [...this.players.values()].map((p) => {
      const s = p.state;
      return {
        id: p.id, x: round(s.x), y: round(s.y), z: round(s.z), vx: round(s.vx), vy: round(s.vy), vz: round(s.vz),
        yaw: round(s.yaw), pitch: round(s.pitch), hp: Math.round(s.health), w: s.weapon, sh: s.shieldTime > 0, dash: s.dashTime > 0,
        jet: s.jetting, air: !s.grounded, alive: p.alive, inv: s.invulnerable > 0, charge: p.charge, kills: p.kills, deaths: p.deaths, score: p.score, ping: p.ping,
      };
    });
    const missiles: MissileSnap[] = this.missiles.map((m) => ({ id: m.id, x: round(m.pos.x), y: round(m.pos.y), z: round(m.pos.z), vx: round(m.vel.x), vy: round(m.vel.y), vz: round(m.vel.z) }));
    for (const p of this.players.values()) {
      p.conn.send({ t: 'snap', time: t, ack: p.ack, phase: this.phase, timer: Math.max(0, this.timer), me: p.alive ? p.state : null, players, missiles });
    }
  }
}

function clampNum(value: unknown, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : 0;
}
