import {
  Camera,
  Color3,
  DefaultRenderingPipeline,
  Engine,
  FreeCamera,
  GlowLayer,
  ImageProcessingConfiguration,
  InstancedMesh,
  Matrix,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { rayMech, raySphere, type Cover } from '../shared/arena';
import { aimOrigin, createMechState, stepMech, stepTrigger, switchWeapon, damageTaken, MOVE, type FireCommand, type MechInput, type MechState } from '../shared/sim';
import { WEAPONS, WEAPON_ORDER, damageAtDistance, laserDamage, spreadDirections, type WeaponId } from '../shared/weapons';
import { Sfx } from './audio';
import { DIFFICULTIES, ENEMY_DEFS, Enemy, type AiContext, type Difficulty, type EnemyType, type ProjectileOptions } from './drones';
import { Fx } from './fx';
import { createMech, type MechPalette, type MechVisual } from './mech';
import type { TouchControls } from './touch';
import type { Barrel, World } from './world';

export type GameMode = 'menu' | 'garage' | 'settings' | 'game' | 'pause' | 'result';
export type Session = 'training' | 'online';
type Rgb = [number, number, number];

export interface HudState {
  session: Session;
  health: number;
  energy: number;
  heat: number;
  overheated: boolean;
  charge: number;
  weapon: WeaponId;
  score: number;
  combo: number;
  comboTime: number;
  kills: number;
  wave: number;
  waveCount: number;
  enemiesLeft: number;
  objective: string;
  dashCooldown: number;
  shieldCooldown: number;
  impactCooldown: number;
  shield: boolean;
  fps: number;
}

export interface Marker { id: string; x: number; y: number; onScreen: boolean; health: number; name: string; boss: boolean; alert: boolean; distance: number; ally?: boolean }
export interface RadarState { yaw: number; x: number; z: number; contacts: Array<{ x: number; z: number; kind: 'enemy' | 'boss' | 'flyer' | 'pickup' | 'player' }> }
export interface ResultInfo { won: boolean; kicker: string; title: string; detail: string; score: number; stats: Array<[string, string]>; difficulty: Difficulty }

/** Remote/online targets that the local player can hit and render. */
export interface RemoteTarget { id: number; base: Vector3; alive: boolean; name: string; health: number; invulnerable: boolean }

export interface OnlineBridge {
  afterLocalStep(input: MechInput, dt: number): void;
  fire(cmd: FireCommand, origin: Vector3, dir: Vector3, seed: number, target?: number): void;
  weapon(weapon: WeaponId): void;
  impact(): void;
  update(dt: number): void;
  targets(): RemoteTarget[];
  /** Server-confirmed render offset for the local mech (reconciliation smoothing). */
  renderOffset(): Vector3;
  canAct(): boolean;
  objective(): string;
  leave(): void;
}

interface Projectile {
  mesh: InstancedMesh;
  pos: Vector3;
  vel: Vector3;
  damage: number;
  hostile: boolean;
  owner?: Enemy;
  ttl: number;
  radius: number;
  homing: number;
  target?: Enemy | 'player';
  splash: number;
  splashDamage: number;
  kind: 'bolt' | 'missile';
  color: Rgb;
  trail: number;
  /** Online missiles are rendered only; the server owns their damage. */
  visualOnly?: boolean;
  netId?: number;
}

interface Pickup { node: TransformNode; ring: Mesh; position: Vector3; landed: boolean; t: number }

interface WaveDef { title: string; subtitle: string; spawns: EnemyType[] }

const WAVES: WaveDef[] = [
  { title: 'ONDA 1', subtitle: 'RECONHECIMENTO', spawns: ['sentinel', 'sentinel', 'wasp'] },
  { title: 'ONDA 2', subtitle: 'ENXAME', spawns: ['sentinel', 'wasp', 'wasp', 'sentinel', 'wasp'] },
  { title: 'ONDA 3', subtitle: 'LINHA PESADA', spawns: ['brute', 'sentinel', 'sniper', 'wasp', 'sentinel'] },
  { title: 'ONDA 4', subtitle: 'ARTILHARIA', spawns: ['sniper', 'brute', 'sentinel', 'wasp', 'sniper', 'wasp', 'sentinel'] },
  { title: 'ONDA FINAL', subtitle: 'O COLOSSO', spawns: ['boss', 'wasp', 'wasp'] },
];

export class CombatGame {
  readonly camera: FreeCamera;
  readonly player: MechVisual;
  readonly fx: Fx;
  readonly sfx = new Sfx();
  mode: GameMode = 'menu';
  session: Session = 'training';
  difficulty: Difficulty = 'veteran';
  state: MechState;
  touch?: TouchControls;
  online?: OnlineBridge;
  /** When set (smoke tests), aim follows the closest target automatically. */
  debugAutoAim = false;

  onHud?: (state: HudState) => void;
  onResult?: (result: ResultInfo) => void;
  onToast?: (message: string) => void;
  onHit?: (critical: boolean, kill: boolean) => void;
  onDamage?: (angle: number, amount: number) => void;
  onPause?: () => void;
  onBanner?: (title: string, subtitle: string) => void;
  onFloat?: (x: number, y: number, text: string, kind: 'hit' | 'crit' | 'kill' | 'heal') => void;
  onMarkers?: (markers: Marker[]) => void;
  onRadar?: (radar: RadarState) => void;
  onFeed?: (text: string) => void;
  onWeapon?: (weapon: WeaponId) => void;

  private readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly canvas: HTMLCanvasElement;
  private readonly glow: GlowLayer;
  private readonly pipeline: DefaultRenderingPipeline;
  private readonly enemies: Enemy[] = [];
  private readonly dying: Array<{ enemy: Enemy; ttl: number }> = [];
  private readonly projectiles: Projectile[] = [];
  private readonly projectileTemplates = new Map<string, Mesh>();
  private readonly pickups: Pickup[] = [];
  private readonly pendingExplosions: Array<{ at: Vector3; radius: number; damage: number; source: 'enemy' | 'player' | 'barrel' }> = [];
  private yaw = 0;
  private pitch = 0.12;
  private orbit = 0;
  private orbitDistance = 8;
  private dragX = 0;
  private mouseFiring = false;
  private sensitivity = 1;
  private time = 0;
  private hudTimer = 0;
  private radarTimer = 0;
  private wasPointerLocked = false;
  private weapon: WeaponId = 'mg';
  // Training state.
  private score = 0;
  private kills = 0;
  private combo = 1;
  private comboTime = 0;
  private waveIndex = -1;
  private waveActive = false;
  private waveQueue: EnemyType[] = [];
  private spawnTimer = 0;
  private intermission = 0;
  private finished = false;
  private resultTimer = 0;
  private pendingResult: ResultInfo | null = null;
  private timeScale = 1;
  private slowMo = 0;
  private stats = { shots: 0, hits: 0, damageDealt: 0, damageTaken: 0, time: 0, crits: 0 };
  private chargingSound = false;
  private lastStep = 0;
  private jetSound = 0;
  private cameraPos = new Vector3(8, 5, 8);
  private fovKick = 0;
  private aberration = 0;
  private onlineLock: number | undefined;
  private playerDown = false;
  private lastHurt = 0;

  constructor(
    private readonly scene: Scene,
    private readonly engine: Engine,
    canvas: HTMLCanvasElement,
    readonly world: World,
    palette: MechPalette,
  ) {
    this.canvas = canvas;
    this.player = createMech(scene, palette, 'player', 'mg');
    this.player.root.position.copyFrom(world.spawn);
    this.state = createMechState(world.spawn.x, world.spawn.y, world.spawn.z, 0);
    this.camera = new FreeCamera('combat-camera', new Vector3(8, 5, 8), scene);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 600;
    this.camera.fov = 0.84;
    this.camera.inputs.clear();
    scene.activeCamera = this.camera;
    this.fx = new Fx(scene);

    this.glow = new GlowLayer('mm-glow', scene, { mainTextureSamples: 1, blurKernelSize: 32 });
    this.glow.intensity = 0.65;
    this.pipeline = new DefaultRenderingPipeline('mm-pipeline', true, scene, [this.camera]);
    this.pipeline.samples = 1;
    this.pipeline.fxaaEnabled = true;
    this.pipeline.bloomEnabled = true;
    this.pipeline.bloomThreshold = 0.82;
    this.pipeline.bloomWeight = 0.28;
    this.pipeline.bloomKernel = 48;
    this.pipeline.bloomScale = 0.5;
    this.pipeline.imageProcessingEnabled = true;
    const ip = this.pipeline.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.08;
    ip.contrast = 1.18;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 1.6;
    ip.vignetteColor.set(0.02, 0.05, 0.09, 1);
    this.pipeline.chromaticAberrationEnabled = true;
    this.pipeline.chromaticAberration.aberrationAmount = 0;

    this.installInput();
    this.updateCamera(0);
  }

  // ------------------------------------------------------------------ setup
  setMode(mode: GameMode): void {
    this.mode = mode;
    this.mouseFiring = false;
    this.touch?.reset();
    this.player.setShowcase(mode === 'menu' || mode === 'settings');
    if (mode !== 'game' && document.pointerLockElement === this.canvas) document.exitPointerLock();
    if (mode !== 'game') { this.sfx.setJet(0); this.sfx.stopCharge(); this.chargingSound = false; }
    this.touch?.setVisible(mode === 'game' && this.touchMode());
    if (mode === 'menu' || mode === 'garage' || mode === 'settings') {
      this.clearCombat();
      this.player.root.setEnabled(true);
      this.player.root.position.copyFrom(this.world.spawn);
      this.player.root.rotation.y = -0.35;
      this.player.setShield(false);
      this.player.setWeapon(this.weapon);
      this.world.resetBarrels(false);
      this.sfx.ambience(false);
    }
    this.updateCamera(0);
  }

  private touchMode(): boolean {
    return !!this.touch && document.body.classList.contains('touch-mode');
  }

  setPalette(palette: MechPalette): void { this.player.setPalette(palette); }
  setSensitivity(value: number): void { this.sensitivity = Math.min(2.5, Math.max(0.3, value)); }
  setSound(enabled: boolean): void { this.sfx.setEnabled(enabled); }
  setDifficulty(difficulty: Difficulty): void { this.difficulty = difficulty; }

  setWeapon(weapon: WeaponId): void {
    this.weapon = weapon;
    this.player.setWeapon(weapon);
    if (switchWeapon(this.state, weapon) && this.mode === 'game') {
      this.sfx.swap();
      this.online?.weapon(weapon);
    }
    this.onWeapon?.(weapon);
  }

  get currentWeapon(): WeaponId { return this.weapon; }

  cycleWeapon(direction: number): void {
    const index = WEAPON_ORDER.indexOf(this.weapon);
    this.setWeapon(WEAPON_ORDER[(index + direction + WEAPON_ORDER.length) % WEAPON_ORDER.length]);
  }

  setQuality(quality: 'high' | 'medium' | 'low'): void {
    const targetPixelRatio = quality === 'high' ? Math.min(window.devicePixelRatio, 1.5) : quality === 'medium' ? 1 : 0.7;
    this.engine.setHardwareScalingLevel(window.devicePixelRatio / targetPixelRatio);
    this.scene.shadowsEnabled = quality !== 'low';
    this.glow.isEnabled = quality !== 'low';
    this.pipeline.bloomEnabled = quality === 'high';
    this.pipeline.fxaaEnabled = quality !== 'low';
    this.pipeline.chromaticAberrationEnabled = quality === 'high';
    this.fx.setQuality(quality);
    this.world.setQuality(quality);
  }

  // ---------------------------------------------------------------- session
  start(): void {
    this.session = 'training';
    this.online = undefined;
    this.resetPlayer(this.world.spawn, 0);
    this.score = 0;
    this.kills = 0;
    this.combo = 1;
    this.comboTime = 0;
    this.waveIndex = -1;
    this.waveActive = false;
    this.waveQueue = [];
    this.intermission = 1.6;
    this.finished = false;
    this.pendingResult = null;
    this.stats = { shots: 0, hits: 0, damageDealt: 0, damageTaken: 0, time: 0, crits: 0 };
    this.world.resetBarrels(true);
    this.setMode('game');
    this.onBanner?.('TREINAMENTO', `FROZEN OUTPOST · ${DIFFICULTIES[this.difficulty].label}`);
    this.onToast?.('SOBREVIVA ÀS 5 ONDAS E DERRUBE O COLOSSO');
    this.sfx.unlock();
    this.sfx.ambience(true, this.world.theme === 'storm');
    this.updateHud();
    this.requestLock();
  }

  /** Enter an online match; the bridge owns networking and remote players. */
  startOnline(bridge: OnlineBridge, spawn: Vector3, yaw: number): void {
    this.session = 'online';
    this.online = bridge;
    this.resetPlayer(spawn, yaw);
    this.score = 0;
    this.kills = 0;
    this.finished = false;
    this.pendingResult = null;
    this.world.resetBarrels(false);
    this.setMode('game');
    this.sfx.unlock();
    this.sfx.ambience(true, this.world.theme === 'storm');
    this.updateHud();
    this.requestLock();
  }

  private resetPlayer(at: Vector3, yaw: number): void {
    this.clearCombat();
    this.state = createMechState(at.x, at.y, at.z, yaw, this.weapon);
    this.yaw = yaw;
    this.pitch = 0.12;
    this.playerDown = false;
    this.player.root.setEnabled(true);
    this.player.setShield(false);
    this.player.setWeapon(this.weapon);
    this.player.root.position.copyFrom(at);
    this.player.root.rotation.y = yaw;
    this.timeScale = 1;
    this.slowMo = 0;
  }

  /** Teleport after an online respawn. */
  respawnAt(at: Vector3, yaw: number): void {
    this.state.x = at.x; this.state.y = at.y; this.state.z = at.z;
    this.state.vx = this.state.vy = this.state.vz = 0;
    this.state.health = MOVE.maxHealth;
    this.yaw = yaw;
    this.playerDown = false;
    this.player.root.setEnabled(true);
    this.fx.pillar(at, [0.4, 0.9, 1], 1);
  }

  /** Online: the server says we died. */
  localDeath(): void {
    if (this.playerDown) return;
    this.playerDown = true;
    this.fx.explosion(this.player.root.position.add(new Vector3(0, 1.8, 0)), 1.4);
    this.sfx.explosion(1.2);
    this.player.root.setEnabled(false);
  }

  private requestLock(): void {
    if (this.touchMode()) return;
    try { void this.canvas.requestPointerLock?.(); } catch { /* not available */ }
  }

  private clearCombat(): void {
    for (const enemy of this.enemies) enemy.dispose();
    this.enemies.length = 0;
    for (const d of this.dying) d.enemy.dispose();
    this.dying.length = 0;
    for (const p of this.projectiles) p.mesh.dispose();
    this.projectiles.length = 0;
    for (const p of this.pickups) { p.node.dispose(false, true); p.ring.dispose(); }
    this.pickups.length = 0;
    this.pendingExplosions.length = 0;
    this.fx.clear();
  }

  pause(): void {
    if (this.mode !== 'game') return;
    if (this.session === 'online') { this.onPause?.(); this.mode = 'pause'; this.mouseFiring = false; this.touch?.setVisible(false); if (document.pointerLockElement === this.canvas) document.exitPointerLock(); return; }
    this.setMode('pause');
    this.onPause?.();
  }

  resume(): void {
    if (this.mode !== 'pause') return;
    this.mode = 'game';
    this.touch?.setVisible(this.touchMode());
    this.requestLock();
  }

  leaveSession(): void {
    this.online?.leave();
    this.online = undefined;
    this.session = 'training';
  }

  // ------------------------------------------------------------------ loop
  update(rawDt: number): void {
    const realDt = Math.min(0.05, rawDt);
    this.slowMo = Math.max(0, this.slowMo - realDt);
    this.timeScale += ((this.slowMo > 0 ? 0.3 : 1) - this.timeScale) * Math.min(1, realDt * 8);
    const dt = realDt * this.timeScale;
    this.time += dt;
    const online = this.session === 'online' && this.online;
    if (this.mode === 'game' || (online && this.mode === 'pause')) {
      this.updatePlayer(dt, this.mode === 'game');
      if (this.session === 'training') {
        this.updateTraining(dt);
      } else {
        this.online?.update(dt);
      }
      this.updateProjectiles(dt);
      this.flushExplosions();
      this.hudTimer += realDt;
      if (this.hudTimer > 0.08) { this.updateHud(); this.hudTimer = 0; }
      this.radarTimer += realDt;
      if (this.radarTimer > 0.1) { this.updateRadar(); this.radarTimer = 0; }
      this.updateMarkers();
      if (this.pendingResult) {
        this.resultTimer -= realDt;
        if (this.resultTimer <= 0) { const result = this.pendingResult; this.pendingResult = null; this.setMode('result'); this.onResult?.(result); }
      }
    } else if (this.mode === 'menu' || this.mode === 'garage' || this.mode === 'settings') {
      this.player.animate(realDt, { forward: 0, lateral: 0, aim: 0.05 });
      if (this.mode === 'menu') this.orbit += realDt * 0.075;
      else if (this.mode === 'garage' && !(this.dragX > 0)) this.orbit += realDt * 0.18;
    } else if (this.mode === 'result') {
      for (const enemy of this.enemies) enemy.mech?.animate(realDt, 0);
    }
    this.fx.update(dt);
    this.updateCamera(realDt);
    this.world.update(realDt, this.time, this.camera.position);
    this.aberration = Math.max(0, this.aberration - realDt * 40);
    if (this.pipeline.chromaticAberrationEnabled) this.pipeline.chromaticAberration.aberrationAmount = this.aberration;
  }

  // ----------------------------------------------------------------- input
  private installInput(): void {
    window.addEventListener('keydown', (event) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.code) && this.mode === 'game') event.preventDefault();
      this.keys.add(event.code);
      if (event.code === 'Escape' && this.mode === 'game') { this.pause(); return; }
      if (event.repeat || this.mode !== 'game') return;
      this.pressed.add(event.code);
      const slot = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(event.code);
      if (slot >= 0) this.setWeapon(WEAPON_ORDER[slot]);
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseFiring = false; if (this.mode === 'game' && !this.touchMode()) this.pause(); });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (!locked) this.mouseFiring = false;
      if (!locked && this.wasPointerLocked && this.mode === 'game') this.pause();
      this.wasPointerLocked = locked;
    });
    this.canvas.addEventListener('mousedown', (event) => {
      this.sfx.unlock();
      if (this.mode === 'game' && event.button === 0 && !this.touchMode()) {
        if (document.pointerLockElement !== this.canvas) this.requestLock();
        this.mouseFiring = true;
      }
      if (this.mode === 'garage') this.dragX = event.clientX;
    });
    window.addEventListener('mouseup', (event) => { if (event.button === 0) { this.mouseFiring = false; this.dragX = 0; } });
    window.addEventListener('mousemove', (event) => {
      if (this.mode === 'game' && document.pointerLockElement === this.canvas) {
        this.yaw += event.movementX * 0.0024 * this.sensitivity;
        this.pitch = Math.max(-0.42, Math.min(0.78, this.pitch + event.movementY * 0.002 * this.sensitivity));
      } else if (this.mode === 'garage' && event.buttons & 1) {
        this.orbit += (event.clientX - this.dragX) * 0.006;
        this.dragX = event.clientX;
      }
    });
    // Touch drag to rotate the garage turntable.
    let garageTouch: number | null = null;
    this.canvas.addEventListener('pointerdown', (event) => {
      if (this.mode === 'garage' && event.pointerType !== 'mouse') { garageTouch = event.clientX; this.dragX = 1; }
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (this.mode === 'garage' && garageTouch !== null && event.pointerType !== 'mouse') { this.orbit += (event.clientX - garageTouch) * 0.008; garageTouch = event.clientX; }
    });
    window.addEventListener('pointerup', () => { garageTouch = null; if (this.mode === 'garage') this.dragX = 0; });
    this.canvas.addEventListener('wheel', (event) => {
      if (this.mode === 'garage') {
        event.preventDefault();
        this.orbitDistance = Math.max(4.2, Math.min(12, this.orbitDistance + Math.sign(event.deltaY) * 0.75));
      } else if (this.mode === 'game') {
        event.preventDefault();
        this.cycleWeapon(Math.sign(event.deltaY));
      }
    }, { passive: false });
  }

  private consumePressed(code: string): boolean {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  private gatherInput(active: boolean): { input: MechInput; firing: boolean; impact: boolean } {
    const touch = this.touch?.isVisible ? this.touch : undefined;
    if (touch) {
      const look = touch.consumeLook();
      this.yaw += look.dx * 0.0062 * this.sensitivity;
      this.pitch = Math.max(-0.42, Math.min(0.78, this.pitch + look.dy * 0.0052 * this.sensitivity));
    }
    if (this.debugAutoAim) this.autoAim();
    let mx = 0, mz = 0;
    if (active) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
      if (touch) { mx += touch.moveX; mz += touch.moveY; }
    }
    const touchSprint = touch ? Math.hypot(touch.moveX, touch.moveY) > 0.92 : false;
    const swap = touch?.consume('swap') ?? false;
    if (swap && active) this.cycleWeapon(1);
    if (touch?.consume('pause')) this.pause();
    const can = active && !this.playerDown && (this.online?.canAct() ?? true);
    const input: MechInput = {
      mx: can ? mx : 0,
      mz: can ? mz : 0,
      yaw: this.yaw,
      pitch: this.pitch,
      sprint: can && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || touchSprint),
      jump: can && (this.keys.has('Space') || (touch?.jump ?? false)),
      dash: can && (this.consumePressed('KeyQ') || (touch?.consume('dash') ?? false)),
      shield: can && (this.consumePressed('KeyE') || (touch?.consume('shield') ?? false)),
    };
    const impact = can && (this.consumePressed('KeyF') || (touch?.consume('impact') ?? false));
    if (this.consumePressed('KeyR') && can) this.cycleWeapon(1);
    this.pressed.clear();
    return { input, firing: can && (this.mouseFiring || (touch?.fire ?? false) || this.keys.has('KeyJ')), impact };
  }

  // ---------------------------------------------------------------- player
  private updatePlayer(dt: number, active: boolean): void {
    const s = this.state;
    const { input, firing, impact } = this.gatherInput(active);
    if (this.playerDown) { input.mx = input.mz = 0; input.jump = false; }
    const events = stepMech(s, input, dt, this.world.arena);
    this.online?.afterLocalStep(input, dt);
    if (events.jumped) this.sfx.jump();
    if (events.landed) { this.player.land(events.landed); this.sfx.land(events.landed / 4); if (events.landed > 9) this.fx.shockwave(new Vector3(s.x, s.y + 0.1, s.z), 2.4, [0.8, 0.9, 1], 0.35, 0.08); this.fx.shake(Math.min(0.2, events.landed * 0.012)); }
    if (events.dashed) { this.sfx.dash(); this.fx.shake(0.12); this.fovKick = 0.12; this.dashTrail(); }
    if (events.shield) { this.sfx.shield(); this.onToast?.('ESCUDO DE ENERGIA ATIVO'); }
    this.player.setShield(s.shieldTime > 0);
    this.jetSound += ((s.jetting ? 1 : s.dashTime > 0 ? 0.6 : 0) - this.jetSound) * Math.min(1, dt * 10);
    this.sfx.setJet(this.jetSound);

    if (!this.playerDown) {
      const fire = stepTrigger(s, firing, dt);
      const def = WEAPONS[s.weapon];
      if (def.kind === 'charge') {
        if (s.charge > 0 && !this.chargingSound) { this.sfx.startCharge(); this.chargingSound = true; }
        if (s.charge > 0) this.sfx.setCharge(s.charge / def.chargeTime);
        if (s.charge <= 0 && this.chargingSound) { this.sfx.stopCharge(); this.chargingSound = false; }
      } else if (this.chargingSound) { this.sfx.stopCharge(); this.chargingSound = false; }
      this.player.setCharge(def.kind === 'charge' ? s.charge / def.chargeTime : 0);
      if (fire) this.fireWeapon(fire);
      if (s.overheated && s.sinceShot < dt * 1.5) { this.sfx.overheat(); this.onToast?.('ARMA SUPERAQUECIDA'); }
      if (impact) this.impact();
    }

    // Visual sync.
    const offset = this.online?.renderOffset() ?? Vector3.Zero();
    this.player.root.position.set(s.x + offset.x, s.y + offset.y, s.z + offset.z);
    this.player.root.rotation.y = this.yaw;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const forward = s.vx * sin + s.vz * cos;
    const lateral = s.vx * cos - s.vz * sin;
    this.player.animate(dt, { forward, lateral, airborne: !s.grounded, jet: s.jetting ? 1 : 0, aim: this.aimPitch(), sprint: input.sprint, dash: s.dashTime > 0 });
    const step = (this.player.root.metadata?.step ?? 0) as number;
    if (step !== this.lastStep) { this.lastStep = step; this.sfx.step(); }
    if (s.jetting && Math.random() < dt * 30) this.fx.sparks(this.player.root.position.add(new Vector3(-sin * 0.7, 1.9, -cos * 0.7)), [0.5, 0.9, 1], 2, 0.4);
  }

  private dashTrail(): void {
    const s = this.state;
    for (let i = 0; i < 4; i++) {
      const p = new Vector3(s.x - s.dashX * i * 0.9, s.y + 1.8, s.z - s.dashZ * i * 0.9);
      this.fx.orb(p, [0.4, 0.85, 1], 1.4 - i * 0.2, 0.25 + i * 0.05);
    }
  }

  /** Arm pitch that points the weapon at the crosshair target. */
  private aimPitch(): number {
    return Math.max(-0.7, Math.min(0.9, this.pitch * 1.1 - 0.05));
  }

  private autoAim(): void {
    const origin = this.camera.position;
    let best: Vector3 | null = null;
    let bestD = Infinity;
    for (const t of this.collectTargets()) {
      if (!t.alive) continue;
      const c = t.flying ? t.base : t.base.add(new Vector3(0, 1.7 * t.scale, 0));
      const d = Vector3.Distance(this.player.root.position, c);
      if (d < bestD && this.world.arena.lineOfSight(aimOrigin(this.state), c)) { bestD = d; best = c; }
    }
    if (!best) return;
    const dir = best.subtract(origin).normalize();
    this.yaw = Math.atan2(dir.x, dir.z);
    // Camera looks along (sin yaw cos p, -sin p, cos yaw cos p).
    this.pitch = Math.max(-0.42, Math.min(0.78, Math.asin(-dir.y)));
  }

  // --------------------------------------------------------------- targets
  private collectTargets(): Array<{ kind: 'enemy' | 'remote'; base: Vector3; scale: number; flying: boolean; alive: boolean; enemy?: Enemy; remote?: RemoteTarget }> {
    const out: Array<{ kind: 'enemy' | 'remote'; base: Vector3; scale: number; flying: boolean; alive: boolean; enemy?: Enemy; remote?: RemoteTarget }> = [];
    for (const enemy of this.enemies) if (enemy.alive && enemy.state !== 'spawn') out.push({ kind: 'enemy', base: enemy.position, scale: enemy.scale, flying: enemy.def.flying, alive: true, enemy });
    if (this.online) for (const r of this.online.targets()) if (r.alive) out.push({ kind: 'remote', base: r.base, scale: 1, flying: false, alive: true, remote: r });
    return out;
  }

  private barrelHit(origin: Vector3, dir: Vector3, maxT: number): { barrel: Barrel; t: number } | null {
    let best: { barrel: Barrel; t: number } | null = null;
    for (const barrel of this.world.barrels) {
      if (!barrel.alive) continue;
      const t = rayBoxCover(origin, dir, maxT, this.world.deckY, barrel.cover);
      if (t !== null && (!best || t < best.t)) best = { barrel, t };
    }
    return best;
  }

  /** Camera ray → world point under the crosshair. */
  private aimPoint(): Vector3 {
    const ray = this.camera.getForwardRay(200);
    let t = 200;
    for (const target of this.collectTargets()) {
      const hit = target.flying ? (() => { const v = raySphere(ray.origin, ray.direction, t, target.base, 1.2); return v === null ? null : { t: v }; })() : rayMech(ray.origin, ray.direction, t, target.base, target.scale);
      if (hit && hit.t < t && hit.t > 3) t = hit.t;
    }
    const cover = this.world.raycastCover(ray.origin, ray.direction, t);
    if (cover !== null && cover > 2) t = Math.min(t, cover);
    if (ray.direction.y < -0.01) {
      const deckT = (this.world.deckY - ray.origin.y) / ray.direction.y;
      if (deckT > 2) t = Math.min(t, deckT);
    }
    return ray.origin.add(ray.direction.scale(t));
  }

  // --------------------------------------------------------------- weapons
  private fireWeapon(cmd: FireCommand): void {
    const def = WEAPONS[cmd.weapon];
    const o = aimOrigin(this.state);
    const origin = new Vector3(o.x, o.y, o.z);
    const target = this.aimPoint();
    const dir = target.subtract(origin).normalize();
    // Machine-gun bloom.
    if (this.state.bloom > 0) {
      dir.x += (Math.random() - 0.5) * this.state.bloom * 2;
      dir.y += (Math.random() - 0.5) * this.state.bloom * 2;
      dir.z += (Math.random() - 0.5) * this.state.bloom * 2;
      dir.normalize();
    }
    const muzzle = this.player.muzzle.getAbsolutePosition();
    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.player.kick(def.recoil);
    this.fx.shake(def.shake);
    this.fx.muzzleFlash(this.player.muzzle, def.color, def.id === 'shotgun' ? 1.2 : def.id === 'laser' ? 0.6 + cmd.charge : 0.65);
    this.pitch = Math.max(-0.42, this.pitch - def.recoil * 0.025);
    this.stats.shots++;

    if (def.id === 'missile') {
      const lock = this.findLock(origin, dir);
      this.sfx.missile();
      if (this.session === 'online') { this.online?.fire(cmd, origin, dir, seed, this.onlineLock); return; }
      const p = this.spawnProjectile(muzzle, dir, { speed: def.projectileSpeed, damage: def.damage, color: def.color, size: 0.34, homing: lock ? def.homing : 0, splash: def.splashRadius, splashDamage: def.splashDamage, kind: 'missile' }, false);
      if (lock) p.target = lock;
      return;
    }

    const directions = def.pellets > 1 ? spreadDirections(dir, def.pellets, def.spread, seed) : [{ x: dir.x, y: dir.y, z: dir.z }];
    const ends: Vector3[] = [];
    const damageByTarget = new Map<Enemy, { amount: number; crit: boolean; at: Vector3 }>();
    for (const d of directions) {
      const pd = new Vector3(d.x, d.y, d.z);
      const range = def.range;
      const coverT = this.world.raycastCover(origin, pd, range);
      const barrel = this.barrelHit(origin, pd, coverT ?? range);
      let limit = barrel ? barrel.t : coverT ?? range;
      if (pd.y < -0.01) { const deckT = (this.world.deckY - origin.y) / pd.y; if (deckT > 0) limit = Math.min(limit, deckT); }
      const hits: Array<{ t: number; crit: boolean; enemy?: Enemy; remote?: RemoteTarget }> = [];
      for (const target of this.collectTargets()) {
        const hit = target.flying ? (() => { const v = raySphere(origin, pd, limit, target.base, 1.15); return v === null ? null : { t: v, critical: false }; })() : rayMech(origin, pd, limit, target.base, target.scale);
        if (hit) hits.push({ t: hit.t, crit: hit.critical, enemy: target.enemy, remote: target.remote });
      }
      hits.sort((a, b) => a.t - b.t);
      const applied = def.pierce ? hits : hits.slice(0, 1);
      let endT = limit;
      if (!def.pierce && applied.length) endT = applied[0].t;
      for (const hit of applied) {
        const at = origin.add(pd.scale(hit.t));
        const base = def.kind === 'charge' ? laserDamage(cmd.charge) : damageAtDistance(def, def.damage, hit.t);
        const amount = base * (hit.crit ? 1.5 : 1);
        if (hit.enemy) {
          const entry = damageByTarget.get(hit.enemy) ?? { amount: 0, crit: false, at };
          entry.amount += amount;
          entry.crit ||= hit.crit;
          damageByTarget.set(hit.enemy, entry);
        } else if (hit.remote) {
          this.onHit?.(hit.crit, false);
        }
        this.fx.sparks(at, def.color, def.id === 'laser' ? 18 : 6, 0.8);
      }
      const end = origin.add(pd.scale(endT));
      ends.push(end);
      if (applied.length === 0 || def.pierce) {
        if (barrel && endT >= barrel.t - 0.01 && this.session === 'training') this.damageBarrel(barrel.barrel, def.kind === 'charge' ? laserDamage(cmd.charge) : def.damage, 'player');
        if (endT < range - 0.5) this.fx.sparks(end, [1, 0.85, 0.6], def.id === 'shotgun' ? 2 : 5, 0.6);
      }
    }
    // Visuals: tracers / pellets / beam.
    if (def.id === 'laser') {
      const width = 0.12 + cmd.charge * 0.22;
      this.fx.beam(muzzle, ends[0], def.color, width);
      this.sfx.laser(cmd.charge);
      this.fx.shake(cmd.charge * 0.25);
      this.aberration = Math.max(this.aberration, 6 * cmd.charge);
    } else if (def.id === 'shotgun') {
      for (const end of ends) this.fx.tracer(muzzle, end, def.color, 0.035, 0.08);
      this.sfx.shotgun();
      this.fovKick = Math.max(this.fovKick, 0.05);
    } else {
      this.fx.tracer(muzzle, ends[0], def.color, 0.055, 0.07);
      this.sfx.mg();
    }

    if (this.session === 'online') {
      this.online?.fire(cmd, origin, dir, seed);
      return;
    }
    if (damageByTarget.size) this.stats.hits++;
    for (const [enemy, info] of damageByTarget) this.damageEnemy(enemy, info.amount, info.crit, info.at, def.knockback * Math.min(1, info.amount / (def.damage * def.pellets * 0.6)), origin);
  }

  private findLock(origin: Vector3, dir: Vector3): Enemy | null {
    let best: Enemy | null = null;
    let bestAngle = 0.22;
    this.onlineLock = undefined;
    for (const target of this.collectTargets()) {
      const c = target.flying ? target.base : target.base.add(new Vector3(0, 1.8 * target.scale, 0));
      const to = c.subtract(origin);
      const d = to.length();
      if (d > 90) continue;
      const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(to.scale(1 / d), dir))));
      if (angle < bestAngle && this.world.arena.lineOfSight(origin, c)) {
        bestAngle = angle;
        best = target.enemy ?? null;
        this.onlineLock = target.remote?.id;
      }
    }
    return best;
  }

  private impact(): void {
    const s = this.state;
    if (s.impactCd > 0 || s.energy < MOVE.impactCost) return;
    s.impactCd = MOVE.impactCooldown;
    s.energy -= MOVE.impactCost;
    s.energyDelay = MOVE.energyDelay;
    // Short lunge.
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    s.pushX += fx * 9;
    s.pushZ += fz * 9;
    this.player.punch();
    this.sfx.impact();
    this.fx.shake(0.25);
    const front = new Vector3(s.x + fx * 2.2, s.y + 1.4, s.z + fz * 2.2);
    this.fx.shockwave(front, 2.6, [0.5, 0.9, 1], 0.3, 0.2);
    this.fx.sparks(front, [0.6, 0.95, 1], 20, 1.2);
    if (this.session === 'online') { this.online?.impact(); return; }
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const to = enemy.position.subtract(new Vector3(s.x, enemy.position.y, s.z));
      const d = to.length();
      const reach = 3.8 + enemy.scale * 0.8;
      if (d > reach || (enemy.def.flying && enemy.position.y - s.y > 4)) continue;
      const dot = (to.x * fx + to.z * fz) / Math.max(0.01, d);
      if (dot < 0.35 && d > 1.5) continue;
      this.damageEnemy(enemy, 38, false, enemy.center, 6, new Vector3(s.x, s.y, s.z));
    }
    for (const barrel of this.world.barrels) {
      if (barrel.alive && Vector3.Distance(barrel.position, new Vector3(s.x, s.y, s.z)) < 3.2) this.damageBarrel(barrel, 40, 'player');
    }
  }

  // --------------------------------------------------------------- damage
  private damageEnemy(enemy: Enemy, amount: number, crit: boolean, at: Vector3, knockback: number, from: Vector3): void {
    if (!enemy.alive) return;
    const killed = enemy.takeDamage(amount, from, knockback);
    this.stats.damageDealt += amount;
    if (crit) this.stats.crits++;
    this.score += Math.round(amount * (crit ? 1.5 : 1));
    this.sfx.hit(crit);
    this.float(at, `${Math.round(amount)}`, crit ? 'crit' : 'hit');
    this.onHit?.(crit, killed);
    if (killed) this.killEnemy(enemy, from);
  }

  private killEnemy(enemy: Enemy, from: Vector3): void {
    this.kills++;
    this.combo = this.comboTime > 0 ? Math.min(5, this.combo + 1) : 1;
    this.comboTime = 4.5;
    const points = enemy.def.score * this.combo;
    this.score += points;
    const impulse = enemy.position.subtract(from);
    impulse.y = 0;
    enemy.die(this, impulse.lengthSquared() > 0 ? impulse.normalize().scale(4) : Vector3.Zero());
    this.dying.push({ enemy, ttl: 3.6 });
    this.float(enemy.center.add(new Vector3(0, 1, 0)), `+${points}${this.combo > 1 ? ` ×${this.combo}` : ''}`, 'kill');
    this.onFeed?.(`${enemy.def.name} DESTRUÍDO${this.combo > 1 ? ` · COMBO ×${this.combo}` : ''}`);
    this.sfx.kill();
    if (enemy.type === 'boss') this.slowMo = 1.4;
  }

  private damageBarrel(barrel: Barrel, amount: number, source: 'player' | 'enemy' | 'barrel'): void {
    if (!barrel.alive) return;
    barrel.health -= amount;
    this.fx.sparks(barrel.position.add(new Vector3(0, 0.8, 0)), [1, 0.6, 0.2], 5, 0.6);
    if (barrel.health > 0) return;
    this.world.destroyBarrel(barrel);
    void source;
    this.pendingExplosions.push({ at: barrel.position.add(new Vector3(0, 0.7, 0)), radius: 5.5, damage: 70, source: 'barrel' });
  }

  private damagePlayer(amount: number, from: Vector3, knockback: number, source: string): void {
    if (this.session !== 'training' || this.playerDown || this.finished) return;
    const s = this.state;
    const taken = damageTaken(s, amount);
    if (taken <= 0) return;
    if (s.shieldTime > 0) this.sfx.shieldHit(); else this.sfx.playerHurt();
    s.health = Math.max(0, s.health - taken);
    this.lastHurt = this.time;
    this.stats.damageTaken += taken;
    this.player.flashHit();
    this.fx.shake(Math.min(0.4, 0.08 + taken * 0.012));
    this.aberration = Math.max(this.aberration, Math.min(14, 4 + taken * 0.6));
    const to = from.subtract(new Vector3(s.x, s.y, s.z));
    this.onDamage?.(Math.atan2(to.x, to.z) - this.yaw, taken);
    if (knockback > 0) {
      const len = Math.hypot(to.x, to.z) || 1;
      s.pushX -= (to.x / len) * knockback;
      s.pushZ -= (to.z / len) * knockback;
    }
    if (s.health <= 0) {
      this.playerDown = true;
      this.fx.explosion(this.player.root.position.add(new Vector3(0, 1.8, 0)), 1.5);
      this.sfx.explosion(1.3);
      this.player.root.setEnabled(false);
      this.slowMo = 1.2;
      this.sfx.defeat();
      this.finish(false, source);
    }
  }

  /** Online: show the result of a server-confirmed hit on us. */
  showIncomingHit(amount: number, from: Vector3): void {
    const s = this.state;
    this.player.flashHit();
    if (s.shieldTime > 0) this.sfx.shieldHit(); else this.sfx.playerHurt();
    this.fx.shake(Math.min(0.4, 0.08 + amount * 0.012));
    this.aberration = Math.max(this.aberration, Math.min(14, 4 + amount * 0.6));
    const to = from.subtract(new Vector3(s.x, s.y, s.z));
    this.onDamage?.(Math.atan2(to.x, to.z) - this.yaw, amount);
  }

  /** Online: show damage we dealt (server confirmed). */
  showOutgoingHit(at: Vector3, amount: number, crit: boolean, kill: boolean): void {
    this.sfx.hit(crit);
    this.float(at, `${Math.round(amount)}`, crit ? 'crit' : 'hit');
    this.onHit?.(crit, kill);
    if (kill) this.sfx.kill();
  }

  /** Online scoreboard values for the HUD. */
  setOnlineScore(score: number, kills: number): void { this.score = score; this.kills = kills; }

  explode(at: Vector3, radius: number, damage: number, source: 'enemy' | 'player' | 'barrel'): void {
    this.pendingExplosions.push({ at, radius, damage, source });
  }

  private flushExplosions(): void {
    let guard = 0;
    while (this.pendingExplosions.length && guard++ < 20) {
      const e = this.pendingExplosions.shift()!;
      this.fx.explosion(e.at, Math.max(0.7, e.radius / 4.5));
      this.sfx.explosion(e.radius / 4.5);
      if (this.session !== 'training') continue;
      const lift = e.at.add(new Vector3(0, 0.5, 0));
      if (e.source !== 'player') {
        const p = new Vector3(this.state.x, this.state.y + 1.6, this.state.z);
        const d = Vector3.Distance(p, e.at);
        if (d < e.radius) {
          const falloff = 1 - d / e.radius;
          const blocked = !this.world.arena.lineOfSight(lift, p);
          this.damagePlayer(e.damage * (0.35 + 0.65 * falloff) * (blocked ? 0.4 : 1) * (e.source === 'barrel' ? 0.55 : 1), e.at, 8 * falloff, 'EXPLOSÃO');
        }
      }
      {
        for (const enemy of this.enemies) {
          if (!enemy.alive) continue;
          if (e.source === 'enemy' && enemy.type === 'wasp') continue;
          const d = Vector3.Distance(enemy.center, e.at);
          if (d > e.radius + enemy.scale * 0.6) continue;
          const falloff = 1 - Math.min(1, d / (e.radius + enemy.scale * 0.6));
          const blocked = !this.world.arena.lineOfSight(lift, enemy.center);
          const scale = e.source === 'enemy' ? 0.5 : 1;
          this.damageEnemy(enemy, e.damage * (0.35 + 0.65 * falloff) * (blocked ? 0.4 : 1) * scale, false, enemy.center, 4 * falloff, e.at);
        }
      }
      for (const barrel of this.world.barrels) {
        if (barrel.alive && Vector3.Distance(barrel.position, e.at) < e.radius) this.damageBarrel(barrel, 40, 'barrel');
      }
    }
  }

  // ------------------------------------------------------------ projectiles
  private projectileTemplate(color: Rgb, kind: 'bolt' | 'missile'): Mesh {
    const key = `${kind}:${color.join(',')}`;
    let template = this.projectileTemplates.get(key);
    if (!template) {
      template = kind === 'missile'
        ? MeshBuilder.CreateCylinder(`proj-${key}`, { diameterTop: 0.05, diameterBottom: 0.22, height: 1, tessellation: 8 }, this.scene)
        : MeshBuilder.CreateSphere(`proj-${key}`, { diameter: 1, segments: 6 }, this.scene);
      if (kind === 'missile') template.rotation.x = Math.PI / 2;
      if (kind === 'missile') template.bakeCurrentTransformIntoVertices();
      const mat = new StandardMaterial(`proj-mat-${key}`, this.scene);
      mat.emissiveColor = new Color3(color[0], color[1], color[2]);
      mat.diffuseColor = Color3.Black();
      mat.disableLighting = true;
      template.material = mat;
      template.isPickable = false;
      template.setEnabled(false);
      this.projectileTemplates.set(key, template);
    }
    return template;
  }

  spawnProjectile(origin: Vector3, dir: Vector3, opts: ProjectileOptions, hostile: boolean, owner?: Enemy): Projectile {
    const kind = opts.kind ?? 'bolt';
    const mesh = this.projectileTemplate(opts.color, kind).createInstance('projectile');
    mesh.isPickable = false;
    mesh.position.copyFrom(origin);
    const size = opts.size ?? 0.2;
    mesh.scaling.set(size, size, kind === 'missile' ? 0.9 : size * 3.2);
    const p: Projectile = {
      mesh, pos: origin.clone(), vel: dir.normalize().scale(opts.speed), damage: opts.damage, hostile, owner,
      ttl: kind === 'missile' ? 6 : 3, radius: size * 0.6, homing: opts.homing ?? 0, splash: opts.splash ?? 0,
      splashDamage: opts.splashDamage ?? 0, kind, color: opts.color, trail: 0,
    };
    if (hostile && p.homing > 0) p.target = 'player';
    this.projectiles.push(p);
    return p;
  }

  /** Online: render a server missile by id. */
  syncNetMissiles(list: Array<{ id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number }>): void {
    const seen = new Set<number>();
    for (const m of list) {
      seen.add(m.id);
      let p = this.projectiles.find((q) => q.netId === m.id);
      if (!p) {
        p = this.spawnProjectile(new Vector3(m.x, m.y, m.z), new Vector3(m.vx, m.vy, m.vz), { speed: 1, damage: 0, color: WEAPONS.missile.color, size: 0.34, kind: 'missile' }, false);
        p.visualOnly = true;
        p.netId = m.id;
        p.ttl = 8;
      }
      p.pos.set(m.x, m.y, m.z);
      p.vel.set(m.vx, m.vy, m.vz);
    }
    for (const p of this.projectiles) if (p.netId !== undefined && !seen.has(p.netId)) p.ttl = 0;
  }

  private updateProjectiles(dt: number): void {
    const arena = this.world.arena;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.ttl -= dt;
      if (p.ttl <= 0) { p.mesh.dispose(); this.projectiles.splice(i, 1); continue; }
      // Homing.
      if (p.homing > 0 && p.target) {
        const goal = p.target === 'player' ? new Vector3(this.state.x, this.state.y + 1.7, this.state.z) : p.target.alive ? p.target.center : null;
        if (goal) {
          const speed = p.vel.length();
          const want = goal.subtract(p.pos).normalize().scale(speed);
          p.vel = Vector3.Lerp(p.vel, want, Math.min(1, dt * p.homing)).normalize().scale(speed);
        }
      }
      if (p.kind === 'missile') {
        p.trail -= dt;
        if (p.trail <= 0) { p.trail = 0.035; this.fx.sparks(p.pos, [1, 0.6, 0.25], 2, 0.25); }
      }
      const step = p.vel.scale(dt);
      const len = step.length();
      const dir = step.scale(1 / Math.max(1e-6, len));
      p.mesh.position.copyFrom(p.pos);
      p.mesh.lookAt(p.pos.add(dir));
      if (p.visualOnly) { p.pos.addInPlace(step); continue; }
      let hitT: number | null = null;
      let hitWhat: 'cover' | 'player' | 'enemy' | 'deck' | 'barrel' | null = null;
      let hitEnemy: Enemy | null = null;
      let hitBarrel: Barrel | null = null;
      const coverT = arena.raycastCover(p.pos, dir, len);
      if (coverT !== null) { hitT = coverT; hitWhat = 'cover'; }
      const barrel = this.barrelHit(p.pos, dir, hitT ?? len);
      if (barrel) { hitT = barrel.t; hitWhat = 'barrel'; hitBarrel = barrel.barrel; }
      if (p.hostile) {
        if (!this.playerDown) {
          const t = rayMech(p.pos, dir, hitT ?? len, new Vector3(this.state.x, this.state.y, this.state.z), 1);
          if (t) { hitT = t.t; hitWhat = 'player'; }
        }
      } else {
        for (const enemy of this.enemies) {
          if (!enemy.alive) continue;
          const t = enemy.def.flying ? raySphere(p.pos, dir, hitT ?? len, enemy.position, 1.2) : rayMech(p.pos, dir, hitT ?? len, enemy.position, enemy.scale)?.t ?? null;
          if (t !== null && (hitT === null || t < hitT)) { hitT = t; hitWhat = 'enemy'; hitEnemy = enemy; }
        }
      }
      const next = p.pos.add(step);
      if (hitWhat === null && next.y < this.world.deckY + 0.05 && arena.onDeck(next.x, next.z, 0)) { hitT = len; hitWhat = 'deck'; }
      if (hitWhat === null) { p.pos.copyFrom(next); continue; }
      const at = p.pos.add(dir.scale(hitT ?? len));
      if (hitWhat === 'player') this.damagePlayer(p.damage, p.owner?.position ?? p.pos, p.kind === 'missile' ? 3 : 0.6, p.owner?.def.name ?? 'PROJÉTIL');
      if (hitWhat === 'enemy' && hitEnemy) this.stats.hits++;
      if (hitWhat === 'enemy' && hitEnemy) this.damageEnemy(hitEnemy, p.damage, false, at, WEAPONS.missile.knockback, p.pos);
      if (hitWhat === 'barrel' && hitBarrel) this.damageBarrel(hitBarrel, p.damage + p.splashDamage, p.hostile ? 'enemy' : 'player');
      if (p.splash > 0) this.explode(at, p.splash, p.splashDamage, p.hostile ? 'enemy' : 'player');
      else this.fx.sparks(at, p.color, 8, 0.7);
      p.mesh.dispose();
      this.projectiles.splice(i, 1);
    }
  }

  // --------------------------------------------------------------- training
  private aiContext(): AiContext {
    const s = this.state;
    return {
      arena: this.world.arena,
      fx: this.fx,
      sfx: this.sfx,
      scene: this.scene,
      time: this.time,
      difficulty: DIFFICULTIES[this.difficulty],
      enemies: this.enemies,
      player: { position: new Vector3(s.x, s.y, s.z), velocity: new Vector3(s.vx, 0, s.vz), alive: !this.playerDown && !this.finished, grounded: s.grounded, airborneHeight: s.y - this.world.deckY },
      fireProjectile: (owner, origin, dir, opts) => { this.spawnProjectile(origin, dir, opts, true, owner); },
      hitscan: (owner, origin, dir, range, damage, color) => {
        const coverT = this.world.raycastCover(origin, dir, range);
        const barrel = this.barrelHit(origin, dir, coverT ?? range);
        const limit = barrel?.t ?? coverT ?? range;
        const hit = this.playerDown ? null : rayMech(origin, dir, limit, new Vector3(s.x, s.y, s.z), 1);
        const end = origin.add(dir.scale(hit ? hit.t : limit));
        this.fx.beam(origin, end, color, 0.12);
        this.fx.sparks(end, color, 10, 0.8);
        if (hit) this.damagePlayer(damage * (hit.critical ? 1.25 : 1), owner.position, 2, owner.def.name);
        else if (barrel) this.damageBarrel(barrel.barrel, damage, 'enemy');
        return !!hit;
      },
      damagePlayer: (amount, from, knockback, source) => this.damagePlayer(amount, from, knockback, source),
      spawnEnemy: (type, at) => this.spawnEnemy(type, at),
      explode: (at, radius, damage, source) => this.explode(at, radius, damage, source),
    };
  }

  private spawnPoint(type: EnemyType): Vector3 {
    const arena = this.world.arena;
    const s = this.state;
    const stations = arena.layout.stations
      .map((st) => ({ st, d: Math.hypot(st.x - s.x, st.z - s.z) }))
      .sort((a, b) => b.d - a.d);
    const pick = stations[Math.floor(Math.random() * Math.min(type === 'boss' ? 1 : 3, stations.length))].st;
    const p = arena.randomDeckPoint(Math.random, { x: pick.x, z: pick.z, radius: type === 'boss' ? 2 : 4.5 });
    return new Vector3(p.x, arena.deckY, p.z);
  }

  spawnEnemy(type: EnemyType, at?: Vector3): void {
    const position = at ?? this.spawnPoint(type);
    const enemy = new Enemy(type, this.scene, position, DIFFICULTIES[this.difficulty]);
    if (enemy.mech) for (const mesh of enemy.root.getChildMeshes()) this.world.shadows.addShadowCaster(mesh);
    this.enemies.push(enemy);
    this.fx.pillar(position, ENEMY_DEFS[type].color, 1.2, type === 'wasp' ? 22 : 18);
    this.sfx.telegraph();
  }

  private updateTraining(dt: number): void {
    if (!this.finished) this.stats.time += dt;
    // Out-of-combat repair keeps the pace up between skirmishes.
    if (!this.playerDown && this.time - this.lastHurt > 4.5 && this.state.health < MOVE.maxHealth) this.state.health = Math.min(MOVE.maxHealth, this.state.health + dt * 3.5);
    this.comboTime = Math.max(0, this.comboTime - dt);
    if (this.comboTime === 0) this.combo = 1;
    const ctx = this.aiContext();
    for (const enemy of this.enemies) enemy.update(ctx, dt);
    // Enemies that died on their own (kamikaze drones) leave the list here.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy.alive) {
        if (!enemy.killed) { enemy.die(this, Vector3.Zero()); this.dying.push({ enemy, ttl: 3.6 }); }
        this.enemies.splice(i, 1);
      }
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      this.dying[i].ttl -= dt;
      if (this.dying[i].ttl <= 0) { this.dying[i].enemy.dispose(); this.dying.splice(i, 1); }
    }
    this.updatePickups(dt);
    if (this.finished) return;

    // Wave director.
    if (this.waveQueue.length) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) { this.spawnEnemy(this.waveQueue.shift()!); this.spawnTimer = 0.7; }
    } else if (this.enemies.length === 0) {
      if (this.waveActive) this.waveCleared();
      else {
        this.intermission -= dt;
        if (this.intermission <= 0) this.beginWave(this.waveIndex + 1);
      }
    }
  }

  private beginWave(index: number): void {
    if (index >= WAVES.length) return;
    this.waveIndex = index;
    this.waveActive = true;
    const wave = WAVES[index];
    const extra: EnemyType[] = this.difficulty === 'elite' && index > 0 ? ['wasp'] : [];
    this.waveQueue = [...wave.spawns, ...extra];
    this.spawnTimer = 0.3;
    this.onBanner?.(wave.title, wave.subtitle);
    this.sfx.wave();
    this.world.resetBarrels(true);
  }

  private waveCleared(): void {
    const wave = this.waveIndex + 1;
    const bonus = 750 * wave;
    this.score += bonus;
    this.waveActive = false;
    if (this.waveIndex >= WAVES.length - 1) {
      this.sfx.victory();
      this.finish(true);
      return;
    }
    this.onBanner?.(`ONDA ${wave} CONCLUÍDA`, `BÔNUS +${bonus} · SUPRIMENTOS A CAMINHO`);
    this.intermission = 6.5;
    this.dropSupply();
  }

  private dropSupply(): void {
    const s = this.state;
    const p = this.world.arena.randomDeckPoint(Math.random, { x: s.x * 0.5, z: s.z * 0.5, radius: 6 });
    const position = new Vector3(p.x, this.world.deckY, p.z);
    const node = this.world.createSupplyCrate();
    node.position.set(p.x, this.world.deckY + 24, p.z);
    const ring = MeshBuilder.CreateTorus('supply-ring', { diameter: 2.4, thickness: 0.08, tessellation: 36 }, this.scene);
    const mat = new StandardMaterial('supply-ring-mat', this.scene);
    mat.emissiveColor = new Color3(0.35, 1, 0.65);
    mat.disableLighting = true;
    ring.material = mat;
    ring.position.set(p.x, this.world.deckY + 0.08, p.z);
    ring.isPickable = false;
    this.pickups.push({ node, ring, position, landed: false, t: 0 });
    this.fx.pillar(position, [0.35, 1, 0.65], 1.6, 24);
  }

  private updatePickups(dt: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      p.ring.rotation.y += dt * 1.5;
      if (!p.landed) {
        p.node.position.y = Math.max(this.world.deckY, p.node.position.y - dt * 22);
        if (p.node.position.y <= this.world.deckY) { p.landed = true; this.fx.shockwave(p.position.add(new Vector3(0, 0.1, 0)), 2.6, [0.35, 1, 0.65], 0.4); this.sfx.land(4); }
      } else {
        p.node.rotation.y += dt * 0.6;
        const d = Math.hypot(this.state.x - p.position.x, this.state.z - p.position.z);
        if (d < 2.3 && !this.playerDown) {
          this.state.health = Math.min(MOVE.maxHealth, this.state.health + 45);
          this.state.energy = 100;
          this.state.heat = 0;
          this.state.overheated = false;
          this.sfx.pickup();
          this.float(p.position.add(new Vector3(0, 2, 0)), '+45 INTEGRIDADE', 'heal');
          this.onToast?.('SUPRIMENTOS: REPARO E ENERGIA');
          this.fx.pillar(p.position, [0.35, 1, 0.65], 0.6, 8);
          p.node.dispose(false, true);
          p.ring.material?.dispose();
          p.ring.dispose();
          this.pickups.splice(i, 1);
        }
      }
    }
  }

  private finish(won: boolean, cause = ''): void {
    if (this.finished) return;
    this.finished = true;
    const accuracy = this.stats.shots ? Math.min(100, Math.round((this.stats.hits / this.stats.shots) * 100)) : 0;
    const waves = won ? WAVES.length : this.waveActive ? this.waveIndex : this.waveIndex + 1;
    const minutes = Math.floor(this.stats.time / 60);
    const seconds = Math.floor(this.stats.time % 60).toString().padStart(2, '0');
    this.pendingResult = {
      won,
      kicker: won ? 'TREINAMENTO CONCLUÍDO' : 'UNIDADE DESTRUÍDA',
      title: won ? 'VITÓRIA' : 'DERROTA',
      detail: won ? `O Colosso caiu. ${DIFFICULTIES[this.difficulty].label} concluído.` : `Abatido por ${cause || 'fogo inimigo'} na ${WAVES[Math.max(0, this.waveIndex)].title.toLowerCase()}.`,
      score: this.score,
      difficulty: this.difficulty,
      stats: [
        ['ONDAS', `${waves} / ${WAVES.length}`],
        ['ABATES', `${this.kills}`],
        ['PRECISÃO', `${accuracy}%`],
        ['CRÍTICOS', `${this.stats.crits}`],
        ['DANO CAUSADO', `${Math.round(this.stats.damageDealt)}`],
        ['DANO SOFRIDO', `${Math.round(this.stats.damageTaken)}`],
        ['TEMPO', `${minutes}:${seconds}`],
      ],
    };
    this.resultTimer = won ? 2.2 : 1.8;
  }

  /** Online match end. */
  finishOnline(result: ResultInfo): void {
    this.pendingResult = result;
    this.resultTimer = 1.2;
  }

  // ----------------------------------------------------------------- camera
  private updateCamera(dt: number): void {
    const player = this.player.root.position;
    if (this.mode === 'game' || this.mode === 'pause' || this.mode === 'result') {
      const pitch = this.pitch;
      const look = new Vector3(Math.sin(this.yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(this.yaw) * Math.cos(pitch));
      const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const portrait = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight()) < 0.8;
      this.camera.fovMode = portrait ? Camera.FOVMODE_HORIZONTAL_FIXED : Camera.FOVMODE_VERTICAL_FIXED;
      const pivot = player.add(new Vector3(0, portrait ? 3.1 : 2.8, 0)).add(right.scale(portrait ? 0.9 : 1.45));
      let distance = portrait ? 8.6 : 7.2;
      // Pull the camera in when cover sits between it and the mech.
      const back = look.scale(-1);
      const blocked = this.world.raycastCover(pivot, back, distance);
      if (blocked !== null) distance = Math.max(1.6, blocked - 0.3);
      const desired = pivot.add(back.scale(distance));
      desired.y = Math.max(this.world.deckY + 0.5, desired.y);
      const k = dt === 0 ? 1 : Math.min(1, dt * 18);
      this.cameraPos = Vector3.Lerp(this.cameraPos, desired, k);
      const shake = this.fx.cameraShake(dt, this.time);
      this.camera.position.copyFrom(this.cameraPos.add(shake));
      this.camera.setTarget(this.camera.position.add(look.scale(30)).add(shake.scale(0.5)));
      this.fovKick = Math.max(0, this.fovKick - dt * 0.6);
      const sprinting = Math.hypot(this.state.vx, this.state.vz) > 8;
      const charge = this.state.charge > 0 ? this.state.charge / WEAPONS.laser.chargeTime : 0;
      const targetFov = (portrait ? 1.3 : 0.9) + (sprinting ? 0.06 : 0) + this.fovKick - charge * 0.12;
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 8);
    } else {
      const portrait = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight()) < 0.8;
      const angle = this.mode === 'garage' ? this.orbit : this.orbit + 0.85;
      this.camera.fovMode = Camera.FOVMODE_VERTICAL_FIXED;
      const distance = this.mode === 'garage' ? this.orbitDistance * (portrait ? 1.9 : 1) : portrait ? 15 : 10.5;
      // In portrait the UI sits at the bottom, so frame the mech in the upper half.
      const focus = player.add(new Vector3(0, portrait ? (this.mode === 'garage' ? -0.9 : 0.6) : 1.7, 0));
      // Landscape garage: shift the framing so the mech sits right of the side panel.
      if (!portrait && this.mode === 'garage') focus.addInPlace(new Vector3(-Math.cos(angle), 0, Math.sin(angle)).scale(1.9));
      const height = 2.2;
      const desired = focus.add(new Vector3(Math.sin(angle) * distance, height, Math.cos(angle) * distance));
      this.camera.position = Vector3.Lerp(this.camera.position, desired, dt === 0 ? 1 : Math.min(1, dt * 2.2));
      this.camera.setTarget(focus);
      this.camera.fov = this.mode === 'garage' ? 0.68 : 0.8;
      this.cameraPos.copyFrom(this.camera.position);
    }
  }

  // -------------------------------------------------------------------- HUD
  private float(world: Vector3, text: string, kind: 'hit' | 'crit' | 'kill' | 'heal'): void {
    const p = this.project(world);
    if (p.onScreen) this.onFloat?.(p.x, p.y, text, kind);
  }

  private project(world: Vector3): { x: number; y: number; onScreen: boolean } {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const p = Vector3.Project(world, Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(w, h));
    return { x: p.x, y: p.y, onScreen: p.z > 0 && p.z < 1 && p.x > -50 && p.x < w + 50 && p.y > -50 && p.y < h + 50 };
  }

  private updateMarkers(): void {
    if (!this.onMarkers) return;
    const markers: Marker[] = [];
    const me = this.player.root.position;
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.state === 'spawn') continue;
      const top = enemy.def.flying ? enemy.position.add(new Vector3(0, 1.1, 0)) : enemy.position.add(new Vector3(0, 3.75 * enemy.scale, 0));
      const p = this.project(top);
      markers.push({ id: `e${enemy.id}`, x: p.x, y: p.y, onScreen: p.onScreen, health: enemy.health / enemy.maxHealth, name: enemy.def.name, boss: enemy.type === 'boss', alert: ['charge', 'aim', 'dive'].includes(enemy.stateLabel), distance: Vector3.Distance(me, enemy.position) });
    }
    if (this.online) {
      for (const r of this.online.targets()) {
        if (!r.alive) continue;
        const p = this.project(r.base.add(new Vector3(0, 3.8, 0)));
        markers.push({ id: `p${r.id}`, x: p.x, y: p.y, onScreen: p.onScreen, health: r.health / 100, name: r.name, boss: false, alert: false, distance: Vector3.Distance(me, r.base) });
      }
    }
    this.onMarkers(markers);
  }

  private updateRadar(): void {
    if (!this.onRadar) return;
    const contacts: RadarState['contacts'] = [];
    for (const enemy of this.enemies) if (enemy.alive) contacts.push({ x: enemy.position.x, z: enemy.position.z, kind: enemy.type === 'boss' ? 'boss' : enemy.def.flying ? 'flyer' : 'enemy' });
    for (const p of this.pickups) contacts.push({ x: p.position.x, z: p.position.z, kind: 'pickup' });
    if (this.online) for (const r of this.online.targets()) if (r.alive) contacts.push({ x: r.base.x, z: r.base.z, kind: 'player' });
    this.onRadar({ yaw: this.yaw, x: this.state.x, z: this.state.z, contacts });
  }

  updateHud(): void {
    const s = this.state;
    const alive = this.enemies.filter((e) => e.alive).length + this.waveQueue.length;
    const waveNumber = this.waveIndex + 1;
    let objective: string;
    if (this.session === 'online') objective = this.online?.objective() ?? '';
    else if (this.finished) objective = 'SIMULAÇÃO ENCERRADA';
    else if (this.waveActive) objective = `${WAVES[this.waveIndex].title} · ${alive} HOSTIS`;
    else objective = `${waveNumber > 0 ? 'PRÓXIMA ONDA' : 'PRIMEIRA ONDA'} EM ${Math.ceil(Math.max(0, this.intermission))} S`;
    this.onHud?.({
      session: this.session,
      health: s.health, energy: s.energy, heat: s.heat, overheated: s.overheated,
      charge: WEAPONS[s.weapon].kind === 'charge' ? s.charge / WEAPONS[s.weapon].chargeTime : 0,
      weapon: s.weapon, score: this.score, combo: this.combo, comboTime: this.comboTime, kills: this.kills,
      wave: waveNumber, waveCount: WAVES.length, enemiesLeft: alive, objective,
      dashCooldown: s.dashCd, shieldCooldown: s.shieldCd, impactCooldown: s.impactCd, shield: s.shieldTime > 0,
      fps: this.engine.getFps(),
    });
    if (this.touch?.isVisible) {
      this.touch.setCooldown('dash', s.dashCd);
      this.touch.setCooldown('shield', s.shieldCd);
      this.touch.setCooldown('impact', s.impactCd);
    }
  }

  // ------------------------------------------------------------ debug hooks
  debugState(): object {
    return {
      mode: this.mode, session: this.session, weapon: this.state.weapon, health: this.state.health, energy: this.state.energy, heat: this.state.heat,
      score: this.score, kills: this.kills, wave: this.waveIndex, queue: this.waveQueue.length,
      enemies: this.enemies.map((e) => ({ type: e.type, state: e.stateLabel, health: Math.round(e.health), pos: e.position.asArray().map((v) => +v.toFixed(2)) })),
      player: [this.state.x, this.state.y, this.state.z].map((v) => +v.toFixed(2)),
      projectiles: this.projectiles.length, barrels: this.world.barrels.filter((b) => b.alive).length, pickups: this.pickups.length, finished: this.finished,
    };
  }

  /** Advance the simulation without rendering (headless tests run at very low FPS). */
  debugStep(seconds: number, step = 1 / 30): void {
    for (let t = 0; t < seconds; t += step) this.update(step);
  }

  /** Test helper: move the player to a walkable spot `distance` metres from the closest ground enemy. */
  debugApproach(distance: number): boolean {
    const me = new Vector3(this.state.x, this.state.y, this.state.z);
    const target = this.enemies.filter((e) => e.alive && !e.def.flying).sort((a, b) => Vector3.Distance(a.position, me) - Vector3.Distance(b.position, me))[0];
    if (!target) return false;
    for (let i = 0; i < 24; i++) {
      const angle = Math.atan2(me.x - target.position.x, me.z - target.position.z) + (i % 2 ? 1 : -1) * Math.floor(i / 2) * 0.3;
      const x = target.position.x + Math.sin(angle) * distance;
      const z = target.position.z + Math.cos(angle) * distance;
      const eye = new Vector3(x, this.world.deckY + 2.6, z);
      if (this.world.arena.canMoveTo(x, z, MOVE.radius) && this.world.arena.lineOfSight(eye, target.center)) {
        this.state.x = x; this.state.z = z; this.state.y = this.world.deckY;
        this.yaw = Math.atan2(target.position.x - x, target.position.z - z);
        return true;
      }
    }
    return false;
  }

  /** Test helper: destroy the current wave without awarding points for it. */
  debugSkipWave(): void {
    const score = this.score;
    const dealt = this.stats.damageDealt;
    for (const enemy of [...this.enemies]) if (enemy.alive) this.damageEnemy(enemy, enemy.health + 1, false, enemy.center, 0, enemy.position);
    this.waveQueue.length = 0;
    this.score = score;
    this.stats.damageDealt = dealt;
  }
}

function rayBoxCover(origin: Vector3, dir: Vector3, maxDistance: number, deckY: number, cover: Cover): number | null {
  const min = [cover.x - cover.widthX / 2, deckY, cover.z - cover.widthZ / 2];
  const max = [cover.x + cover.widthX / 2, deckY + cover.height, cover.z + cover.widthZ / 2];
  const start = [origin.x, origin.y, origin.z];
  const step = [dir.x, dir.y, dir.z];
  let near = 0, far = maxDistance;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(step[axis]) < 1e-8) { if (start[axis] < min[axis] || start[axis] > max[axis]) return null; continue; }
    let a = (min[axis] - start[axis]) / step[axis];
    let b = (max[axis] - start[axis]) / step[axis];
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a); far = Math.min(far, b);
    if (near > far) return null;
  }
  return near <= maxDistance ? near : null;
}

