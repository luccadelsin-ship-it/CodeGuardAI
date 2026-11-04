/** Cosmetic chassis choices. Hitboxes and combat stats stay shared and fixed. */
export type PartStyle = 'scout' | 'striker' | 'titan';
export interface MechPartConfig { head: PartStyle; torso: PartStyle; legs: PartStyle }

export const DEFAULT_PARTS: MechPartConfig = { head: 'striker', torso: 'striker', legs: 'striker' };
export const PART_STYLES: Array<{ id: PartStyle; name: string; detail: string }> = [
  { id: 'scout', name: 'SCOUT', detail: 'Silhueta leve · aletas de reconhecimento' },
  { id: 'striker', name: 'STRIKER', detail: 'Blindagem equilibrada · chassi original' },
  { id: 'titan', name: 'TITAN', detail: 'Placas largas · reforços de combate' },
];

export function normalizeParts(value: unknown): MechPartConfig {
  const source = value && typeof value === 'object' ? value as Partial<MechPartConfig> : {};
  const valid = (part: unknown): PartStyle => part === 'scout' || part === 'titan' ? part : 'striker';
  return { head: valid(source.head), torso: valid(source.torso), legs: valid(source.legs) };
}
