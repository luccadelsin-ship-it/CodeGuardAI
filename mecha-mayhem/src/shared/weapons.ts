/** Weapon tuning shared by training, online prediction and the authoritative server. */

export type WeaponId = 'mg' | 'shotgun' | 'laser' | 'missile' | 'sword' | 'hammer';
export type WeaponKind = 'hitscan' | 'charge' | 'projectile' | 'melee';

export interface WeaponDef {
  id: WeaponId;
  slot: number;
  name: string;
  mark: string;
  kind: WeaponKind;
  description: string;
  /** Damage per pellet / bolt (laser: damage at full charge). */
  damage: number;
  minDamage: number;
  pellets: number;
  /** Cone half-angle in radians. */
  spread: number;
  /** Extra spread added per consecutive shot (machine gun bloom). */
  bloom: number;
  maxBloom: number;
  interval: number;
  range: number;
  falloffStart: number;
  falloffMin: number;
  heat: number;
  energy: number;
  chargeTime: number;
  minCharge: number;
  projectileSpeed: number;
  splashRadius: number;
  splashDamage: number;
  homing: number;
  pierce: boolean;
  knockback: number;
  recoil: number;
  shake: number;
  /** Movement speed multiplier while this weapon is equipped / charging. */
  weight: number;
  color: [number, number, number];
  stats: { damage: number; rate: number; range: number; control: number };
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  mg: {
    id: 'mg', slot: 1, name: 'METRALHADORA', mark: 'MK I', kind: 'hitscan',
    description: 'Rajada contínua de precisão. Acumula calor e abre a dispersão quando segurada.',
    damage: 8, minDamage: 8, pellets: 1, spread: 0.006, bloom: 0.0035, maxBloom: 0.035, interval: 0.1, range: 80,
    falloffStart: 45, falloffMin: 0.6, heat: 6.2, energy: 0, chargeTime: 0, minCharge: 0, projectileSpeed: 0,
    splashRadius: 0, splashDamage: 0, homing: 0, pierce: false, knockback: 0.15, recoil: 0.08, shake: 0.05, weight: 1,
    color: [0.55, 0.95, 1], stats: { damage: 35, rate: 95, range: 75, control: 70 },
  },
  shotgun: {
    id: 'shotgun', slot: 2, name: 'ESCOPETA', mark: 'BREACHER', kind: 'hitscan',
    description: 'Dez projéteis em leque. Devastadora de perto, empurra e atordoa o alvo.',
    damage: 8.5, minDamage: 8.5, pellets: 10, spread: 0.085, bloom: 0, maxBloom: 0, interval: 0.82, range: 28,
    falloffStart: 7, falloffMin: 0.25, heat: 19, energy: 0, chargeTime: 0, minCharge: 0, projectileSpeed: 0,
    splashRadius: 0, splashDamage: 0, homing: 0, pierce: false, knockback: 3.2, recoil: 0.45, shake: 0.32, weight: 0.96,
    color: [1, 0.72, 0.32], stats: { damage: 95, rate: 30, range: 25, control: 55 },
  },
  laser: {
    id: 'laser', slot: 3, name: 'CANHÃO LASER', mark: 'LANCE', kind: 'charge',
    description: 'Segure para carregar e solte. Feixe perfurante de longo alcance, consome energia.',
    damage: 105, minDamage: 26, pellets: 1, spread: 0, bloom: 0, maxBloom: 0, interval: 0.4, range: 140,
    falloffStart: 140, falloffMin: 1, heat: 0, energy: 24, chargeTime: 1.1, minCharge: 0.18, projectileSpeed: 0,
    splashRadius: 0, splashDamage: 0, homing: 0, pierce: true, knockback: 1.2, recoil: 0.3, shake: 0.22, weight: 0.72,
    color: [1, 0.25, 0.85], stats: { damage: 90, rate: 25, range: 100, control: 85 },
  },
  missile: {
    id: 'missile', slot: 4, name: 'MÍSSEIS', mark: 'HORNET', kind: 'projectile',
    description: 'Mísseis teleguiados com dano em área. Trava no alvo mais próximo da mira.',
    damage: 26, minDamage: 26, pellets: 1, spread: 0.02, bloom: 0, maxBloom: 0, interval: 1.05, range: 90,
    falloffStart: 90, falloffMin: 1, heat: 26, energy: 0, chargeTime: 0, minCharge: 0, projectileSpeed: 31,
    splashRadius: 4.6, splashDamage: 38, homing: 2.6, pierce: false, knockback: 2.4, recoil: 0.35, shake: 0.25, weight: 0.9,
    color: [1, 0.55, 0.15], stats: { damage: 80, rate: 35, range: 85, control: 90 },
  },
  sword: {
    id: 'sword', slot: 5, name: 'ESPADA DE ENERGIA', mark: 'ARC', kind: 'melee',
    description: 'Golpes em arco, combo de três ataques e uma breve defesa contra projéteis.',
    damage: 37, minDamage: 37, pellets: 1, spread: 0, bloom: 0, maxBloom: 0, interval: 0.42, range: 4.3,
    falloffStart: 4.3, falloffMin: 1, heat: 0, energy: 8, chargeTime: 0, minCharge: 0, projectileSpeed: 0,
    splashRadius: 0, splashDamage: 0, homing: 0, pierce: false, knockback: 2.4, recoil: 0.18, shake: 0.12, weight: 1.06,
    color: [0.25, 0.85, 1], stats: { damage: 70, rate: 70, range: 8, control: 80 },
  },
  hammer: {
    id: 'hammer', slot: 6, name: 'MARTELO MECÂNICO', mark: 'QUAKE', kind: 'melee',
    description: 'Golpe pesado em arco com combo de dois ataques e onda de choque no chão.',
    damage: 70, minDamage: 70, pellets: 1, spread: 0, bloom: 0, maxBloom: 0, interval: 1.05, range: 3.7,
    falloffStart: 3.7, falloffMin: 1, heat: 0, energy: 18, chargeTime: 0, minCharge: 0, projectileSpeed: 0,
    splashRadius: 5.5, splashDamage: 26, homing: 0, pierce: false, knockback: 7, recoil: 0.42, shake: 0.36, weight: 0.82,
    color: [1, 0.54, 0.17], stats: { damage: 100, rate: 25, range: 12, control: 45 },
  },
};

export const WEAPON_ORDER: WeaponId[] = ['mg', 'shotgun', 'laser', 'missile', 'sword', 'hammer'];

/** Server and client use the same sweep geometry, measured from the mech origin. */
export function meleeInArc(yaw: number, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, reach: number, halfAngle: number): boolean {
  const dx = to.x - from.x, dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance > reach || Math.abs(to.y - from.y) > 2.8) return false;
  return distance < 0.8 || (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / distance >= Math.cos(halfAngle);
}

export function meleeDamage(id: WeaponId, combo: number): number {
  const def = WEAPONS[id];
  return def.damage * (id === 'sword' ? [1, 1.18, 1.5][combo % 3] : [1, 1.35][combo % 2]);
}

export function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === 'string' && value in WEAPONS;
}

/** Linear falloff between falloffStart and range. */
export function damageAtDistance(def: WeaponDef, baseDamage: number, distance: number): number {
  if (distance <= def.falloffStart) return baseDamage;
  const t = Math.min(1, (distance - def.falloffStart) / Math.max(0.001, def.range - def.falloffStart));
  return baseDamage * (1 - t * (1 - def.falloffMin));
}

export function laserDamage(charge01: number): number {
  const def = WEAPONS.laser;
  return def.minDamage + (def.damage - def.minDamage) * Math.max(0, Math.min(1, charge01)) ** 1.15;
}

export function laserEnergy(charge01: number): number {
  return WEAPONS.laser.energy * (0.45 + 0.55 * Math.max(0, Math.min(1, charge01)));
}

/** Deterministic pellet directions so the server can replay a shotgun blast from one seed. */
export function spreadDirections(forward: { x: number; y: number; z: number }, count: number, spread: number, seed: number): Array<{ x: number; y: number; z: number }> {
  let state = (seed >>> 0) || 1;
  const random = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0xffffffff;
  };
  const len = Math.hypot(forward.x, forward.y, forward.z) || 1;
  const f = { x: forward.x / len, y: forward.y / len, z: forward.z / len };
  // Orthonormal basis around forward.
  const up = Math.abs(f.y) > 0.95 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const rx = up.y * f.z - up.z * f.y, ry = up.z * f.x - up.x * f.z, rz = up.x * f.y - up.y * f.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  const r = { x: rx / rl, y: ry / rl, z: rz / rl };
  const u = { x: f.y * r.z - f.z * r.y, y: f.z * r.x - f.x * r.z, z: f.x * r.y - f.y * r.x };
  const result: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < count; i++) {
    // The first pellet flies true; the rest fill a ring pattern with jitter.
    const ring = i === 0 ? 0 : (i % 2 === 0 ? 1 : 0.55);
    const angle = (i / Math.max(1, count - 1)) * Math.PI * 2 + random() * 0.6;
    const radius = spread * ring * (0.75 + random() * 0.35);
    const ox = Math.cos(angle) * radius;
    const oy = Math.sin(angle) * radius;
    const dx = f.x + r.x * ox + u.x * oy;
    const dy = f.y + r.y * ox + u.y * oy;
    const dz = f.z + r.z * ox + u.z * oy;
    const dl = Math.hypot(dx, dy, dz);
    result.push({ x: dx / dl, y: dy / dl, z: dz / dl });
  }
  return result;
}
