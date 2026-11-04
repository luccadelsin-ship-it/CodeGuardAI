import {
  Color3,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import type { Arena } from '../shared/arena';
import { createMech, type MechVisual } from './mech';
import type { Fx } from './fx';
import type { Sfx } from './audio';

export type EnemyType = 'sentinel' | 'brute' | 'sniper' | 'wasp' | 'boss';
export type Difficulty = 'recruit' | 'veteran' | 'elite';
type Rgb = [number, number, number];

export interface DifficultyDef {
  label: string;
  damage: number;
  health: number;
  /** Telegraph duration multiplier (higher = more time to react). */
  reaction: number;
  /** Aim lead factor 0..1 and angular error in radians. */
  lead: number;
  error: number;
  aggression: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  recruit: { label: 'RECRUTA', damage: 0.6, health: 0.8, reaction: 1.35, lead: 0.25, error: 0.06, aggression: 0.7 },
  veteran: { label: 'VETERANO', damage: 1, health: 1, reaction: 1, lead: 0.6, error: 0.035, aggression: 1 },
  elite: { label: 'ELITE', damage: 1.35, health: 1.25, reaction: 0.78, lead: 0.9, error: 0.018, aggression: 1.3 },
};

interface EnemyDef {
  name: string;
  health: number;
  speed: number;
  range: [number, number];
  score: number;
  scale: number;
  flying: boolean;
  color: Rgb;
}

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  sentinel: { name: 'SENTINELA', health: 95, speed: 4.6, range: [10, 22], score: 300, scale: 0.86, flying: false, color: [1, 0.35, 0.2] },
  brute: { name: 'ROMPEDOR', health: 230, speed: 5.3, range: [0, 7], score: 650, scale: 1.02, flying: false, color: [1, 0.68, 0.22] },
  sniper: { name: 'ATIRADOR', health: 85, speed: 4.2, range: [24, 40], score: 480, scale: 0.84, flying: false, color: [1, 0.3, 0.85] },
  wasp: { name: 'VESPA', health: 40, speed: 9, range: [9, 15], score: 220, scale: 1, flying: true, color: [1, 0.25, 0.2] },
  boss: { name: 'COLOSSO', health: 1500, speed: 3.1, range: [6, 18], score: 4000, scale: 1.55, flying: false, color: [1, 0.25, 0.12] },
};

export interface ProjectileOptions { speed: number; damage: number; color: Rgb; size?: number; homing?: number; splash?: number; splashDamage?: number; kind?: 'bolt' | 'missile' }

export interface AiContext {
  arena: Arena;
  fx: Fx;
  sfx: Sfx;
  scene: Scene;
  time: number;
  difficulty: DifficultyDef;
  enemies: Enemy[];
  player: { position: Vector3; velocity: Vector3; alive: boolean; grounded: boolean; airborneHeight: number };
  fireProjectile(owner: Enemy, origin: Vector3, dir: Vector3, opts: ProjectileOptions): void;
  /** Instant beam; returns true when the player was hit. */
  hitscan(owner: Enemy, origin: Vector3, dir: Vector3, range: number, damage: number, color: Rgb): boolean;
  damagePlayer(amount: number, from: Vector3, knockback: number, source: string): void;
  spawnEnemy(type: EnemyType, at?: Vector3): void;
  explode(at: Vector3, radius: number, damage: number, source: 'enemy' | 'player' | 'barrel'): void;
}

type AiState = 'spawn' | 'patrol' | 'engage' | 'cover' | 'flank' | 'retreat' | 'stagger' | 'charge' | 'dive' | 'aim' | 'dead';

/** Small navigation graph over the outpost: stations, bridges, ring entries and centre. */
class NavGraph {
  readonly nodes: Vector3[] = [];
  readonly edges: number[][] = [];
  constructor(private readonly arena: Arena) {
    const y = arena.deckY;
    this.nodes.push(new Vector3(0, y, 0));
    for (const s of arena.layout.stations) {
      const len = Math.hypot(s.x, s.z);
      const dx = s.x / len, dz = s.z / len;
      this.nodes.push(new Vector3(s.x, y, s.z));
      this.nodes.push(new Vector3(dx * 17, y, dz * 17));
      this.nodes.push(new Vector3(dx * 8, y, dz * 8));
      this.nodes.push(new Vector3(dx * 22.5, y, dz * 22.5));
    }
    // Ring waypoints between the barricades.
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + Math.PI / 8;
      this.nodes.push(new Vector3(Math.cos(a) * 7.6, y, Math.sin(a) * 7.6));
    }
    for (let i = 0; i < this.nodes.length; i++) {
      this.edges.push([]);
      for (let j = 0; j < this.nodes.length; j++) {
        if (i !== j && Vector3.Distance(this.nodes[i], this.nodes[j]) < 16 && this.walkable(this.nodes[i], this.nodes[j], 0.85)) this.edges[i].push(j);
      }
    }
  }

  walkable(a: Vector3, b: Vector3, radius: number): boolean {
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(distance / 0.7));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!this.arena.canMoveTo(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, radius)) return false;
    }
    return true;
  }

  private nearestVisible(p: Vector3, radius: number): number {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const d = Vector3.DistanceSquared(p, this.nodes[i]);
      if (d < bestD && this.walkable(p, this.nodes[i], radius)) { best = i; bestD = d; }
    }
    if (best < 0) {
      for (let i = 0; i < this.nodes.length; i++) {
        const d = Vector3.DistanceSquared(p, this.nodes[i]);
        if (d < bestD) { best = i; bestD = d; }
      }
    }
    return best;
  }

  /** Next point to walk towards on the way from `from` to `to`. */
  next(from: Vector3, to: Vector3, radius: number): Vector3 {
    if (this.walkable(from, to, radius)) return to;
    const start = this.nearestVisible(from, radius);
    const goal = this.nearestVisible(to, radius);
    if (start === goal) return Vector3.DistanceSquared(from, this.nodes[start]) > 1 ? this.nodes[start] : to;
    const dist = new Array(this.nodes.length).fill(Infinity);
    const prev = new Array<number>(this.nodes.length).fill(-1);
    const open = new Set<number>([start]);
    dist[start] = 0;
    while (open.size) {
      let current = -1;
      for (const n of open) if (current < 0 || dist[n] < dist[current]) current = n;
      open.delete(current);
      if (current === goal) break;
      for (const n of this.edges[current]) {
        const d = dist[current] + Vector3.Distance(this.nodes[current], this.nodes[n]);
        if (d < dist[n]) { dist[n] = d; prev[n] = current; open.add(n); }
      }
    }
    if (prev[goal] < 0) return this.nodes[start];
    let step = goal;
    while (prev[step] !== start && prev[step] >= 0) step = prev[step];
    // If we are already at the start node, head for the following node.
    if (Vector3.DistanceSquared(from, this.nodes[start]) > 2.2 && !this.walkable(from, this.nodes[step], radius)) return this.nodes[start];
    return this.nodes[step];
  }
}

let navCache: { arena: Arena; graph: NavGraph } | null = null;
function navFor(arena: Arena): NavGraph {
  if (!navCache || navCache.arena !== arena) navCache = { arena, graph: new NavGraph(arena) };
  return navCache.graph;
}

/** Flying drone built from real meshes: armoured pod, four rotors, eye and cannon. */
function createWaspVisual(scene: Scene, id: number) {
  const root = new TransformNode(`wasp-${id}`, scene);
  const body = new TransformNode(`wasp-${id}-body`, scene);
  body.parent = root;
  const mat = (name: string, hex: string, emissive = false) => {
    const m = new StandardMaterial(`wasp-${id}-${name}`, scene);
    const c = Color3.FromHexString(hex);
    m.diffuseColor = c;
    m.specularColor = c.scale(0.4);
    if (emissive) { m.emissiveColor = c; }
    return m;
  };
  const shell = mat('shell', '#3b4852');
  const dark = mat('dark', '#0e171e');
  const eye = mat('eye', '#ff3b2a', true);
  const rotorMat = mat('rotor', '#9fd8ff', true);
  rotorMat.alpha = 0.35;
  const meshes: Mesh[] = [];
  const add = (mesh: Mesh, m: StandardMaterial, parent: TransformNode = body) => { mesh.parent = parent; mesh.material = m; mesh.isPickable = false; meshes.push(mesh); return mesh; };
  const pod = add(MeshBuilder.CreateSphere(`wasp-${id}-pod`, { diameter: 1.15, segments: 12 }, scene), shell);
  pod.scaling.set(1, 0.6, 1.25);
  add(MeshBuilder.CreateBox(`wasp-${id}-spine`, { width: 0.35, height: 0.18, depth: 1.5 }, scene), dark).position.y = 0.32;
  const eyeMesh = add(MeshBuilder.CreateSphere(`wasp-${id}-eye`, { diameter: 0.34, segments: 10 }, scene), eye);
  eyeMesh.position.set(0, 0.02, 0.66);
  const gun = add(MeshBuilder.CreateCylinder(`wasp-${id}-gun`, { diameter: 0.14, height: 0.7, tessellation: 8 }, scene), dark);
  gun.rotation.x = Math.PI / 2;
  gun.position.set(0, -0.3, 0.45);
  const muzzle = new TransformNode(`wasp-${id}-muzzle`, scene);
  muzzle.parent = body;
  muzzle.position.set(0, -0.3, 0.85);
  const rotors: Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const arm = add(MeshBuilder.CreateBox(`wasp-${id}-arm-${i}`, { width: 0.14, height: 0.08, depth: 1 }, scene), shell);
    arm.position.set(Math.sin(a) * 0.55, 0.1, Math.cos(a) * 0.55);
    arm.rotation.y = a;
    const hub = add(MeshBuilder.CreateCylinder(`wasp-${id}-hub-${i}`, { diameter: 0.2, height: 0.16, tessellation: 8 }, scene), dark);
    hub.position.set(Math.sin(a) * 1.0, 0.16, Math.cos(a) * 1.0);
    const rotor = add(MeshBuilder.CreateCylinder(`wasp-${id}-rotor-${i}`, { diameter: 0.8, height: 0.02, tessellation: 16 }, scene), rotorMat);
    rotor.position.set(Math.sin(a) * 1.0, 0.25, Math.cos(a) * 1.0);
    rotors.push(rotor);
  }
  let hit = 0, alert = 0, t = Math.random() * 5;
  return {
    root, body, muzzle,
    update(dt: number, tilt: Vector3) {
      t += dt;
      for (const [i, r] of rotors.entries()) r.rotation.y += dt * (i % 2 ? 40 : -40);
      body.rotation.x = tilt.z * 0.35;
      body.rotation.z = -tilt.x * 0.35;
      body.position.y = Math.sin(t * 3) * 0.12;
      hit = Math.max(0, hit - dt);
      const pulse = alert > 0 ? 1 + alert * (1.5 + Math.sin(t * 45)) : 1;
      eye.emissiveColor = new Color3(1, 0.23, 0.16).scale(pulse);
      shell.emissiveColor = hit > 0 ? new Color3(0.9, 0.15, 0.05).scale(hit / 0.18) : Color3.Black();
      eyeMesh.scaling.setAll(1 + alert * 0.5);
    },
    setAlert(level: number) { alert = level; },
    flashHit() { hit = 0.18; },
    dispose() { root.dispose(false); for (const m of [shell, dark, eye, rotorMat]) m.dispose(); },
  };
}

let enemyCounter = 0;

export class Enemy {
  readonly id = ++enemyCounter;
  readonly def: EnemyDef;
  readonly mech?: MechVisual;
  readonly wasp?: ReturnType<typeof createWaspVisual>;
  readonly root: TransformNode;
  health: number;
  maxHealth: number;
  alive = true;
  state: AiState = 'spawn';
  stateTime = 0;
  velocity = Vector3.Zero();
  push = Vector3.Zero();
  yaw = 0;
  recentDamage = 0;
  shieldTime = 0;
  /** Set when the enemy dies; read by the game for scoring. */
  killed = false;
  private fireTimer: number;
  private burstLeft = 0;
  private burstTimer = 0;
  private telegraph = 0;
  private strafeSign = Math.random() < 0.5 ? -1 : 1;
  private strafeTimer = 0;
  private avoidSign = Math.random() < 0.5 ? -1 : 1;
  private moveTarget: Vector3 | null = null;
  private replanTimer = 0;
  private waypoint: Vector3 | null = null;
  private coverPoint: Vector3 | null = null;
  private coverUsed = 0;
  private lastSeen = -99;
  private lastKnown = Vector3.Zero();
  private stuckTimer = 0;
  private lastPos = Vector3.Zero();
  private aimDir = new Vector3(0, 0, 1);
  private laserSight?: Mesh;
  private orbitAngle = Math.random() * Math.PI * 2;
  private altitude = 5.5 + Math.random() * 2.5;
  private diveTarget = Vector3.Zero();
  private attackCycle = 0;
  private bossPhase = 1;
  private slamRing?: { mesh: Mesh; radius: number; hit: boolean };
  private shotsFired = 0;
  private volleys: number[] = [];
  private disposed = false;

  constructor(readonly type: EnemyType, scene: Scene, position: Vector3, difficulty: DifficultyDef) {
    this.def = ENEMY_DEFS[type];
    this.maxHealth = this.health = this.def.health * difficulty.health;
    if (type === 'wasp') {
      this.wasp = createWaspVisual(scene, this.id);
      this.root = this.wasp.root;
      this.root.position.set(position.x, position.y + this.altitude + 6, position.z);
    } else {
      const weapon = type === 'brute' ? 'shotgun' : type === 'sniper' ? 'laser' : type === 'boss' ? 'missile' : 'mg';
      this.mech = createMech(scene, 'steel', type, weapon);
      this.root = this.mech.root;
      this.root.position.copyFrom(position);
    }
    this.fireTimer = 1.2 + Math.random() * 1.2;
    this.lastPos.copyFrom(this.root.position);
  }

  get position(): Vector3 { return this.root.position; }
  get scale(): number { return this.def.scale; }
  get center(): Vector3 { return this.def.flying ? this.root.position.clone() : this.root.position.add(new Vector3(0, 1.9 * this.def.scale, 0)); }
  get eye(): Vector3 { return this.def.flying ? this.root.position.clone() : this.root.position.add(new Vector3(0, 3.0 * this.def.scale, 0)); }
  get muzzlePosition(): Vector3 { return (this.mech?.muzzle ?? this.wasp!.muzzle).getAbsolutePosition(); }
  get stateLabel(): string { return this.state; }

  /** Apply damage from the player; returns true if it killed the enemy. */
  takeDamage(amount: number, from: Vector3, knockback: number): boolean {
    if (!this.alive) return false;
    if (this.shieldTime > 0) amount *= 0.2;
    this.health -= amount;
    this.recentDamage += amount;
    this.mech?.flashHit();
    this.wasp?.flashHit();
    this.lastSeen = Math.max(this.lastSeen, 0);
    this.lastKnown.copyFrom(from);
    if (knockback > 0 && this.type !== 'boss') {
      const dir = this.position.subtract(from);
      dir.y = 0;
      if (dir.lengthSquared() > 0.01) this.push.addInPlace(dir.normalize().scale(knockback * (this.type === 'brute' ? 1.2 : 2.2)));
      if (knockback >= 2.5 && this.state !== 'charge' && this.state !== 'dive') this.enter('stagger');
    }
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.killed = true;
      this.state = 'dead';
      return true;
    }
    return false;
  }

  private enter(state: AiState): void {
    if (this.state === state) return;
    this.state = state;
    this.stateTime = 0;
    this.telegraph = 0;
    this.burstLeft = 0;
    this.mech?.setAlert(0);
    this.wasp?.setAlert(0);
    if (this.laserSight) this.laserSight.setEnabled(false);
  }

  private canSee(ctx: AiContext): boolean {
    if (!ctx.player.alive) return false;
    const target = ctx.player.position.add(new Vector3(0, 1.9, 0));
    return Vector3.Distance(this.eye, target) < 60 && ctx.arena.lineOfSight(this.eye, target) && ctx.arena.lineOfSight(this.muzzlePosition, target);
  }

  update(ctx: AiContext, dt: number): void {
    if (!this.alive) return;
    this.stateTime += dt;
    this.recentDamage = Math.max(0, this.recentDamage - dt * 18);
    this.shieldTime = Math.max(0, this.shieldTime - dt);
    const sees = this.canSee(ctx);
    if (sees) { this.lastSeen = ctx.time; this.lastKnown.copyFrom(ctx.player.position); }
    if (this.def.flying) this.updateWasp(ctx, dt, sees);
    else this.updateGround(ctx, dt, sees);
    if (this.slamRing) this.updateSlam(ctx, dt);
    if (this.volleys.length) this.updateVolleys(ctx, dt);
  }

  // ----------------------------------------------------------- ground mechs
  private updateGround(ctx: AiContext, dt: number, sees: boolean): void {
    const mech = this.mech!;
    const pos = this.position;
    const toPlayer = ctx.player.position.subtract(pos);
    toPlayer.y = 0;
    const distance = toPlayer.length();
    const [minRange, maxRange] = this.def.range;
    let desired = Vector3.Zero();
    let speed = this.def.speed;
    let face = sees || this.state === 'aim' ? Math.atan2(toPlayer.x, toPlayer.z) : this.yaw;

    switch (this.state) {
      case 'spawn': {
        if (this.stateTime > 0.9) this.enter(sees ? 'engage' : 'patrol');
        break;
      }
      case 'patrol': {
        // Hunt towards the last known position, with a little wander.
        if (!this.moveTarget || Vector3.Distance(pos, this.moveTarget) < 2 || this.stateTime > 6) {
          const near = ctx.time - this.lastSeen < 12 ? this.lastKnown : ctx.player.position;
          const p = ctx.arena.randomDeckPoint(Math.random, { x: near.x, z: near.z, radius: 6 });
          this.moveTarget = new Vector3(p.x, ctx.arena.deckY, p.z);
          this.stateTime = 0;
        }
        desired = this.navigate(ctx, this.moveTarget, dt);
        speed *= 0.85;
        if (this.moveTarget) face = Math.atan2(this.moveTarget.x - pos.x, this.moveTarget.z - pos.z);
        if (sees) this.enter('engage');
        break;
      }
      case 'engage': {
        if (!sees && ctx.time - this.lastSeen > 1.6) { this.enter(this.type === 'sentinel' ? 'flank' : 'patrol'); break; }
        // Damage reactions: back off, or break for cover when hurt.
        if (this.recentDamage > 28 && this.type !== 'boss' && this.type !== 'brute') { this.enter('retreat'); break; }
        if (this.health < this.maxHealth * 0.45 && this.coverUsed < 2 && (this.type === 'sentinel' || this.type === 'sniper')) {
          const cover = this.findCover(ctx);
          if (cover) { this.coverPoint = cover; this.coverUsed++; this.enter('cover'); break; }
        }
        if (this.type === 'brute' && distance < 12 && sees && this.fireTimer <= 0) { this.enter('charge'); break; }
        if (this.type === 'sniper' && sees && this.fireTimer <= 0 && distance > 9) { this.enter('aim'); break; }
        // Range keeping + strafing.
        const dir = distance > 0.01 ? toPlayer.scale(1 / distance) : new Vector3(0, 0, 1);
        const side = new Vector3(dir.z, 0, -dir.x).scale(this.strafeSign);
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) { this.strafeSign *= -1; this.strafeTimer = 1 + Math.random() * 1.8 / ctx.difficulty.aggression; }
        if (distance > maxRange) desired = this.navigate(ctx, ctx.player.position, dt).add(side.scale(0.3));
        else if (distance < minRange) desired = dir.scale(-1).add(side.scale(0.6));
        else desired = side.add(dir.scale(this.type === 'brute' || this.type === 'boss' ? 0.8 : 0.05));
        if (this.type === 'sniper' && distance < 14) { this.enter('retreat'); break; }
        this.updateAttacks(ctx, dt, sees, distance);
        break;
      }
      case 'flank': {
        // Move to a point beside the player that has line of sight.
        if (!this.moveTarget || this.stateTime > 5 || Vector3.Distance(pos, this.moveTarget) < 1.5) {
          this.moveTarget = this.findFlankPoint(ctx);
          this.stateTime = Math.min(this.stateTime, 4);
        }
        desired = this.navigate(ctx, this.moveTarget, dt);
        speed *= 1.15;
        if (this.moveTarget) face = Math.atan2(this.moveTarget.x - pos.x, this.moveTarget.z - pos.z);
        if (sees && this.stateTime > 0.6) this.enter('engage');
        if (this.stateTime > 7) this.enter('patrol');
        break;
      }
      case 'cover': {
        const cover = this.coverPoint!;
        const d = Math.hypot(cover.x - pos.x, cover.z - pos.z);
        if (d > 0.6) { desired = this.navigate(ctx, cover, dt); speed *= 1.25; face = Math.atan2(cover.x - pos.x, cover.z - pos.z); }
        else {
          // Hunker down and repair a little, then peek back out.
          this.health = Math.min(this.maxHealth * 0.7, this.health + dt * 7);
          if (this.stateTime > 2.6 + Math.random() * 0.02) this.enter('engage');
        }
        if (this.stateTime > 7) this.enter('engage');
        break;
      }
      case 'retreat': {
        const away = toPlayer.scale(-1 / Math.max(0.01, distance));
        const side = new Vector3(away.z, 0, -away.x).scale(this.strafeSign);
        desired = away.add(side.scale(0.7));
        speed *= 1.25;
        if (this.stateTime > (this.type === 'sniper' ? 2.2 : 0.9)) this.enter('engage');
        if (sees) this.updateAttacks(ctx, dt, sees, distance);
        break;
      }
      case 'stagger': {
        speed = 0;
        mech.setAlert(0);
        if (this.stateTime > 0.55) this.enter('engage');
        break;
      }
      case 'charge': {
        // Brute: crouch and glow (telegraph), then rush and blast.
        const wind = 0.6 * ctx.difficulty.reaction;
        if (this.stateTime < wind) {
          speed = 0;
          mech.setAlert(this.stateTime / wind);
          if (this.stateTime < dt * 1.5) { ctx.sfx.telegraph(); ctx.fx.orb(mech.muzzle, this.def.color, 0.9, wind, true); }
        } else if (this.stateTime < wind + 0.75 && distance > 3) {
          desired = toPlayer.normalize();
          speed = 15;
          mech.setAlert(1);
        } else {
          this.blast(ctx);
          this.fireTimer = 2.6 / ctx.difficulty.aggression;
          this.enter('engage');
        }
        break;
      }
      case 'aim': {
        this.updateSniper(ctx, dt, sees);
        speed = 0;
        face = Math.atan2(this.aimDir.x, this.aimDir.z);
        break;
      }
      default: break;
    }

    if (this.type === 'boss') this.updateBoss(ctx, dt, sees, distance);

    // Separation from other enemies.
    for (const other of ctx.enemies) {
      if (other === this || !other.alive || other.def.flying) continue;
      const away = pos.subtract(other.position);
      away.y = 0;
      const d = away.length();
      const min = 2.2 * Math.max(this.def.scale, other.def.scale);
      if (d > 0.01 && d < min) desired.addInPlace(away.scale((min - d) / (min * d)));
    }

    // Integrate movement with feelers so they slide around cover instead of through it.
    const target = desired.lengthSquared() > 0.0001 ? desired.normalize().scale(speed) : Vector3.Zero();
    this.velocity = Vector3.Lerp(this.velocity, target, Math.min(1, dt * (this.state === 'charge' ? 12 : 6)));
    const step = this.velocity.add(this.push).scale(dt);
    this.push.scaleInPlace(Math.exp(-dt * 6));
    const radius = 0.8 * this.def.scale;
    const moved = this.tryMove(ctx, step, radius);
    if (!moved && this.velocity.lengthSquared() > 1) this.avoidSign *= -1;

    // Stuck detection: pick a fresh random point nearby.
    this.stuckTimer += dt;
    if (this.stuckTimer > 1.2) {
      if (Vector3.Distance(this.lastPos, pos) < 0.4 && target.lengthSquared() > 1 && this.state !== 'cover') {
        const p = ctx.arena.randomDeckPoint(Math.random, { x: pos.x, z: pos.z, radius: 7 });
        this.moveTarget = new Vector3(p.x, ctx.arena.deckY, p.z);
        this.waypoint = null;
        if (this.state === 'engage') this.enter('patrol');
      }
      this.lastPos.copyFrom(pos);
      this.stuckTimer = 0;
    }

    // Face target smoothly.
    let deltaYaw = face - this.yaw;
    while (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
    while (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
    this.yaw += deltaYaw * Math.min(1, dt * (this.type === 'boss' ? 3 : 8));
    this.root.rotation.y = this.yaw;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const forward = this.velocity.x * sin + this.velocity.z * cos;
    const lateral = this.velocity.x * cos - this.velocity.z * sin;
    const aimPitch = sees ? -Math.atan2(ctx.player.position.y + 1.8 - (pos.y + 2.4 * this.def.scale), Math.max(1, distance)) : 0.05;
    mech.animate(dt, { forward: forward / this.def.scale, lateral: lateral / this.def.scale, aim: aimPitch, dash: this.state === 'charge' && this.stateTime > 0.6, jet: this.state === 'charge' ? 0.6 : 0 });
    if (this.fireTimer > 0) this.fireTimer -= dt;
  }

  private tryMove(ctx: AiContext, step: Vector3, radius: number): boolean {
    const pos = this.position;
    const nx = pos.x + step.x, nz = pos.z + step.z;
    if (ctx.arena.canMoveTo(nx, nz, radius)) { pos.x = nx; pos.z = nz; return true; }
    let moved = false;
    if (ctx.arena.canMoveTo(nx, pos.z, radius)) { pos.x = nx; moved = true; }
    if (ctx.arena.canMoveTo(pos.x, nz, radius)) { pos.z = nz; moved = true; }
    if (!moved) { this.velocity.scaleInPlace(0.3); this.push.setAll(0); }
    return moved;
  }

  /** Steering towards a point using the nav graph plus angled feelers. */
  private navigate(ctx: AiContext, target: Vector3, dt: number): Vector3 {
    const pos = this.position;
    const radius = 0.8 * this.def.scale;
    this.replanTimer -= dt;
    if (this.replanTimer <= 0 || !this.waypoint) {
      this.waypoint = navFor(ctx.arena).next(pos, target, radius);
      this.replanTimer = 0.45;
    }
    const goal = this.waypoint;
    const dir = new Vector3(goal.x - pos.x, 0, goal.z - pos.z);
    if (dir.lengthSquared() < 0.25) { this.replanTimer = 0; return Vector3.Zero(); }
    dir.normalize();
    const look = 1.3;
    for (const angle of [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8]) {
      const a = angle * this.avoidSign;
      const c = Math.cos(a), s = Math.sin(a);
      const test = new Vector3(dir.x * c - dir.z * s, 0, dir.x * s + dir.z * c);
      if (ctx.arena.canMoveTo(pos.x + test.x * look, pos.z + test.z * look, radius)) return test;
    }
    return dir;
  }

  private findCover(ctx: AiContext): Vector3 | null {
    const pos = this.position;
    const player = ctx.player.position;
    let best: Vector3 | null = null;
    let bestScore = Infinity;
    const covers = ctx.arena.staticCover.concat(ctx.arena.dynamicCover);
    for (const c of covers) {
      const away = new Vector3(c.x - player.x, 0, c.z - player.z);
      const d = away.length();
      if (d < 0.1) continue;
      away.scaleInPlace(1 / d);
      const offset = Math.max(c.widthX, c.widthZ) / 2 + 1.25 * this.def.scale;
      const candidate = new Vector3(c.x + away.x * offset, ctx.arena.deckY, c.z + away.z * offset);
      const travel = Vector3.Distance(pos, candidate);
      if (travel > 24) continue;
      if (!ctx.arena.canMoveTo(candidate.x, candidate.z, 0.85 * this.def.scale)) continue;
      const hidden = !ctx.arena.lineOfSight(candidate.add(new Vector3(0, 1.4, 0)), player.add(new Vector3(0, 1.9, 0)));
      if (!hidden) continue;
      const score = travel + Math.abs(Vector3.Distance(candidate, player) - (this.def.range[0] + this.def.range[1]) / 2) * 0.4;
      if (score < bestScore) { bestScore = score; best = candidate; }
    }
    return best;
  }

  private findFlankPoint(ctx: AiContext): Vector3 {
    const player = ctx.player.position;
    const pos = this.position;
    const base = Math.atan2(pos.x - player.x, pos.z - player.z);
    const r = (this.def.range[0] + this.def.range[1]) / 2;
    let fallback = player.clone();
    for (const offset of [1.1, -1.1, 0.6, -0.6, 1.7, -1.7, 0]) {
      const a = base + offset * this.strafeSign;
      const candidate = new Vector3(player.x + Math.sin(a) * r, ctx.arena.deckY, player.z + Math.cos(a) * r);
      if (!ctx.arena.canMoveTo(candidate.x, candidate.z, 0.9)) continue;
      fallback = candidate;
      if (ctx.arena.lineOfSight(candidate.add(new Vector3(0, 2.6, 0)), player.add(new Vector3(0, 1.9, 0)))) return candidate;
    }
    return fallback;
  }

  /** Lead the player with difficulty-based prediction and error. */
  private aimAt(ctx: AiContext, origin: Vector3, projectileSpeed: number): Vector3 {
    const target = ctx.player.position.add(new Vector3(0, 1.75, 0));
    const t = Vector3.Distance(origin, target) / Math.max(1, projectileSpeed);
    const lead = ctx.player.velocity.scale(t * ctx.difficulty.lead);
    lead.y = 0;
    const dir = target.add(lead).subtract(origin).normalize();
    const e = ctx.difficulty.error;
    dir.x += (Math.random() - 0.5) * e * 2;
    dir.y += (Math.random() - 0.5) * e;
    dir.z += (Math.random() - 0.5) * e * 2;
    return dir.normalize();
  }

  private updateAttacks(ctx: AiContext, dt: number, sees: boolean, distance: number): void {
    if (this.type === 'brute' || this.type === 'sniper' || this.type === 'boss') return;
    const mech = this.mech!;
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.burstLeft--;
        this.burstTimer = 0.13;
        if (sees) {
          const origin = this.muzzlePosition;
          ctx.fireProjectile(this, origin, this.aimAt(ctx, origin, 38), { speed: 36, damage: 5 * ctx.difficulty.damage, color: this.def.color, size: 0.22 });
          mech.kick(0.25);
          ctx.fx.muzzleFlash(mech.muzzle, this.def.color, 0.7);
          ctx.sfx.enemyShot();
        }
        if (this.burstLeft === 0) { mech.setAlert(0); this.fireTimer = (1.9 + Math.random() * 1.2) / ctx.difficulty.aggression; }
      }
      return;
    }
    if (this.telegraph > 0) {
      this.telegraph -= dt;
      mech.setAlert(1 - this.telegraph / (0.5 * ctx.difficulty.reaction));
      if (this.telegraph <= 0) { this.burstLeft = 3; this.burstTimer = 0; }
      return;
    }
    if (this.fireTimer <= 0 && sees && distance < 40) {
      this.telegraph = 0.5 * ctx.difficulty.reaction;
      ctx.fx.orb(mech.muzzle, this.def.color, 0.55, this.telegraph, true);
      ctx.sfx.telegraph();
    }
  }

  private blast(ctx: AiContext): void {
    const mech = this.mech!;
    const origin = this.muzzlePosition;
    const base = this.aimAt(ctx, origin, 40);
    for (let i = 0; i < 7; i++) {
      const dir = base.add(new Vector3((Math.random() - 0.5) * 0.28, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.28)).normalize();
      ctx.fireProjectile(this, origin, dir, { speed: 42, damage: 5.5 * ctx.difficulty.damage, color: this.def.color, size: 0.2 });
    }
    mech.kick(0.9);
    ctx.fx.muzzleFlash(mech.muzzle, this.def.color, 1.3);
    ctx.sfx.shotgun();
    const d = Vector3.Distance(this.position, ctx.player.position);
    if (d < 3.6 * this.def.scale && ctx.player.airborneHeight < 1.2) {
      ctx.damagePlayer(16 * ctx.difficulty.damage, this.position, 7, this.def.name);
      ctx.fx.shockwave(this.position.add(new Vector3(0, 0.2, 0)), 3, this.def.color, 0.35);
    }
  }

  private updateSniper(ctx: AiContext, dt: number, sees: boolean): void {
    const mech = this.mech!;
    const lockTime = 1.25 * ctx.difficulty.reaction;
    const origin = this.muzzlePosition;
    const target = ctx.player.position.add(new Vector3(0, 1.8, 0));
    const want = target.subtract(origin).normalize();
    if (this.stateTime < dt * 1.5) { this.aimDir = want.clone(); ctx.sfx.sniperLock(); }
    // The sight tracks with lag; the last quarter-second is locked.
    if (this.stateTime < lockTime - 0.28) {
      const rate = Math.min(1, dt * (2.2 + ctx.difficulty.lead * 2));
      this.aimDir = Vector3.Lerp(this.aimDir, want, rate).normalize();
    }
    if (!this.laserSight) {
      this.laserSight = MeshBuilder.CreateCylinder(`sniper-sight-${this.id}`, { diameter: 1, height: 1, tessellation: 6 }, ctx.scene);
      const mat = new StandardMaterial(`sniper-sight-mat-${this.id}`, ctx.scene);
      mat.emissiveColor = new Color3(1, 0.1, 0.35);
      mat.disableLighting = true;
      mat.alpha = 0.6;
      this.laserSight.material = mat;
      this.laserSight.isPickable = false;
    }
    const blocked = ctx.arena.raycastCover(origin, this.aimDir, 80);
    const length = blocked ?? 80;
    const end = origin.add(this.aimDir.scale(length));
    this.laserSight.setEnabled(true);
    this.laserSight.position.copyFrom(origin.add(end).scale(0.5));
    this.laserSight.rotationQuaternion ??= new Quaternion();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), this.aimDir, this.laserSight.rotationQuaternion);
    const locked = this.stateTime > lockTime - 0.28;
    const width = locked ? 0.07 : 0.025;
    this.laserSight.scaling.set(width, length, width);
    mech.setAlert(Math.min(1, this.stateTime / lockTime));
    if (locked && this.stateTime - dt <= lockTime - 0.28) ctx.sfx.telegraph();
    if (this.stateTime >= lockTime) {
      this.laserSight.setEnabled(false);
      ctx.hitscan(this, origin, this.aimDir, 90, 24 * ctx.difficulty.damage, this.def.color);
      mech.kick(0.8);
      ctx.fx.muzzleFlash(mech.muzzle, this.def.color, 1.1);
      ctx.sfx.laser(0.7);
      this.shotsFired++;
      this.fireTimer = (2.4 + Math.random()) / ctx.difficulty.aggression;
      // Relocate after a couple of shots.
      if (this.shotsFired % 2 === 0) { this.moveTarget = this.findFlankPoint(ctx); this.enter('flank'); }
      else this.enter('engage');
    }
    if (!sees && this.stateTime > 0.4 && this.stateTime < lockTime - 0.3) this.enter('flank');
  }

  // ------------------------------------------------------------- boss
  private updateBoss(ctx: AiContext, dt: number, sees: boolean, distance: number): void {
    const mech = this.mech!;
    if (this.bossPhase === 1 && this.health < this.maxHealth * 0.5) {
      this.bossPhase = 2;
      this.shieldTime = 4;
      mech.setShield(true);
      ctx.spawnEnemy('sentinel');
      ctx.spawnEnemy('sentinel');
      ctx.sfx.wave();
      ctx.fx.shockwave(this.position.add(new Vector3(0, 0.3, 0)), 8, [1, 0.3, 0.15], 0.8, 0.25);
    }
    if (this.shieldTime <= 0) mech.setShield(false);
    if (this.state !== 'engage' && this.state !== 'retreat') return;
    if (this.telegraph > 0) {
      this.telegraph -= dt;
      mech.setAlert(1);
      if (this.telegraph <= 0) this.bossAttack(ctx);
      return;
    }
    if (this.fireTimer <= 0 && (sees || this.attackCycle % 3 === 1)) {
      const kind = this.attackCycle % 3;
      this.telegraph = (kind === 1 ? 1.1 : 0.8) * ctx.difficulty.reaction;
      ctx.fx.orb(kind === 1 ? this.root : mech.muzzle, [1, 0.3, 0.1], kind === 1 ? 4 : 1.2, this.telegraph, true);
      if (kind === 1) ctx.sfx.slamWarning(); else ctx.sfx.telegraph();
      void distance;
    }
  }

  private bossAttack(ctx: AiContext): void {
    const mech = this.mech!;
    const kind = this.attackCycle++ % 3;
    const phaseSpeed = this.bossPhase === 2 ? 1.35 : 1;
    if (kind === 0) {
      // Homing missile barrage.
      const origin = this.muzzlePosition;
      const count = this.bossPhase === 2 ? 8 : 6;
      for (let i = 0; i < count; i++) {
        const spread = (i / (count - 1) - 0.5) * 1.6;
        const dir = this.aimAt(ctx, origin, 14);
        const c = Math.cos(spread), s = Math.sin(spread);
        const d = new Vector3(dir.x * c - dir.z * s, 0.55, dir.x * s + dir.z * c).normalize();
        ctx.fireProjectile(this, origin, d, { speed: 13 * phaseSpeed, damage: 9 * ctx.difficulty.damage, color: [1, 0.45, 0.15], size: 0.32, homing: 1.7, splash: 3, splashDamage: 6 * ctx.difficulty.damage, kind: 'missile' });
      }
      mech.kick(1);
      ctx.sfx.missile();
    } else if (kind === 1) {
      // Ground slam: an expanding ring the player has to jump over.
      const ring = MeshBuilder.CreateTorus(`slam-${this.id}`, { diameter: 1, thickness: 0.35, tessellation: 48 }, ctx.scene);
      const mat = new StandardMaterial(`slam-mat-${this.id}`, ctx.scene);
      mat.emissiveColor = new Color3(1, 0.35, 0.1);
      mat.disableLighting = true;
      mat.alpha = 0.9;
      ring.material = mat;
      ring.position.set(this.position.x, ctx.arena.deckY + 0.25, this.position.z);
      ring.isPickable = false;
      this.slamRing = { mesh: ring, radius: 1, hit: false };
      ctx.fx.explosion(this.position.add(new Vector3(0, 0.3, 0)), 1.2, [1, 0.5, 0.2]);
      ctx.sfx.impact();
      mech.land(14);
    } else {
      // Three shotgun volleys, fired from update() so pausing also pauses them.
      this.volleys.push(0, 0.32, 0.64);
    }
    this.fireTimer = (kind === 1 ? 2.2 : 2.6) / (ctx.difficulty.aggression * phaseSpeed);
  }

  private updateVolleys(ctx: AiContext, dt: number): void {
    for (let i = this.volleys.length - 1; i >= 0; i--) {
      this.volleys[i] -= dt;
      if (this.volleys[i] > 0) continue;
      this.volleys.splice(i, 1);
      const mech = this.mech!;
      {
        {
          const origin = this.muzzlePosition;
          const base = this.aimAt(ctx, origin, 34);
          for (let i = 0; i < 9; i++) {
            const dir = base.add(new Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.4)).normalize();
            ctx.fireProjectile(this, origin, dir, { speed: 34, damage: 4.5 * ctx.difficulty.damage, color: [1, 0.4, 0.15], size: 0.24 });
          }
          mech.kick(0.7);
          ctx.fx.muzzleFlash(mech.muzzle, [1, 0.5, 0.2], 1.6);
          ctx.sfx.shotgun();
        }
      }
    }
  }

  private updateSlam(ctx: AiContext, dt: number): void {
    const ring = this.slamRing!;
    ring.radius += dt * 13;
    ring.mesh.scaling.set(ring.radius * 2, 1, ring.radius * 2);
    (ring.mesh.material as StandardMaterial).alpha = Math.max(0, 0.9 - ring.radius / 26);
    const d = Math.hypot(ctx.player.position.x - ring.mesh.position.x, ctx.player.position.z - ring.mesh.position.z);
    if (!ring.hit && Math.abs(d - ring.radius) < 0.9 && ctx.player.airborneHeight < 0.55 && ctx.player.alive) {
      ring.hit = true;
      ctx.damagePlayer(22 * ctx.difficulty.damage, ring.mesh.position, 9, 'ONDA DE CHOQUE');
    }
    if (ring.radius > 24) { ring.mesh.material?.dispose(); ring.mesh.dispose(); this.slamRing = undefined; }
  }

  // ------------------------------------------------------------- wasp
  private updateWasp(ctx: AiContext, dt: number, sees: boolean): void {
    const wasp = this.wasp!;
    const pos = this.position;
    const player = ctx.player.position;
    const deck = ctx.arena.deckY;
    let target = pos.clone();
    let speed = this.def.speed;
    switch (this.state) {
      case 'spawn':
        target = new Vector3(pos.x, deck + this.altitude, pos.z);
        if (this.stateTime > 1.1) this.enter('engage');
        break;
      case 'engage':
      case 'patrol': {
        this.orbitAngle += dt * (speed / 12) * this.strafeSign * 0.8;
        if (Math.random() < dt * 0.15) this.strafeSign *= -1;
        const r = 11 + Math.sin(ctx.time * 0.7 + this.id) * 3;
        target = new Vector3(player.x + Math.cos(this.orbitAngle) * r, deck + this.altitude + Math.sin(ctx.time * 1.3 + this.id) * 1.2, player.z + Math.sin(this.orbitAngle) * r);
        // Fire pairs of fast bolts after a short eye flash.
        if (this.telegraph > 0) {
          this.telegraph -= dt;
          wasp.setAlert(1 - this.telegraph / (0.35 * ctx.difficulty.reaction));
          if (this.telegraph <= 0) {
            wasp.setAlert(0);
            if (sees) {
              for (let i = 0; i < 2; i++) {
                const origin = this.muzzlePosition;
                ctx.fireProjectile(this, origin, this.aimAt(ctx, origin, 44), { speed: 42, damage: 4 * ctx.difficulty.damage, color: [1, 0.3, 0.25], size: 0.17 });
              }
              ctx.sfx.enemyShot();
            }
            this.fireTimer = (1.7 + Math.random()) / ctx.difficulty.aggression;
          }
        } else if (this.fireTimer <= 0 && sees) {
          this.telegraph = 0.35 * ctx.difficulty.reaction;
        }
        if (this.fireTimer > 0) this.fireTimer -= dt;
        // Kamikaze dive when damaged or occasionally.
        const diveChance = (this.health < this.maxHealth * 0.5 ? 0.5 : 0.04) * ctx.difficulty.aggression;
        if (sees && this.stateTime > 2 && Math.random() < dt * diveChance) this.enter('dive');
        break;
      }
      case 'dive': {
        const wind = 0.9 * ctx.difficulty.reaction;
        if (this.stateTime < wind) {
          // Hover in place, flashing and beeping.
          target = pos.add(new Vector3(0, dt * 2, 0));
          wasp.setAlert(0.5 + 0.5 * Math.sin(this.stateTime * 30));
          if (Math.floor(this.stateTime * 6) !== Math.floor((this.stateTime - dt) * 6)) ctx.sfx.telegraph();
          this.diveTarget = player.add(new Vector3(0, 1.2, 0));
        } else {
          speed = 18;
          target = this.diveTarget;
          const d = Vector3.Distance(pos, ctx.player.position.add(new Vector3(0, 1.5, 0)));
          if (d < 2.4 || pos.y < deck + 0.8 || Vector3.Distance(pos, this.diveTarget) < 0.8 || this.stateTime > wind + 2.5) {
            this.health = 0;
            this.alive = false;
            this.killed = false;
            this.state = 'dead';
            ctx.explode(pos.clone(), 4.6, 26 * ctx.difficulty.damage, 'enemy');
            return;
          }
        }
        break;
      }
      case 'stagger':
        target = pos.clone();
        if (this.stateTime > 0.35) this.enter('engage');
        break;
      default: break;
    }
    // Keep inside the arena airspace and above cover.
    const toTarget = target.subtract(pos);
    const len = toTarget.length();
    const desired = len > 0.05 ? toTarget.scale(Math.min(1, len / 2) / len).scale(speed) : Vector3.Zero();
    this.velocity = Vector3.Lerp(this.velocity, desired, Math.min(1, dt * (this.state === 'dive' ? 6 : 3)));
    pos.addInPlace(this.velocity.add(this.push).scale(dt));
    this.push.scaleInPlace(Math.exp(-dt * 4));
    const radial = Math.hypot(pos.x, pos.z);
    if (radial > 36) { pos.x *= 36 / radial; pos.z *= 36 / radial; }
    if (this.state !== 'dive') pos.y = Math.max(deck + 2.8, pos.y);
    // Separation.
    for (const other of ctx.enemies) {
      if (other === this || !other.alive || !other.def.flying) continue;
      const away = pos.subtract(other.position);
      const d = away.length();
      if (d > 0.01 && d < 3) pos.addInPlace(away.scale((3 - d) / d * dt * 2));
    }
    const look = this.state === 'dive' && this.stateTime > 0.9 ? this.velocity : player.subtract(pos);
    this.yaw = Math.atan2(look.x, look.z);
    this.root.rotation.y = this.yaw;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    wasp.update(dt, new Vector3((this.velocity.x * c - this.velocity.z * s) / 10, 0, (this.velocity.x * s + this.velocity.z * c) / 10));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.laserSight?.material?.dispose();
    this.laserSight?.dispose();
    if (this.slamRing) { this.slamRing.mesh.material?.dispose(); this.slamRing.mesh.dispose(); this.slamRing = undefined; }
    this.mech?.dispose();
    this.wasp?.dispose();
  }

  /** Death presentation. Mechs come apart; drones explode. */
  die(ctx: Pick<AiContext, 'fx' | 'sfx'>, impulse: Vector3): void {
    this.laserSight?.setEnabled(false);
    if (this.mech) {
      this.mech.breakApart(impulse);
      ctx.fx.explosion(this.center, this.type === 'boss' ? 2.6 : 1.1, [1, 0.5, 0.2]);
    } else {
      ctx.fx.explosion(this.position.clone(), 0.8, [1, 0.4, 0.2]);
      this.wasp?.root.setEnabled(false);
    }
    ctx.sfx.explosion(this.type === 'boss' ? 1.6 : 1);
    if (this.slamRing) { this.slamRing.mesh.material?.dispose(); this.slamRing.mesh.dispose(); this.slamRing = undefined; }
  }
}
