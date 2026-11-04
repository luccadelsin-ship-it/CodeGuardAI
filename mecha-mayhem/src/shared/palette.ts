export type MechPalette = 'arctic' | 'ember' | 'phantom' | 'steel';
export const PALETTE_IDS: MechPalette[] = ['arctic', 'ember', 'phantom', 'steel'];
export function isPalette(value: unknown): value is MechPalette {
  return typeof value === 'string' && (PALETTE_IDS as string[]).includes(value);
}
