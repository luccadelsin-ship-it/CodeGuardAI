/**
 * Server-side bot pilots. They drive the same MechInput as humans through the
 * shared simulation and fire through the same validated server path, so they get
 * no hidden advantages: aim has reaction time and error, movement obeys collision.
 */
import type { Arena } from '../src/shared/arena.ts';
import { aimOrigin, type MechInput, type MechState } from '../src/shared/sim.ts';
import type { WeaponId } from '../src/shared/weapons.ts';

type Vec = { x: number; z: number };

/** Waypoint graph built from the arena layout: centre ring, bridges and stations. */
export class BotNav {
  readonly nodes: Vec[] = [];
  readonly edges: number[][] = [];
  private readonly arena: Arena;

  constructor(arena: Arena) {
    this.arena = arena;
    const L = arena.layout;
    const c = L.centralArena;
    this.nodes.push({ x: c.x, z: c.z });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      this.nodes.push({ x: c.x + Math.cos(a) * c.radius * 0.72, z: c.z + Math.sin(a) * c.radius * 0.72 });
    }
    for (const b of L.bridges) {
      this.nodes.push({ x: b.x, z: b.z });
      const alongX = b.widthX > b.widthZ;
      const half = (alongX ? b.widthX : b.widthZ) * 0.38;
      this.nodes.push(alongX ? { x: b.x - half, z: b.z } : { x: b.x, z: b.z - half });
      this.nodes.push(alongX ? { x: b.x + half, z: b.z } : { x: b.x, z: b.z + half });
    }
    for (const s of L.stations) {
      this.nodes.push({ x: s.x, z: s.z });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        this.nodes.push({ x: s.x + Math.cos(a) * s.radius * 0.6, z: s.z + Math.sin(a) * s.radius * 0.6 });
      }
    }
    // Map-authored waypoints (open yards such as Ferro-Velho Titã).
    for (const p of L.navPoints ?? []) this.nodes.push({ x: p.x, z: p.z });
    // Keep only walkable nodes, then connect visible neighbours.
    for (let i = this.nodes.length - 1; i >= 0; i--) if (!arena.canMoveTo(this.nodes[i].x, this.nodes[i].z, 0.9)) this.nodes.splice(i, 1);
    for (let i = 0; i < this.nodes.length; i++) {
      this.edges.push([]);
      for (let j = 0; j < this.nodes.length; j++) {
        if (i === j) continue;
        const a = this.nodes[i], b = this.nodes[j];
        if (Math.hypot(a.x - b.x, a.z - b.z) < 14 && this.walkable(a, b)) this.edges[i].push(j);
      }
    }
  }

  walkable(a: Vec, b: Vec, radius = 0.85): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(d / 0.7));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!this.arena.canMoveTo(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, radius)) return false;
    }
    return true;
  }

  private nearest(p: Vec, visibleOnly: boolean): number {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const d = Math.hypot(this.nodes[i].x - p.x, this.nodes[i].z - p.z);
      if (d < bestD && (!visibleOnly || this.walkable(p, this.nodes[i]))) { bestD = d; best = i; }
    }
    return best >= 0 ? best : visibleOnly ? this.nearest(p, false) : 0;
  }

  /** Full waypoint path from `from` to `to` (excluding `from`). */
  path(from: Vec, to: Vec): Vec[] {
    if (this.walkable(from, to)) return [to];
    const start = this.nearest(from, true), goal = this.nearest(to, true);
    const dist = new Array(this.nodes.length).fill(Infinity);
    const prev = new Array<number>(this.nodes.length).fill(-1);
    const open = new Set([start]);
    dist[start] = 0;
    while (open.size) {
      let cur = -1;
      for (const n of open) if (cur < 0 || dist[n] < dist[cur]) cur = n;
      open.delete(cur);
      if (cur === goal) break;
      for (const n of this.edges[cur]) {
        const d = dist[cur] + Math.hypot(this.nodes[cur].x - this.nodes[n].x, this.nodes[cur].z - this.nodes[n].z);
        if (d < dist[n]) { dist[n] = d; prev[n] = cur; open.add(n); }
      }
    }
    const out: Vec[] = [to];
    let step = goal;
    while (step >= 0) { out.unshift(this.nodes[step]); if (step === start) break; step = prev[step]; }
    return out;
  }

  randomNode(): Vec { return this.nodes[Math.floor(Math.random() * this.nodes.length)] ?? { x: 0, z: 0 }; }
}

export interface BotTarget { id: number; state: MechState }

export interface BotContext {
  arena: Arena;
  nav: BotNav;
  time: number;
  enemies: BotTarget[];
  /** Core Control: where to stand, or null when not needed. */
  objective: Vec | null;
  spawns: Vec[];
}

export interface BotDecision { input: MechInput; fire: { weapon: WeaponId; o: [number, number, number]; d: [number, number, number]; charge: number } | null }

const PREFERRED_RANGE: Record<WeaponId, number> = { mg: 18, shotgun: 8, laser: 28, missile: 24, sword: 3, hammer: 3 };

export class BotBrain {
  private path: Vec[] = [];
  private repathAt = 0;
  private goal: Vec | null = null;
  private lastPos: Vec = { x: 0, z: 0 };
  private progressAt = 0;
  private stuck = 0;
  private jumpUntil = 0;
  private strafe = Math.random() < 0.5 ? -1 : 1;
  private strafeFlip = 0;
  private seenAt = -1;
  private targetId = -1;
  private nextFire = 0;
  private flankUntil = 0;
  private flankPoint: Vec | null = null;
  private lastKnown: Vec | null = null;
  /** Readable state for tests and debugging. */
  mode: 'advance' | 'fight' | 'flank' | 'retreat' | 'core' | 'hunt' = 'advance';
  stuckEvents = 0;

  decide(s: MechState, ctx: BotContext): BotDecision {
    const me: Vec = { x: s.x, z: s.z };
    const eye = { x: s.x, y: s.y + 2.4, z: s.z };
    // Target: nearest enemy in line of sight, otherwise the last one seen.
    let target: BotTarget | null = null;
    let targetDist = Infinity;
    for (const e of ctx.enemies) {
      const d = Math.hypot(e.state.x - s.x, e.state.z - s.z);
      if (d > 60) continue;
      const visible = ctx.arena.lineOfSight(eye, { x: e.state.x, y: e.state.y + 1.8, z: e.state.z });
      if (visible && d < targetDist) { target = e; targetDist = d; }
    }
    if (target) {
      if (target.id !== this.targetId) { this.targetId = target.id; this.seenAt = ctx.time; }
      this.lastKnown = { x: target.state.x, z: target.state.z };
    }
    const range = PREFERRED_RANGE[s.weapon] ?? 18;
    const hurt = s.health < 32;

    // Decide where to go.
    let goal: Vec | null = null;
    if (hurt && target && targetDist < 30) {
      this.mode = 'retreat';
      goal = ctx.spawns.reduce((best, p) => Math.hypot(p.x - target!.state.x, p.z - target!.state.z) > Math.hypot(best.x - target!.state.x, best.z - target!.state.z) ? p : best, ctx.spawns[0] ?? me);
    } else if (ctx.objective && (!target || targetDist > 14)) {
      this.mode = 'core';
      goal = ctx.objective;
    } else if (target) {
      if (ctx.time < this.flankUntil && this.flankPoint) { this.mode = 'flank'; goal = this.flankPoint; }
      else if (targetDist > range * 1.35) { this.mode = 'advance'; goal = { x: target.state.x, z: target.state.z }; }
      else {
        this.mode = 'fight';
        // Every few seconds, swing wide to a flank position at the preferred range.
        if (Math.random() < 0.006 && range > 6) {
          const base = Math.atan2(s.x - target.state.x, s.z - target.state.z) + this.strafe * 1.2;
          const p = { x: target.state.x + Math.sin(base) * range, z: target.state.z + Math.cos(base) * range };
          if (ctx.arena.canMoveTo(p.x, p.z, 1)) { this.flankPoint = p; this.flankUntil = ctx.time + 3.5; }
        }
      }
    } else if (this.lastKnown) { this.mode = 'hunt'; goal = this.lastKnown; if (Math.hypot(me.x - goal.x, me.z - goal.z) < 2) this.lastKnown = null; }
    else {
      // Nobody in sight: hunt the nearest enemy (bots know the arena, like a player reading the radar).
      const prey = ctx.enemies.reduce<BotTarget | null>((best, e) => !best || Math.hypot(e.state.x - s.x, e.state.z - s.z) < Math.hypot(best.state.x - s.x, best.state.z - s.z) ? e : best, null);
      this.mode = 'hunt';
      goal = prey ? { x: prey.state.x, z: prey.state.z } : this.goal && Math.hypot(me.x - this.goal.x, me.z - this.goal.z) > 2 ? this.goal : ctx.nav.randomNode();
      if (!prey) this.mode = 'advance';
    }

    // Follow the waypoint path.
    if (goal && (!this.goal || Math.hypot(goal.x - this.goal.x, goal.z - this.goal.z) > 2 || ctx.time > this.repathAt)) {
      this.goal = goal;
      this.path = ctx.nav.path(me, goal);
      this.repathAt = ctx.time + 1.2;
    }
    while (this.path.length > 1 && Math.hypot(this.path[0].x - me.x, this.path[0].z - me.z) < 1.6) this.path.shift();
    let wishX = 0, wishZ = 0;
    if (this.mode === 'fight' && target) {
      // Strafe around the target, keeping the preferred distance.
      if (ctx.time > this.strafeFlip) { this.strafe *= -1; this.strafeFlip = ctx.time + 1.2 + Math.random() * 1.8; }
      const tx = (target.state.x - s.x) / Math.max(0.1, targetDist), tz = (target.state.z - s.z) / Math.max(0.1, targetDist);
      const keep = targetDist > range ? 0.6 : targetDist < range * 0.6 ? -0.7 : 0;
      wishX = tz * this.strafe + tx * keep;
      wishZ = -tx * this.strafe + tz * keep;
    } else if (this.path.length && goal) {
      const wp = this.path[0];
      const d = Math.hypot(wp.x - me.x, wp.z - me.z);
      if (d > 0.4 || this.path.length > 1) { wishX = (wp.x - me.x) / Math.max(0.1, d); wishZ = (wp.z - me.z) / Math.max(0.1, d); }
    }
    // Steering: try angled feelers if the straight step is blocked.
    if (wishX || wishZ) {
      for (const a of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
        const c = Math.cos(a * this.strafe), sn = Math.sin(a * this.strafe);
        const x = wishX * c - wishZ * sn, z = wishX * sn + wishZ * c;
        if (ctx.arena.canMoveTo(s.x + x * 1.2, s.z + z * 1.2, 0.85, s.y)) { wishX = x; wishZ = z; break; }
      }
    }

    // Stuck detection: if barely moving while trying to, jump and pick a new route.
    if (ctx.time > this.progressAt) {
      const moved = Math.hypot(me.x - this.lastPos.x, me.z - this.lastPos.z);
      if ((wishX || wishZ) && moved < 0.5) {
        this.stuck++;
        this.stuckEvents++;
        this.jumpUntil = ctx.time + 0.45;
        this.strafe *= -1;
        this.path = ctx.nav.path(me, this.stuck > 2 ? ctx.nav.randomNode() : (goal ?? ctx.nav.randomNode()));
        this.repathAt = ctx.time + 2;
      } else this.stuck = 0;
      this.lastPos = me;
      this.progressAt = ctx.time + 1;
    }

    // Look at the target (or along the movement), convert the wish into local input.
    let yaw = s.yaw, pitch = 0.1;
    if (target) {
      const o = aimOrigin(s);
      yaw = Math.atan2(target.state.x - o.x, target.state.z - o.z);
      pitch = -Math.atan2(target.state.y + 1.7 - o.y, Math.max(1, targetDist));
    } else if (wishX || wishZ) yaw = Math.atan2(wishX, wishZ);
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const input: MechInput = {
      mx: wishX * cos - wishZ * sin,
      mz: wishX * sin + wishZ * cos,
      yaw, pitch,
      sprint: this.mode === 'retreat' || this.mode === 'advance' || this.mode === 'core',
      jump: ctx.time < this.jumpUntil,
      dash: this.mode === 'retreat' && s.dashCd <= 0 && Math.random() < 0.05,
      shield: hurt && s.shieldCd <= 0,
    };

    // Fire after a reaction delay, with aim error and modest lead.
    let fire: BotDecision['fire'] = null;
    if (target && targetDist < 55 && ctx.time - this.seenAt > 0.45 && ctx.time >= this.nextFire && s.fireCd <= 0 && !s.overheated && s.weapon !== 'sword' && s.weapon !== 'hammer') {
      const o = aimOrigin(s);
      const t = targetDist / 60;
      const err = 0.035 + Math.min(0.05, targetDist * 0.0012);
      const dx = target.state.x + target.state.vx * t * 0.5 - o.x + (Math.random() - 0.5) * err * targetDist * 2;
      const dy = target.state.y + 1.7 - o.y + (Math.random() - 0.5) * err * targetDist;
      const dz = target.state.z + target.state.vz * t * 0.5 - o.z + (Math.random() - 0.5) * err * targetDist * 2;
      fire = { weapon: s.weapon, o: [o.x, o.y, o.z], d: [dx, dy, dz], charge: 0.7 };
      // Short bursts with pauses so bots never laser-beam the player nonstop.
      this.nextFire = ctx.time + (s.weapon === 'mg' ? (Math.random() < 0.15 ? 0.9 : 0.12) : 0.2);
    }
    return { input, fire };
  }
}
