import { Vector3, type Scene } from '@babylonjs/core';
import { MODE_RULES, PROTOCOL_VERSION, type ClientMessage, type InputFrame, type MatchPhase, type OnlineMode, type PlayerInfo, type PlayerSnap, type ServerMessage } from '../shared/protocol';
import { stepMech, type FireCommand, type MechInput, type MechState } from '../shared/sim';
import { WEAPONS, type WeaponId } from '../shared/weapons';
import type { CombatGame, OnlineBridge, RemoteTarget, ResultInfo } from '../game/combat';
import { createMech, type MechPalette, type MechVisual } from '../game/mech';

const INTERP_DELAY = 0.1;
const now = () => performance.now() / 1000;

export interface OnlineOptions { url: string; name: string; palette: MechPalette; weapon: WeaponId; mode: OnlineMode; room?: string; create?: boolean }

export interface ScoreRow { id: number; name: string; kills: number; deaths: number; score: number; ping: number; me: boolean }

export interface OnlineCallbacks {
  onFeed?(text: string): void;
  onBanner?(title: string, subtitle: string): void;
  onScoreboard?(rows: ScoreRow[]): void;
  onStatus?(text: string): void;
  onClosed?(reason: string): void;
}

interface Remote {
  info: PlayerInfo;
  visual: MechVisual;
  buffer: Array<{ t: number; s: PlayerSnap }>;
  last?: PlayerSnap;
  position: Vector3;
  alive: boolean;
  hp: number;
}

export function defaultServerUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/online`;
}

/** Client side of the authoritative online mode: prediction, reconciliation and interpolation. */
export class OnlineSession implements OnlineBridge {
  myId = -1;
  room = '';
  mode: OnlineMode = 'ffa';
  isPrivate = false;
  phase: MatchPhase = 'waiting';
  timer = 0;
  ping = 0;
  private ws: WebSocket;
  private readonly remotes = new Map<number, Remote>();
  private readonly pending: InputFrame[] = [];
  private outbox: InputFrame[] = [];
  private seq = 0;
  private sendTimer = 0;
  private pingTimer = 0;
  private offset = 0;
  private offsetReady = false;
  private bestRtt = Infinity;
  private correction = Vector3.Zero();
  private alive = true;
  private closed = false;
  private names = new Map<number, string>();
  private scoreTimer = 0;
  private lastRows: ScoreRow[] = [];

  private constructor(private readonly game: CombatGame, private readonly scene: Scene, ws: WebSocket, private readonly callbacks: OnlineCallbacks) {
    this.ws = ws;
  }

  /** Connect, send hello and resolve once the server welcomes us. */
  static connect(game: CombatGame, scene: Scene, options: OnlineOptions, callbacks: OnlineCallbacks): Promise<OnlineSession> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try { ws = new WebSocket(options.url); } catch (error) { reject(error); return; }
      const session = new OnlineSession(game, scene, ws, callbacks);
      const timeout = window.setTimeout(() => { ws.close(); reject(new Error('Tempo esgotado ao conectar ao servidor.')); }, 8000);
      let welcomed = false;
      ws.addEventListener('open', () => {
        session.send({ t: 'hello', v: PROTOCOL_VERSION, name: options.name, palette: options.palette, weapon: options.weapon, mode: options.mode, room: options.room, create: options.create });
      });
      ws.addEventListener('message', (event) => {
        let message: ServerMessage;
        try { message = JSON.parse(String(event.data)) as ServerMessage; } catch { return; }
        if (!welcomed && message.t === 'welcome') {
          welcomed = true;
          window.clearTimeout(timeout);
          session.handle(message);
          resolve(session);
          return;
        }
        if (!welcomed && message.t === 'error') {
          window.clearTimeout(timeout);
          ws.close();
          reject(new Error(message.message));
          return;
        }
        session.handle(message);
      });
      ws.addEventListener('error', () => {
        if (!welcomed) { window.clearTimeout(timeout); reject(new Error('Servidor online indisponível. Rode "npm run dev" ou "npm start" (servidor incluído).')); }
      });
      ws.addEventListener('close', () => {
        if (!welcomed) { window.clearTimeout(timeout); reject(new Error('Conexão recusada pelo servidor.')); return; }
        if (!session.closed) { session.closed = true; session.callbacks.onClosed?.('Conexão com o servidor perdida.'); }
      });
    });
  }

  private send(message: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private serverNow(): number { return now() + this.offset; }

  // ------------------------------------------------------------ bridge API
  afterLocalStep(input: MechInput, dt: number): void {
    const frame: InputFrame = { ...input, seq: ++this.seq, dt };
    this.pending.push(frame);
    this.outbox.push(frame);
    if (this.pending.length > 240) this.pending.splice(0, this.pending.length - 240);
  }

  fire(cmd: FireCommand, origin: Vector3, dir: Vector3, seed: number, target?: number): void {
    this.flushInputs();
    this.send({ t: 'fire', weapon: cmd.weapon, o: [origin.x, origin.y, origin.z], d: [dir.x, dir.y, dir.z], charge: cmd.charge, seed, rt: this.serverNow() - INTERP_DELAY, target });
  }

  weapon(weapon: WeaponId): void { this.send({ t: 'weapon', weapon }); }
  impact(): void { this.flushInputs(); this.send({ t: 'impact', rt: this.serverNow() - INTERP_DELAY }); }

  targets(): RemoteTarget[] {
    return [...this.remotes.values()].map((r) => ({ id: r.info.id, base: r.position, alive: r.alive, name: r.info.name, health: r.hp, invulnerable: r.last?.inv ?? false }));
  }

  renderOffset(): Vector3 { return this.correction; }
  canAct(): boolean { return this.alive && this.phase !== 'ended'; }

  objective(): string {
    const rules = MODE_RULES[this.mode];
    const time = `${Math.floor(this.timer / 60)}:${Math.floor(this.timer % 60).toString().padStart(2, '0')}`;
    if (this.phase === 'waiting') return `AGUARDANDO OPONENTES · ${this.remotes.size + 1}/${rules.maxPlayers} · SALA ${this.room}`;
    if (this.phase === 'countdown') return `INÍCIO EM ${Math.ceil(this.timer)}`;
    if (this.phase === 'ended') return 'PARTIDA ENCERRADA';
    const me = this.lastRows.find((r) => r.me);
    return `${rules.label} · ${me?.kills ?? 0}/${rules.fragLimit} ABATES · ${time}${this.alive ? '' : ' · RENASCENDO'}`;
  }

  leave(): void {
    this.closed = true;
    try { this.ws.close(); } catch { /* already closed */ }
    for (const r of this.remotes.values()) r.visual.dispose();
    this.remotes.clear();
  }

  private flushInputs(): void {
    if (!this.outbox.length) return;
    this.send({ t: 'input', frames: this.outbox });
    this.outbox = [];
  }

  update(dt: number): void {
    this.sendTimer -= dt;
    if (this.sendTimer <= 0) { this.flushInputs(); this.sendTimer = 1 / 30; }
    this.pingTimer -= dt;
    if (this.pingTimer <= 0) { this.send({ t: 'ping', c: now(), p: this.ping }); this.pingTimer = 2; }
    this.correction.scaleInPlace(Math.exp(-dt * 12));
    if (this.correction.lengthSquared() < 1e-6) this.correction.setAll(0);
    if (this.phase === 'countdown' || this.phase === 'ended') this.timer = Math.max(0, this.timer - dt);
    else if (this.phase === 'playing') this.timer = Math.max(0, this.timer - dt);
    // Interpolate remote mechs INTERP_DELAY behind the server clock.
    const renderTime = this.serverNow() - INTERP_DELAY;
    for (const r of this.remotes.values()) {
      const buffer = r.buffer;
      while (buffer.length > 2 && buffer[1].t <= renderTime) buffer.shift();
      if (!buffer.length) continue;
      let a = buffer[0].s, b = buffer[0].s, k = 0;
      if (buffer.length > 1 && renderTime >= buffer[0].t) {
        b = buffer[1].s;
        k = Math.min(1, (renderTime - buffer[0].t) / Math.max(1e-3, buffer[1].t - buffer[0].t));
      }
      if (Math.hypot(b.x - a.x, b.z - a.z) > 6) { a = b; k = 1; }
      r.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
      let dy = b.yaw - a.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      const yaw = a.yaw + dy * k;
      const v = r.visual;
      v.root.position.copyFrom(r.position);
      v.root.rotation.y = yaw;
      v.root.setEnabled(b.alive);
      r.alive = b.alive;
      if (v.weapon !== b.w) v.setWeapon(b.w);
      v.setShield(b.sh);
      v.setCharge(b.charge);
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      v.animate(dt, { forward: b.vx * sin + b.vz * cos, lateral: b.vx * cos - b.vz * sin, airborne: b.air, jet: b.jet ? 1 : 0, aim: b.pitch * 1.1, dash: b.dash });
    }
    this.scoreTimer -= dt;
    if (this.scoreTimer <= 0) { this.scoreTimer = 0.5; this.callbacks.onScoreboard?.(this.lastRows); }
  }

  // ------------------------------------------------------------ messages
  private ensureRemote(info: PlayerInfo): Remote {
    let r = this.remotes.get(info.id);
    if (!r) {
      const visual = createMech(this.scene, info.palette, 'player', info.weapon);
      for (const mesh of visual.root.getChildMeshes()) this.game.world.shadows.addShadowCaster(mesh);
      r = { info, visual, buffer: [], position: visual.root.position.clone(), alive: true, hp: 100 };
      this.remotes.set(info.id, r);
    } else {
      r.info = info;
      r.visual.setPalette(info.palette);
    }
    this.names.set(info.id, info.name);
    return r;
  }

  private name(id: number): string { return id === this.myId ? 'VOCÊ' : this.names.get(id) ?? `PILOTO ${id}`; }

  private handle(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome': {
        this.myId = message.id;
        this.room = message.room;
        this.mode = message.mode;
        this.isPrivate = message.private;
        this.offset = message.time - now();
        for (const p of message.players) {
          if (p.id === this.myId) { this.names.set(p.id, p.name); continue; }
          this.ensureRemote(p);
        }
        break;
      }
      case 'join':
        if (message.player.id !== this.myId) { this.ensureRemote(message.player); this.callbacks.onFeed?.(`${message.player.name} ENTROU NA ARENA`); }
        break;
      case 'info':
        if (message.player.id !== this.myId) this.ensureRemote(message.player);
        break;
      case 'leave': {
        const r = this.remotes.get(message.id);
        if (r) { this.callbacks.onFeed?.(`${r.info.name} SAIU`); r.visual.dispose(); this.remotes.delete(message.id); }
        break;
      }
      case 'pong': {
        const rtt = now() - message.c;
        this.ping = Math.round(rtt * 1000);
        if (rtt < this.bestRtt * 1.3 || !this.offsetReady) {
          this.bestRtt = Math.min(this.bestRtt, rtt);
          const sample = message.s + rtt / 2 - now();
          this.offset = this.offsetReady ? this.offset * 0.8 + sample * 0.2 : sample;
          this.offsetReady = true;
        }
        break;
      }
      case 'snap': this.onSnap(message); break;
      case 'shot': {
        const r = this.remotes.get(message.id);
        if (!r) break;
        const def = WEAPONS[message.weapon];
        const muzzle = r.visual.muzzle.getAbsolutePosition();
        r.visual.kick(def.recoil);
        this.game.fx.muzzleFlash(r.visual.muzzle, def.color, def.id === 'shotgun' ? 1.2 : 0.7);
        for (const e of message.ends) {
          const end = new Vector3(e[0], e[1], e[2]);
          if (def.id === 'laser') this.game.fx.beam(muzzle, end, def.color, 0.12 + message.charge * 0.2);
          else this.game.fx.tracer(muzzle, end, def.color, def.id === 'shotgun' ? 0.035 : 0.055, 0.08);
        }
        const d = Vector3.Distance(muzzle, this.game.player.root.position);
        if (d < 45) {
          if (def.id === 'laser') this.game.sfx.laser(message.charge); else if (def.id === 'shotgun') this.game.sfx.shotgun(); else if (def.id === 'missile') this.game.sfx.missile(); else this.game.sfx.mg();
        }
        break;
      }
      case 'hit': {
        const at = new Vector3(...message.at);
        if (message.target === this.myId) {
          const shooter = this.remotes.get(message.by);
          this.game.showIncomingHit(message.amount, shooter?.position ?? at);
          this.game.state.health = message.hp;
        } else {
          const r = this.remotes.get(message.target);
          if (r) { r.visual.flashHit(); r.hp = message.hp; }
          if (message.by === this.myId) this.game.showOutgoingHit(at, message.amount, message.crit, message.hp <= 0);
          else this.game.fx.sparks(at, [1, 0.8, 0.4], 6, 0.6);
        }
        break;
      }
      case 'kill': {
        const weapon = message.weapon === 'impact' ? 'IMPACTO' : WEAPONS[message.weapon as WeaponId]?.name ?? 'ARMA';
        this.callbacks.onFeed?.(message.killer === message.victim ? `${this.name(message.victim)} SE AUTODESTRUIU` : `${this.name(message.killer)} ⟶ ${this.name(message.victim)} · ${weapon}`);
        if (message.victim === this.myId) {
          this.alive = false;
          this.game.localDeath();
          this.callbacks.onBanner?.('ABATIDO', `POR ${this.name(message.killer)} · RENASCENDO EM 3 S`);
        } else {
          const r = this.remotes.get(message.victim);
          if (r) { r.alive = false; this.game.fx.explosion(r.position.add(new Vector3(0, 1.8, 0)), 1.3); this.game.sfx.explosion(1); r.visual.root.setEnabled(false); }
          if (message.killer === this.myId) this.callbacks.onBanner?.('ABATE CONFIRMADO', this.name(message.victim));
        }
        break;
      }
      case 'spawn': {
        const at = new Vector3(message.x, message.y, message.z);
        if (message.id === this.myId) {
          this.alive = true;
          this.pending.length = 0;
          this.correction.setAll(0);
          this.game.respawnAt(at, message.yaw);
        } else {
          const r = this.remotes.get(message.id);
          if (r) { r.buffer.length = 0; r.position.copyFrom(at); r.alive = true; r.hp = 100; }
          this.game.fx.pillar(at, [0.4, 0.9, 1], 1);
        }
        break;
      }
      case 'boom':
        this.game.fx.explosion(new Vector3(message.x, message.y, message.z), Math.max(0.7, message.r / 4.5));
        this.game.sfx.explosion(message.r / 4.5);
        break;
      case 'impact': {
        const r = this.remotes.get(message.id);
        if (r) { r.visual.punch(); this.game.fx.shockwave(r.position.add(new Vector3(0, 1.4, 0)), 2.6, [0.5, 0.9, 1], 0.3, 0.2); this.game.sfx.impact(); }
        break;
      }
      case 'phase': {
        const previous = this.phase;
        this.phase = message.phase;
        this.timer = message.timer;
        if (message.phase === 'countdown') this.callbacks.onBanner?.('PREPARAR', `${MODE_RULES[this.mode].label} COMEÇA EM ${Math.ceil(message.timer)} S`);
        if (message.phase === 'playing' && previous !== 'playing') { this.callbacks.onBanner?.('LUTEM!', MODE_RULES[this.mode].label); this.game.sfx.wave(); }
        if (message.phase === 'waiting' && previous === 'ended') this.callbacks.onBanner?.('NOVA PARTIDA', 'AGUARDANDO PILOTOS');
        if (message.phase === 'ended' && message.ranking) {
          const ranking = message.ranking;
          const winner = ranking[0];
          const mine = ranking.findIndex((r) => r.id === this.myId);
          const won = winner?.id === this.myId;
          const result: ResultInfo = {
            won,
            kicker: `${MODE_RULES[this.mode].label} · SALA ${this.room}`,
            title: won ? 'VITÓRIA' : `${mine + 1}º LUGAR`,
            detail: winner ? `${won ? 'Você venceu' : `${winner.name} venceu`} com ${winner.kills} abates.` : 'Partida encerrada.',
            score: ranking[mine]?.score ?? 0,
            difficulty: 'veteran',
            stats: ranking.slice(0, 6).map((r, i) => [`${i + 1}. ${r.id === this.myId ? 'VOCÊ' : r.name}`, `${r.kills} A / ${r.deaths} M`]),
          };
          won ? this.game.sfx.victory() : this.game.sfx.defeat();
          this.game.finishOnline(result);
        }
        break;
      }
      case 'error':
        this.callbacks.onStatus?.(message.message);
        break;
      default: break;
    }
  }

  private onSnap(snap: Extract<ServerMessage, { t: 'snap' }>): void {
    if (!this.offsetReady) this.offset = snap.time - now();
    this.phase = snap.phase;
    this.timer = snap.timer;
    const rows: ScoreRow[] = [];
    for (const p of snap.players) {
      rows.push({ id: p.id, name: this.name(p.id), kills: p.kills, deaths: p.deaths, score: p.score, ping: p.ping, me: p.id === this.myId });
      if (p.id === this.myId) {
        this.alive = p.alive;
        this.game.setOnlineScore(p.score, p.kills);
        continue;
      }
      const r = this.remotes.get(p.id);
      if (!r) continue;
      r.last = p;
      r.hp = p.hp;
      r.buffer.push({ t: snap.time, s: p });
      if (r.buffer.length > 30) r.buffer.shift();
    }
    rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.score - a.score);
    this.lastRows = rows;
    this.game.syncNetMissiles(snap.missiles);
    if (snap.me) this.reconcile(snap.me, snap.ack);
  }

  /** Server reconciliation: adopt the authoritative state, replay unacknowledged inputs, smooth the visual error. */
  private reconcile(server: MechState, ack: number): void {
    const s = this.game.state;
    const before = new Vector3(s.x, s.y, s.z);
    const local = { weapon: s.weapon, charge: s.charge, fireCd: s.fireCd, heat: s.heat, overheated: s.overheated, bloom: s.bloom, sinceShot: s.sinceShot, yaw: s.yaw, pitch: s.pitch };
    Object.assign(s, server);
    while (this.pending.length && this.pending[0].seq <= ack) this.pending.shift();
    const arena = this.game.world.arena;
    for (const frame of this.pending) stepMech(s, frame, frame.dt, arena);
    Object.assign(s, local);
    const after = new Vector3(s.x, s.y, s.z);
    const error = before.subtract(after);
    if (error.length() > 4) this.correction.setAll(0);
    else this.correction.addInPlace(error);
  }
}
