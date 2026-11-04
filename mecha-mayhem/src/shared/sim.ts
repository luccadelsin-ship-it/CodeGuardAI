import type { Arena, HitZone } from './arena.ts';
import { WEAPONS, laserEnergy, type WeaponDef, type WeaponId } from './weapons.ts';

/** Movement tuning. Shared by client prediction and the online server. */
export const MOVE = {
  radius: 0.8,
  walk: 6.1,
  sprint: 9.4,
  backwards: 0.82,
  groundAccel: 10,
  groundBrake: 13,
  airAccel: 2.6,
  gravity: 21,
  jump: 8.4,
  jetAccel: 34,
  jetMaxRise: 4.6,
  jetCost: 24,
  jetCeiling: 6.8,
  dashSpeed: 28,
  dashTime: 0.2,
  dashCooldown: 2.2,
  dashCost: 16,
  shieldTime: 4,
  shieldCooldown: 11,
  shieldCost: 25,
  energyRegen: 12,
  energyDelay: 0.65,
  heatDecay: 20,
  heatDecayIdle: 36,
  overheatRecover: 30,
  impactCooldown: 3.2,
  impactCost: 10,
  maxHealth: 100,
} as const;

export interface MechState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  pushX: number; pushZ: number;
  yaw: number; pitch: number;
  grounded: boolean;
  jumpHeld: boolean;
  jetting: boolean;
  health: number;
  energy: number;
  energyDelay: number;
  heat: number;
  overheated: boolean;
  sinceShot: number;
  bloom: number;
  charge: number;
  fireCd: number;
  weapon: WeaponId;
  dashCd: number; dashTime: number; dashX: number; dashZ: number;
  shieldCd: number; shieldTime: number;
  impactCd: number;
  invulnerable: number;
  meleeCombo: number;
  meleeWindow: number;
  parryTime: number;
  parts: Record<HitZone, number>;
}

export interface MechInput {
  /** Local strafe (-1 left .. 1 right). */
  mx: number;
  /** Local forward (-1 back .. 1 forward). */
  mz: number;
  yaw: number;
  pitch: number;
  sprint: boolean;
  jump: boolean;
  dash: boolean;
  shield: boolean;
}

export interface SimEvents {
  jumped?: boolean;
  landed?: number;
  dashed?: boolean;
  shield?: boolean;
  jetStart?: boolean;
}

export function createMechState(x: number, y: number, z: number, yaw: number, weapon: WeaponId = 'mg'): MechState {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, pushX: 0, pushZ: 0, yaw, pitch: 0.12, grounded: true, jumpHeld: false, jetting: false,
    health: MOVE.maxHealth, energy: 100, energyDelay: 0, heat: 0, overheated: false, sinceShot: 9, bloom: 0, charge: 0,
    fireCd: 0, weapon, dashCd: 0, dashTime: 0, dashX: 0, dashZ: 1, shieldCd: 0, shieldTime: 0, impactCd: 0, invulnerable: 0,
    meleeCombo: 0, meleeWindow: 0, parryTime: 0,
    parts: { head: 45, torso: 120, leftArm: 55, rightArm: 55, leftLeg: 65, rightLeg: 65 },
  };
}

export function clampPitch(pitch: number): number {
  return Math.max(-0.42, Math.min(0.78, pitch));
}

function spendEnergy(s: MechState, amount: number): void {
  s.energy = Math.max(0, s.energy - amount);
  s.energyDelay = MOVE.energyDelay;
}

/** Advance one mech by dt using the given input. Mutates the state. */
export function stepMech(s: MechState, input: MechInput, dt: number, arena: Arena, events: SimEvents = {}): SimEvents {
  s.yaw = Number.isFinite(input.yaw) ? input.yaw : s.yaw;
  s.pitch = clampPitch(Number.isFinite(input.pitch) ? input.pitch : s.pitch);
  const sin = Math.sin(s.yaw);
  const cos = Math.cos(s.yaw);
  let mx = Math.max(-1, Math.min(1, input.mx || 0));
  let mz = Math.max(-1, Math.min(1, input.mz || 0));
  const mag = Math.hypot(mx, mz);
  if (mag > 1) { mx /= mag; mz /= mag; }
  // World-space wish direction. Forward = (sin, cos), right = (cos, -sin).
  const wishX = sin * mz + cos * mx;
  const wishZ = cos * mz - sin * mx;
  const def = WEAPONS[s.weapon];
  const charging = def.kind === 'charge' && s.charge > 0;
  let speed = (input.sprint && !charging ? MOVE.sprint : MOVE.walk) * def.weight * (charging ? 0.7 : 1);
  speed *= 1 - (s.parts.leftLeg <= 0 ? 0.24 : 0) - (s.parts.rightLeg <= 0 ? 0.24 : 0);
  if (mz < -0.1) speed *= MOVE.backwards;

  // Abilities.
  s.dashCd = Math.max(0, s.dashCd - dt);
  s.shieldCd = Math.max(0, s.shieldCd - dt);
  s.shieldTime = Math.max(0, s.shieldTime - dt);
  s.impactCd = Math.max(0, s.impactCd - dt);
  s.invulnerable = Math.max(0, s.invulnerable - dt);
  s.meleeWindow = Math.max(0, s.meleeWindow - dt);
  s.parryTime = Math.max(0, s.parryTime - dt);
  if (input.dash && s.dashCd <= 0 && s.dashTime <= 0 && s.energy >= MOVE.dashCost) {
    const len = Math.hypot(wishX, wishZ);
    s.dashX = len > 0.1 ? wishX / len : sin;
    s.dashZ = len > 0.1 ? wishZ / len : cos;
    s.dashTime = MOVE.dashTime;
    s.dashCd = MOVE.dashCooldown;
    spendEnergy(s, MOVE.dashCost);
    events.dashed = true;
  }
  if (input.shield && s.shieldCd <= 0 && s.energy >= MOVE.shieldCost) {
    s.shieldTime = MOVE.shieldTime;
    s.shieldCd = MOVE.shieldCooldown;
    spendEnergy(s, MOVE.shieldCost);
    events.shield = true;
  }

  // Horizontal velocity.
  if (s.dashTime > 0) {
    s.dashTime = Math.max(0, s.dashTime - dt);
    const fade = s.dashTime > 0 ? 1 : 0.45;
    s.vx = s.dashX * MOVE.dashSpeed * fade;
    s.vz = s.dashZ * MOVE.dashSpeed * fade;
  } else {
    const targetX = wishX * speed;
    const targetZ = wishZ * speed;
    const rate = s.grounded ? (mag > 0.05 ? MOVE.groundAccel : MOVE.groundBrake) : MOVE.airAccel;
    const k = Math.min(1, dt * rate);
    s.vx += (targetX - s.vx) * k;
    s.vz += (targetZ - s.vz) * k;
  }
  const pushDecay = Math.exp(-dt * 5.5);
  s.pushX *= pushDecay;
  s.pushZ *= pushDecay;
  const moveX = (s.vx + s.pushX) * dt;
  const moveZ = (s.vz + s.pushZ) * dt;
  if (arena.canMoveTo(s.x + moveX, s.z, MOVE.radius, s.y)) s.x += moveX;
  else { s.vx = 0; s.pushX = 0; }
  if (arena.canMoveTo(s.x, s.z + moveZ, MOVE.radius, s.y)) s.z += moveZ;
  else { s.vz = 0; s.pushZ = 0; }

  // Vertical: jump, jet hover and gravity.
  const jumpPressed = input.jump && !s.jumpHeld;
  s.jumpHeld = input.jump;
  const wasJetting = s.jetting;
  s.jetting = false;
  if (jumpPressed && s.grounded) {
    s.vy = MOVE.jump;
    s.grounded = false;
    events.jumped = true;
  } else if (input.jump && !s.grounded && !jumpPressed && s.energy > 1 && s.y < arena.deckY + MOVE.jetCeiling && s.vy < MOVE.jetMaxRise) {
    s.vy = Math.min(MOVE.jetMaxRise, s.vy + MOVE.jetAccel * dt);
    spendEnergy(s, MOVE.jetCost * dt);
    s.jetting = true;
    if (!wasJetting) events.jetStart = true;
  }
  s.vy -= MOVE.gravity * dt;
  s.y += s.vy * dt;
  const floor = arena.floorAt(s.x, s.z, MOVE.radius, Math.max(s.y, s.y - s.vy * dt));
  if (s.y <= floor) {
    if (!s.grounded && s.vy < -2) events.landed = -s.vy;
    s.y = floor;
    s.vy = 0;
    s.grounded = true;
  } else if (s.y > floor + 0.02) {
    s.grounded = false;
  }

  // Resources.
  s.energyDelay = Math.max(0, s.energyDelay - dt);
  if (s.energyDelay <= 0) s.energy = Math.min(100, s.energy + MOVE.energyRegen * dt);
  s.sinceShot += dt;
  s.heat = Math.max(0, s.heat - dt * (s.sinceShot > 0.35 ? MOVE.heatDecayIdle : MOVE.heatDecay));
  if (s.overheated && s.heat < MOVE.overheatRecover) s.overheated = false;
  s.bloom = Math.max(0, s.bloom - dt * (s.sinceShot > 0.2 ? 0.12 : 0.02));
  s.fireCd = Math.max(0, s.fireCd - dt);
  return events;
}

export interface FireCommand { weapon: WeaponId; charge: number }

export function weaponOperational(s: MechState): boolean {
  return s.parts.rightArm > 0;
}

export function applyPartDamage(s: MechState, zone: HitZone, amount: number): boolean {
  const before = s.parts[zone];
  s.parts[zone] = Math.max(0, before - amount);
  return before > 0 && s.parts[zone] === 0;
}

/**
 * Trigger handling shared by the client and the server. Returns a fire command
 * when the weapon actually discharges, after paying heat/energy.
 */
export function stepTrigger(s: MechState, held: boolean, dt: number): FireCommand | null {
  const def = WEAPONS[s.weapon];
  if (def.kind === 'charge') {
    if (held && s.fireCd <= 0 && s.energy >= laserEnergy(0)) {
      s.charge = Math.min(def.chargeTime, s.charge + dt);
      return null;
    }
    if (!held && s.charge > 0) {
      const charge = s.charge;
      s.charge = 0;
      if (charge < def.minCharge) return null;
      const charge01 = Math.min(1, charge / def.chargeTime);
      const cost = laserEnergy(charge01);
      if (s.energy < cost * 0.6) return null;
      spendEnergy(s, cost);
      s.fireCd = def.interval;
      s.sinceShot = 0;
      return { weapon: def.id, charge: charge01 };
    }
    if (!held) s.charge = 0;
    return null;
  }
  if (!held || s.fireCd > 0 || s.overheated || !weaponOperational(s) || (def.kind === 'melee' && s.energy < def.energy)) return null;
  applyShotCost(s, def);
  return { weapon: def.id, charge: 1 };
}

export function applyShotCost(s: MechState, def: WeaponDef): void {
  s.fireCd = def.interval;
  s.sinceShot = 0;
  s.heat = Math.min(100, s.heat + def.heat);
  s.bloom = Math.min(def.maxBloom, s.bloom + def.bloom);
  if (s.heat >= 100) s.overheated = true;
  if (def.kind === 'melee') {
    if (s.meleeWindow <= 0) s.meleeCombo = 0;
    s.meleeCombo = (s.meleeCombo % (def.id === 'sword' ? 3 : 2)) + 1;
    s.meleeWindow = def.id === 'sword' ? 1.15 : 1.8;
    if (def.id === 'sword') s.parryTime = 0.34;
    spendEnergy(s, def.energy);
  }
}

export function switchWeapon(s: MechState, weapon: WeaponId): boolean {
  if (s.weapon === weapon) return false;
  s.weapon = weapon;
  s.charge = 0;
  s.meleeCombo = 0;
  s.meleeWindow = 0;
  s.fireCd = Math.max(s.fireCd, 0.28);
  return true;
}

/** Damage multiplier for incoming hits: shields and dashes soak damage. */
export function damageTaken(s: MechState, amount: number, projectile = false): number {
  if (s.invulnerable > 0) return 0;
  if (projectile && s.parryTime > 0) return 0;
  let result = amount;
  if (s.shieldTime > 0) result *= 0.25;
  if (s.dashTime > 0) result *= 0.4;
  return result;
}

/** Third-person aim ray, identical on the client camera and the server validation. */
export function aimOrigin(s: Pick<MechState, 'x' | 'y' | 'z' | 'yaw' | 'pitch'>): { x: number; y: number; z: number } {
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
  return { x: s.x + rx * 1.05 + fx * 0.6, y: s.y + 2.65, z: s.z + rz * 1.05 + fz * 0.6 };
}
