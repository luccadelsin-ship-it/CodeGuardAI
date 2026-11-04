/**
 * Chassis choices: one family per slot (head, torso with arms, legs).
 * Combat stats come from src/shared/parts.ts and are recomputed by the server.
 */
import { FAMILIES, FAMILY_ORDER, computeLoadout, isFamily, type FamilyId } from './parts.ts';
import type { WeaponId } from './weapons.ts';

export type PartStyle = FamilyId;
export interface MechPartConfig { head: PartStyle; torso: PartStyle; legs: PartStyle }

export const DEFAULT_PARTS: MechPartConfig = { head: 'striker', torso: 'striker', legs: 'striker' };
export const PART_STYLES: Array<{ id: PartStyle; name: string; detail: string }> = FAMILY_ORDER.map((id) => ({ id, name: FAMILIES[id].name, detail: FAMILIES[id].detail }));

export function normalizeParts(value: unknown): MechPartConfig {
  const source = value && typeof value === 'object' ? value as Partial<MechPartConfig> : {};
  const valid = (part: unknown): PartStyle => isFamily(part) ? part : 'striker';
  return { head: valid(source.head), torso: valid(source.torso), legs: valid(source.legs) };
}

/** Server-side validation: overloaded builds beyond the limit fall back to the default chassis. */
export function validateParts(value: unknown, weapon: WeaponId): MechPartConfig {
  const parts = normalizeParts(value);
  return computeLoadout(parts, weapon).rejected ? { ...DEFAULT_PARTS } : parts;
}
