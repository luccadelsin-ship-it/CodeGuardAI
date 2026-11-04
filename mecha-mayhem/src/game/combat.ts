import {
  Color3,
  Engine,
  FreeCamera,
  MeshBuilder,
  Ray,
  Scene,
  Vector3,
} from '@babylonjs/core';
import { createMech, type MechPalette, type MechVisual } from './mech';
import type { World } from './world';

export type GameMode = 'menu' | 'garage' | 'settings' | 'game' | 'pause' | 'result';

export interface HudState {
  health: number;
  energy: number;
  heat: number;
  kills: number;
  score: number;
  dashCooldown: number;
  shieldCooldown: number;
  fps: number;
}

interface Bot {
  mech: MechVisual;
  health: number;
  fireTimer: number;
  alive: boolean;
}

export class CombatGame {
  readonly camera: FreeCamera;
  readonly player: MechVisual;
  mode: GameMode = 'menu';
  onHud?: (state: HudState) => void;
  onResult?: (won: boolean, score: number) => void;
  onToast?: (message: string) => void;
  onHit?: () => void;
  onDamage?: () => void;
  onPause?: () => void;

  private readonly keys = new Set<string>();
  private readonly bots: Bot[] = [];
  private readonly effects: { mesh: ReturnType<typeof MeshBuilder.CreateLines>; ttl: number }[] = [];
  private readonly canvas: HTMLCanvasElement;
  private velocity = Vector3.Zero();
  private verticalVelocity = 0;
  private yaw = 0;
  private pitch = 0.13;
  private orbit = 0;
  private orbitDistance = 8;
  private dragX = 0;
  private firing = false;
  private fireTimer = 0;
  private overheated = false;
  private health = 100;
  private energy = 100;
  private heat = 0;
  private kills = 0;
  private score = 0;
  private dashCooldown = 0;
  private shieldCooldown = 0;
  private shieldTime = 0;
  private hudTimer = 0;
  private savedSensitivity = 1;
  private soundEnabled = true;
  private audio?: AudioContext;
  private wasPointerLocked = false;

  constructor(
    private readonly scene: Scene,
    private readonly engine: Engine,
    canvas: HTMLCanvasElement,
    private readonly world: World,
    palette: MechPalette,
  ) {
    this.canvas = canvas;
    this.player = createMech(scene, palette);
    this.player.root.position.copyFrom(world.spawn);
    this.camera = new FreeCamera('combat-camera', new Vector3(8, 5, 8), scene);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 350;
    this.camera.fov = 0.84;
    scene.activeCamera = this.camera;
    this.installInput();
    this.updateCamera(0);
  }

  setMode(mode: GameMode): void {
    this.mode = mode;
    this.firing = false;
    this.player.setShowcase(mode === 'menu' || mode === 'garage' || mode === 'settings');
    if (mode !== 'game' && document.pointerLockElement === this.canvas) document.exitPointerLock();
    if (mode === 'menu') {
      for (const bot of this.bots) bot.mech.dispose();
      this.bots.length = 0;
      this.player.root.position.copyFrom(this.world.spawn);
      this.player.root.rotation.y = -0.35;
      this.player.setShield(false);
    }
    this.updateCamera(0);
  }

  setPalette(palette: MechPalette): void {
    this.player.setPalette(palette);
  }

  debugAim(): object {
    const ray = this.camera.getForwardRay();
    return {
      camera: this.camera.position.asArray(),
      direction: ray.direction.asArray(),
      yaw: this.yaw,
      pitch: this.pitch,
      bots: this.bots.filter(bot => bot.alive).map(bot => {
        const center = bot.mech.root.position.add(new Vector3(0, 1.55, 0));
        return { center: center.asArray(), t: this.raySphere(ray, center, 1.25) };
      }),
    };
  }

  setSensitivity(value: number): void {
    this.savedSensitivity = Math.min(2, Math.max(0.4, value));
  }

  setSound(enabled: boolean): void {
    this.soundEnabled = enabled;
  }

  setQuality(quality: 'high' | 'medium' | 'low'): void {
    const targetPixelRatio = quality === 'high' ? Math.min(window.devicePixelRatio, 1.5) : quality === 'medium' ? 1 : 0.7;
    this.engine.setHardwareScalingLevel(window.devicePixelRatio / targetPixelRatio);
    this.scene.shadowsEnabled = quality !== 'low';
  }

  start(): void {
    for (const bot of this.bots) bot.mech.dispose();
    this.bots.length = 0;
    this.health = 100;
    this.energy = 100;
    this.heat = 0;
    this.kills = 0;
    this.score = 0;
    this.dashCooldown = 0;
    this.shieldCooldown = 0;
    this.shieldTime = 0;
    this.fireTimer = 0;
    this.verticalVelocity = 0;
    this.velocity.setAll(0);
    this.yaw = 0;
    this.pitch = 0.13;
    this.overheated = false;
    this.player.setShield(false);
    this.player.root.position.copyFrom(this.world.spawn);
    this.player.root.rotation.y = 0;
    const positions = [new Vector3(0, this.world.spawn.y, 26), new Vector3(26, this.world.spawn.y, 0), new Vector3(-26, this.world.spawn.y, 0)];
    positions.forEach((position, index) => {
      const mech = createMech(this.scene, index === 1 ? 'steel' : 'ember', true);
      mech.root.position.copyFrom(position);
      mech.root.scaling.setAll(0.83);
      this.bots.push({ mech, health: 70, fireTimer: 1.5 + index * 0.85, alive: true });
    });
    this.setMode('game');
    this.onToast?.('ELIMINE OS 3 DRONES DE TREINAMENTO');
    this.updateHud();
    this.playSound(280, 0.08, 'sine', 0.04);
    void this.canvas.requestPointerLock?.();
  }

  pause(): void {
    if (this.mode !== 'game') return;
    this.setMode('pause');
    this.onPause?.();
  }

  resume(): void {
    if (this.mode !== 'pause') return;
    this.setMode('game');
    void this.canvas.requestPointerLock?.();
  }

  update(rawDt: number): void {
    const dt = Math.min(0.05, rawDt);
    if (this.mode === 'game') {
      this.updatePlayer(dt);
      this.updateBots(dt);
      this.updateWeapon(dt);
      this.dashCooldown = Math.max(0, this.dashCooldown - dt);
      this.shieldCooldown = Math.max(0, this.shieldCooldown - dt);
      this.shieldTime = Math.max(0, this.shieldTime - dt);
      if (this.shieldTime === 0) this.player.setShield(false);
      this.energy = Math.min(100, this.energy + dt * 8);
      this.heat = Math.max(0, this.heat - dt * 16);
      if (this.overheated && this.heat < 35) this.overheated = false;
      this.hudTimer += dt;
      if (this.hudTimer > 0.1) { this.updateHud(); this.hudTimer = 0; }
    } else if (this.mode === 'menu' || this.mode === 'garage' || this.mode === 'settings') {
      this.player.animate(dt, 0);
      if (this.mode === 'menu') this.orbit += dt * 0.075;
    }
    this.updateCamera(dt);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i];
      effect.ttl -= dt;
      effect.mesh.visibility = Math.max(0, effect.ttl / 0.13);
      if (effect.ttl <= 0) { effect.mesh.dispose(); this.effects.splice(i, 1); }
    }
  }

  private installInput(): void {
    window.addEventListener('keydown', event => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      this.keys.add(event.code);
      if (event.code === 'Escape' && this.mode === 'game') { this.pause(); return; }
      if (event.repeat || this.mode !== 'game') return;
      if (event.code === 'Space' && this.player.root.position.y <= this.world.spawn.y + 0.03) {
        this.verticalVelocity = 7.7;
        this.playSound(140, 0.15, 'sawtooth', 0.03);
      }
      if (event.code === 'KeyQ') this.dash();
      if (event.code === 'KeyE') this.shield();
    });
    window.addEventListener('keyup', event => this.keys.delete(event.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.firing = false; if (this.mode === 'game') this.pause(); });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (!locked) this.firing = false;
      if (!locked && this.wasPointerLocked && this.mode === 'game') this.pause();
      this.wasPointerLocked = locked;
    });
    this.canvas.addEventListener('mousedown', event => {
      if (this.mode === 'game' && event.button === 0) {
        if (document.pointerLockElement !== this.canvas) void this.canvas.requestPointerLock?.();
        this.firing = true;
      }
      if (this.mode === 'garage') this.dragX = event.clientX;
    });
    window.addEventListener('mouseup', event => { if (event.button === 0) this.firing = false; });
    window.addEventListener('mousemove', event => {
      if (this.mode === 'game' && document.pointerLockElement === this.canvas) {
        this.yaw += event.movementX * 0.0026 * this.savedSensitivity;
        this.pitch = Math.max(-0.35, Math.min(0.68, this.pitch + event.movementY * 0.0022 * this.savedSensitivity));
      } else if (this.mode === 'garage' && event.buttons & 1) {
        this.orbit += (event.clientX - this.dragX) * 0.006;
        this.dragX = event.clientX;
      }
    });
    this.canvas.addEventListener('wheel', event => {
      if (this.mode !== 'garage') return;
      event.preventDefault();
      this.orbitDistance = Math.max(4.2, Math.min(12, this.orbitDistance + Math.sign(event.deltaY) * 0.75));
    }, { passive: false });
  }

  private updatePlayer(dt: number): void {
    const forward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    let input = Vector3.Zero();
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) input.addInPlace(forward);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) input.subtractInPlace(forward);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) input.addInPlace(right);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) input.subtractInPlace(right);
    if (input.lengthSquared() > 0) input.normalize();
    const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 8.3 : 5.4;
    const targetVelocity = input.scale(speed);
    this.velocity = Vector3.Lerp(this.velocity, targetVelocity, Math.min(1, dt * (input.lengthSquared() ? 6.5 : 10)));
    const nextX = this.player.root.position.clone();
    nextX.x += this.velocity.x * dt;
    if (this.world.canMoveTo(nextX, 0.8)) this.player.root.position.x = nextX.x;
    else this.velocity.x = 0;
    const nextZ = this.player.root.position.clone();
    nextZ.z += this.velocity.z * dt;
    if (this.world.canMoveTo(nextZ, 0.8)) this.player.root.position.z = nextZ.z;
    else this.velocity.z = 0;
    this.verticalVelocity -= 19 * dt;
    this.player.root.position.y = Math.max(this.world.spawn.y, this.player.root.position.y + this.verticalVelocity * dt);
    if (this.player.root.position.y === this.world.spawn.y) this.verticalVelocity = 0;
    this.player.root.rotation.y = this.yaw;
    this.player.animate(dt, this.velocity.length());
  }

  private updateBots(dt: number): void {
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const toPlayer = this.player.root.position.subtract(bot.mech.root.position);
      const distance = Math.hypot(toPlayer.x, toPlayer.z);
      bot.mech.root.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
      if (distance > 10 && distance < 31) {
        const step = new Vector3(toPlayer.x / distance, 0, toPlayer.z / distance).scale(dt * 2.2);
        const next = bot.mech.root.position.add(step);
        if (this.world.canMoveTo(next, 0.8)) bot.mech.root.position.addInPlace(step);
        bot.mech.animate(dt, 2.2);
      } else bot.mech.animate(dt, 0);
      bot.fireTimer -= dt;
      if (bot.fireTimer <= 0 && distance < 28) {
        bot.fireTimer = 1.6 + Math.random() * 0.8;
        this.botFire(bot, distance);
      }
    }
  }

  private botFire(bot: Bot, distance: number): void {
    const source = bot.mech.muzzle.getAbsolutePosition();
    const playerTarget = this.player.root.position.add(new Vector3(0, 1.55, 0));
    const shot = playerTarget.subtract(source);
    const shotDistance = shot.length();
    const direction = shot.normalize();
    const blockedAt = this.world.raycastCover(source, direction, shotDistance);
    const target = blockedAt === null ? playerTarget : source.add(direction.scale(blockedAt));
    this.spawnTracer(source, target, new Color3(1, 0.35, 0.15));
    this.playSound(105, 0.07, 'triangle', 0.012);
    if (blockedAt !== null) return;
    const accuracy = Math.max(0.2, 0.75 - distance * 0.012);
    if (Math.random() < accuracy) {
      const damage = this.shieldTime > 0 ? 2 : 7;
      this.health = Math.max(0, this.health - damage);
      this.player.flashHit();
      this.onDamage?.();
      if (this.health === 0) this.finish(false);
    }
  }

  private updateWeapon(dt: number): void {
    this.fireTimer -= dt;
    if (!this.firing || this.overheated || this.fireTimer > 0) return;
    this.fireTimer = 0.115;
    this.heat = Math.min(100, this.heat + 7.5);
    if (this.heat >= 100) { this.overheated = true; this.onToast?.('ARMA SUPERAQUECIDA'); }
    this.playSound(90 + Math.random() * 45, 0.045, 'sawtooth', 0.018);
    const muzzle = this.player.muzzle.getAbsolutePosition();
    const direction = this.camera.getForwardRay().direction;
    const ray = new Ray(this.camera.position, direction, 70);
    let nearest: Bot | undefined;
    let nearestT = 70;
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const center = bot.mech.root.position.add(new Vector3(0, 1.55, 0));
      const t = this.raySphere(ray, center, 1.25);
      if (t !== null && t < nearestT) { nearestT = t; nearest = bot; }
    }
    const blockedAt = this.world.raycastCover(ray.origin, direction, nearestT);
    if (blockedAt !== null) { nearestT = blockedAt; nearest = undefined; }
    const target = ray.origin.add(direction.scale(nearestT));
    this.spawnTracer(muzzle, target, new Color3(0.55, 0.95, 1));
    if (nearest) {
      nearest.health -= 10;
      nearest.mech.flashHit();
      this.onHit?.();
      this.score += 25;
      if (nearest.health <= 0) {
        nearest.alive = false;
        nearest.mech.root.setEnabled(false);
        this.kills++;
        this.score += 500;
        this.onToast?.(`DRONE ELIMINADO · ${this.kills} / 3`);
        this.playSound(260, 0.24, 'sawtooth', 0.06);
        if (this.kills === 3) this.finish(true);
      }
    }
  }

  private raySphere(ray: Ray, center: Vector3, radius: number): number | null {
    const offset = ray.origin.subtract(center);
    const b = Vector3.Dot(offset, ray.direction);
    const c = Vector3.Dot(offset, offset) - radius * radius;
    const discriminant = b * b - c;
    if (discriminant < 0) return null;
    const t = -b - Math.sqrt(discriminant);
    return t >= 0 && t <= ray.length ? t : null;
  }

  private spawnTracer(from: Vector3, to: Vector3, color: Color3): void {
    const mesh = MeshBuilder.CreateLines(`tracer-${this.effects.length}`, { points: [from, to] }, this.scene);
    mesh.color = color;
    mesh.isPickable = false;
    this.effects.push({ mesh, ttl: 0.13 });
  }

  private dash(): void {
    if (this.dashCooldown > 0 || this.energy < 20) return;
    this.energy -= 20;
    this.dashCooldown = 3;
    const direction = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    for (let i = 0; i < 10; i++) {
      const next = this.player.root.position.add(direction.scale(0.62));
      if (!this.world.canMoveTo(next, 0.8)) break;
      this.player.root.position.copyFrom(next);
    }
    this.playSound(340, 0.22, 'sawtooth', 0.04);
    this.onToast?.('TURBO DASH');
  }

  private shield(): void {
    if (this.shieldCooldown > 0 || this.energy < 25) return;
    this.energy -= 25;
    this.shieldCooldown = 12;
    this.shieldTime = 4;
    this.player.setShield(true);
    this.playSound(470, 0.28, 'sine', 0.05);
    this.onToast?.('ESCUDO DE ENERGIA ATIVO');
  }

  private updateCamera(dt: number): void {
    const player = this.player.root.position;
    if (this.mode === 'game' || this.mode === 'pause' || this.mode === 'result') {
      const forward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const desired = player.subtract(forward.scale(8.4 * Math.cos(this.pitch))).add(right.scale(2.0)).add(new Vector3(0, 3.25 + 6 * Math.sin(this.pitch), 0));
      this.camera.position = Vector3.Lerp(this.camera.position, desired, dt === 0 ? 1 : Math.min(1, dt * 12));
      this.camera.setTarget(player.add(new Vector3(0, 1.2 + Math.sin(this.pitch) * 3.5, 0)).add(forward.scale(25)));
      this.camera.fov = 0.88;
    } else {
      const angle = this.mode === 'garage' ? this.orbit : this.orbit + 0.85;
      const distance = this.mode === 'garage' ? this.orbitDistance : 10.5;
      const focus = player.add(new Vector3(0, 1.7, 0));
      const desired = focus.add(new Vector3(Math.sin(angle) * distance, 2.2, Math.cos(angle) * distance));
      this.camera.position = Vector3.Lerp(this.camera.position, desired, dt === 0 ? 1 : Math.min(1, dt * 2.2));
      this.camera.setTarget(focus);
      this.camera.fov = this.mode === 'garage' ? 0.68 : 0.8;
    }
  }

  private updateHud(): void {
    this.onHud?.({ health: this.health, energy: this.energy, heat: this.heat, kills: this.kills, score: this.score, dashCooldown: this.dashCooldown, shieldCooldown: this.shieldCooldown, fps: this.engine.getFps() });
  }

  private finish(won: boolean): void {
    this.setMode('result');
    this.onResult?.(won, this.score);
  }

  private playSound(frequency: number, duration: number, type: OscillatorType, volume: number): void {
    if (!this.soundEnabled) return;
    try {
      this.audio ??= new AudioContext();
      if (this.audio.state === 'suspended') void this.audio.resume();
      const oscillator = this.audio.createOscillator();
      const gain = this.audio.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, this.audio.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, frequency * 0.32), this.audio.currentTime + duration);
      gain.gain.setValueAtTime(volume, this.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audio.currentTime + duration);
      oscillator.connect(gain).connect(this.audio.destination);
      oscillator.start();
      oscillator.stop(this.audio.currentTime + duration);
    } catch { /* Audio is optional when blocked by browser settings. */ }
  }
}
