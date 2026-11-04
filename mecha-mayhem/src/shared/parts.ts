/**
 * Modular chassis balance, shared by the workshop, training, client prediction
 * and the authoritative server. Values come from public/assets/modular/catalog.json
 * (proposed balance) and are copied here so the server never trusts the client.
 *
 * Load rules (all weights in kg):
 *  - Legs carry head + torso (with both arms) + the equipped weapon.
 *  - The torso carries the head + the equipped weapon.
 *  - A part's own weight is never counted against its own capacity.
 *  - Load ratio = carried / capacity. Up to 100% there is no penalty.
 *  - 100%..135% is OVERLOAD: speed, jump and jet drop and energy costs rise.
 *  - Above 135% the build is rejected (workshop blocks it, server resets it to Striker).
 */
import type { WeaponId } from './weapons.ts';

export type FamilyId = 'scout' | 'striker' | 'titan' | 'phantom' | 'industrial' | 'spectre' | 'vanguard' | 'ronin' | 'warden' | 'tempest';
export type PartSlot = 'head' | 'torso' | 'legs';

interface HeadStats { weight: number; support: number; durability: number; armor: number }
interface TorsoStats extends HeadStats { energy: number }
interface LegStats extends HeadStats { speed: number }

export interface FamilyDef {
  id: FamilyId;
  name: string;
  /** Silhouette used by the procedural chassis. */
  shape: 'scout' | 'striker' | 'titan';
  /** Accent colours for armour trims and lights. */
  accent: string;
  light: string;
  detail: string;
  head: HeadStats;
  torso: TorsoStats;
  legs: LegStats;
}

export const FAMILIES: Record<FamilyId, FamilyDef> = {
  scout: { id: 'scout', name: 'SCOUT', shape: 'scout', accent: '#3d8bff', light: '#58deff', detail: 'Reconhecimento leve e rápido', head: { weight: 180, support: 72, durability: 80, armor: 12 }, torso: { weight: 780, support: 900, durability: 192, armor: 12, energy: 135 }, legs: { weight: 620, support: 2400, durability: 152, armor: 12, speed: 8.2 } },
  striker: { id: 'striker', name: 'STRIKER', shape: 'striker', accent: '#e9743a', light: '#58deff', detail: 'Equilíbrio entre proteção e mobilidade', head: { weight: 260, support: 104, durability: 100, armor: 20 }, torso: { weight: 1150, support: 1250, durability: 240, armor: 20, energy: 120 }, legs: { weight: 950, support: 3600, durability: 190, armor: 20, speed: 6.6 } },
  titan: { id: 'titan', name: 'TITAN', shape: 'titan', accent: '#f2c230', light: '#ffe08a', detail: 'Blindagem pesada, lento', head: { weight: 580, support: 232, durability: 165, armor: 36 }, torso: { weight: 2450, support: 2000, durability: 396, armor: 36, energy: 90 }, legs: { weight: 1800, support: 6500, durability: 314, armor: 36, speed: 4.5 } },
  phantom: { id: 'phantom', name: 'PHANTOM', shape: 'scout', accent: '#7a4fd6', light: '#c06bff', detail: 'Furtivo, leve, muita energia', head: { weight: 210, support: 84, durability: 85, armor: 14 }, torso: { weight: 860, support: 1000, durability: 204, armor: 14, energy: 145 }, legs: { weight: 690, support: 2600, durability: 162, armor: 14, speed: 7.8 } },
  industrial: { id: 'industrial', name: 'INDUSTRIAL', shape: 'titan', accent: '#ff8a1c', light: '#3ff0d0', detail: 'Carga máxima, robusto', head: { weight: 460, support: 184, durability: 150, armor: 32 }, torso: { weight: 2150, support: 2300, durability: 360, armor: 32, energy: 105 }, legs: { weight: 1650, support: 7200, durability: 285, armor: 32, speed: 4.8 } },
  spectre: { id: 'spectre', name: 'SPECTRE', shape: 'striker', accent: '#c9f2ff', light: '#46e6ff', detail: 'Bateria grande, médio', head: { weight: 290, support: 116, durability: 105, armor: 18 }, torso: { weight: 1080, support: 1400, durability: 252, armor: 18, energy: 170 }, legs: { weight: 880, support: 3400, durability: 200, armor: 18, speed: 6.8 } },
  vanguard: { id: 'vanguard', name: 'VANGUARD', shape: 'striker', accent: '#7f8f3a', light: '#5cf0c8', detail: 'Linha de frente resistente', head: { weight: 340, support: 136, durability: 125, armor: 27 }, torso: { weight: 1560, support: 1700, durability: 300, armor: 27, energy: 125 }, legs: { weight: 1190, support: 4600, durability: 238, armor: 27, speed: 5.9 } },
  ronin: { id: 'ronin', name: 'RONIN', shape: 'scout', accent: '#c8262e', light: '#9fe4ff', detail: 'Duelista ágil, bom com espada', head: { weight: 300, support: 120, durability: 110, armor: 22 }, torso: { weight: 1240, support: 1450, durability: 264, armor: 22, energy: 130 }, legs: { weight: 1020, support: 3800, durability: 209, armor: 22, speed: 7.1 } },
  warden: { id: 'warden', name: 'WARDEN', shape: 'titan', accent: '#2a3f7a', light: '#9ccbff', detail: 'Guardião blindado', head: { weight: 520, support: 208, durability: 155, armor: 35 }, torso: { weight: 2300, support: 2100, durability: 372, armor: 35, energy: 110 }, legs: { weight: 1720, support: 6100, durability: 294, armor: 35, speed: 4.9 } },
  tempest: { id: 'tempest', name: 'TEMPEST', shape: 'scout', accent: '#1aa6a0', light: '#c8fbff', detail: 'Assalto rápido', head: { weight: 250, support: 100, durability: 95, armor: 17 }, torso: { weight: 980, support: 1100, durability: 228, armor: 17, energy: 155 }, legs: { weight: 790, support: 3000, durability: 180, armor: 17, speed: 8.0 } },
};

export const FAMILY_ORDER: FamilyId[] = ['scout', 'striker', 'titan', 'phantom', 'industrial', 'spectre', 'vanguard', 'ronin', 'warden', 'tempest'];

export const WEAPON_WEIGHT: Record<WeaponId, number> = { mg: 320, shotgun: 380, laser: 450, missile: 560, sword: 260, hammer: 640 };

export const LOAD_RULES = { overloadStart: 1, overloadLimit: 1.35 } as const;

/** Baseline Striker numbers; every multiplier is relative to these. */
const BASE = { durability: 530, armor: 20, energy: 120, speed: 6.6 };

export interface Loadout {
  /** Total chassis weight + weapon (kg). */
  weight: number;
  legsLoad: number; legsCapacity: number;
  torsoLoad: number; torsoCapacity: number;
  /** Worst load ratio (legs or torso). */
  load: number;
  overloaded: boolean;
  rejected: boolean;
  durability: number;
  armor: number;
  energyCapacity: number;
  /** Top walking speed in m/s after overload. */
  speed: number;
  speedMul: number;
  jumpMul: number;
  energyCostMul: number;
  energyRegenMul: number;
  /** Incoming damage multiplier from durability and armour. */
  damageMul: number;
  /** Integrity of each hit zone (localized damage). */
  zones: { head: number; torso: number; leftArm: number; rightArm: number; leftLeg: number; rightLeg: number };
}

export function isFamily(value: unknown): value is FamilyId {
  return typeof value === 'string' && Object.hasOwn(FAMILIES, value);
}

export function computeLoadout(parts: { head: FamilyId; torso: FamilyId; legs: FamilyId }, weapon: WeaponId): Loadout {
  const head = FAMILIES[parts.head].head, torso = FAMILIES[parts.torso].torso, legs = FAMILIES[parts.legs].legs;
  const weaponWeight = WEAPON_WEIGHT[weapon] ?? 400;
  const legsLoad = head.weight + torso.weight + weaponWeight;
  const torsoLoad = head.weight + weaponWeight;
  const load = Math.max(legsLoad / legs.support, torsoLoad / torso.support);
  const over = Math.max(0, load - LOAD_RULES.overloadStart);
  const durability = head.durability + torso.durability + legs.durability;
  const armor = head.armor * 0.2 + torso.armor * 0.5 + legs.armor * 0.3;
  const durabilityMul = 0.5 + 0.5 * (durability / BASE.durability);
  const armorMul = (1 - armor * 0.006) / (1 - BASE.armor * 0.006);
  const legSpeed = 1 + (legs.speed / BASE.speed - 1) * 0.7;
  const overloadSpeed = Math.max(0.55, 1 - over * 1.15);
  const energyRatio = torso.energy / BASE.energy;
  const speedMul = legSpeed * overloadSpeed;
  return {
    weight: head.weight + torso.weight + legs.weight + weaponWeight,
    legsLoad, legsCapacity: legs.support, torsoLoad, torsoCapacity: torso.support,
    load, overloaded: load > LOAD_RULES.overloadStart, rejected: load > LOAD_RULES.overloadLimit,
    durability, armor: Math.round(armor), energyCapacity: torso.energy,
    speed: Math.round(6.1 * speedMul * 10) / 10,
    speedMul,
    jumpMul: Math.max(0.6, 1 - over * 1.2),
    energyCostMul: (1 / (0.5 + 0.5 * energyRatio)) * (1 + over * 1.5),
    energyRegenMul: 0.6 + 0.4 * energyRatio,
    damageMul: armorMul / durabilityMul,
    zones: {
      head: Math.round(45 * head.durability / 100),
      torso: Math.round(120 * torso.durability / 240),
      leftArm: Math.round(55 * torso.durability / 240), rightArm: Math.round(55 * torso.durability / 240),
      leftLeg: Math.round(65 * legs.durability / 190), rightLeg: Math.round(65 * legs.durability / 190),
    },
  };
}
