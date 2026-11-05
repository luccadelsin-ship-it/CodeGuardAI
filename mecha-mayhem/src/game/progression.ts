/**
 * Player progression: XP and levels, in-game credits, a free Season Pass and a
 * cosmetic shop. Everything is earned by playing (no real money) and saved in
 * this browser. Cosmetics only change visual effects, never combat stats, so the
 * online server does not need to validate them.
 */

export type CosmeticSlot = 'trail' | 'kill' | 'glow';

export interface ShopItem {
  id: string;
  slot: CosmeticSlot;
  name: string;
  detail: string;
  price: number;
  /** Effect colour as [r, g, b] 0..1; glow items use it as the weapon light colour. */
  color: [number, number, number];
  /** Level needed before it can be bought (0 = any). */
  level: number;
}

export const SHOP: ShopItem[] = [
  { id: 'trail-cyan', slot: 'trail', name: 'RASTRO ÁRTICO', detail: 'Rastro padrão do dash', price: 0, color: [0.4, 0.85, 1], level: 0 },
  { id: 'trail-magma', slot: 'trail', name: 'RASTRO MAGMA', detail: 'Dash deixa brasas laranja', price: 300, color: [1, 0.45, 0.12], level: 2 },
  { id: 'trail-plasma', slot: 'trail', name: 'RASTRO PLASMA', detail: 'Dash rosa elétrico', price: 450, color: [1, 0.3, 0.9], level: 4 },
  { id: 'trail-toxic', slot: 'trail', name: 'RASTRO TÓXICO', detail: 'Dash verde radioativo', price: 600, color: [0.4, 1, 0.35], level: 6 },
  { id: 'trail-gold', slot: 'trail', name: 'RASTRO DOURADO', detail: 'Dash de ouro líquido', price: 1200, color: [1, 0.82, 0.25], level: 10 },
  { id: 'kill-default', slot: 'kill', name: 'ABATE PADRÃO', detail: 'Explosão normal', price: 0, color: [1, 0.55, 0.2], level: 0 },
  { id: 'kill-storm', slot: 'kill', name: 'ABATE TEMPESTADE', detail: 'Anel elétrico azul ao destruir', price: 400, color: [0.35, 0.75, 1], level: 3 },
  { id: 'kill-void', slot: 'kill', name: 'ABATE VÓRTICE', detail: 'Implosão roxa com onda dupla', price: 700, color: [0.65, 0.3, 1], level: 7 },
  { id: 'kill-gold', slot: 'kill', name: 'ABATE DOURADO', detail: 'Chuva de faíscas de ouro', price: 1500, color: [1, 0.82, 0.25], level: 12 },
  { id: 'glow-default', slot: 'glow', name: 'BRILHO DE FÁBRICA', detail: 'Cor original de cada arma', price: 0, color: [0, 0, 0], level: 0 },
  { id: 'glow-ice', slot: 'glow', name: 'BRILHO GELO', detail: 'Luzes das armas azul-gelo', price: 350, color: [0.55, 0.9, 1], level: 2 },
  { id: 'glow-crimson', slot: 'glow', name: 'BRILHO CARMIM', detail: 'Luzes das armas vermelhas', price: 500, color: [1, 0.15, 0.2], level: 5 },
  { id: 'glow-venom', slot: 'glow', name: 'BRILHO VENENO', detail: 'Luzes das armas verde-limão', price: 650, color: [0.6, 1, 0.2], level: 8 },
  { id: 'glow-gold', slot: 'glow', name: 'BRILHO DOURADO', detail: 'Armas com luz de ouro', price: 1400, color: [1, 0.8, 0.3], level: 14 },
];

export interface PassTier { tier: number; reward: { credits?: number; item?: string; title?: string } }

/** Season 1: 30 free tiers. Each tier needs PASS_TIER_XP season XP. */
export const PASS_TIER_XP = 800;
export const SEASON_PASS: PassTier[] = Array.from({ length: 30 }, (_, i) => {
  const tier = i + 1;
  const items: Record<number, string> = { 5: 'trail-magma', 10: 'kill-storm', 15: 'glow-crimson', 20: 'trail-toxic', 25: 'kill-void', 30: 'trail-gold' };
  const titles: Record<number, string> = { 8: 'RECRUTA DE AÇO', 18: 'CAÇADOR DE DRONES', 28: 'LENDA DO OUTPOST' };
  return { tier, reward: items[tier] ? { item: items[tier] } : titles[tier] ? { title: titles[tier], credits: 150 } : { credits: tier % 2 ? 100 : 150 } };
});

export interface Profile {
  xp: number;
  credits: number;
  owned: string[];
  equipped: Record<CosmeticSlot, string>;
  passXp: number;
  claimed: number[];
  titles: string[];
  title: string;
  matches: number;
}

const KEY = 'mecha-mayhem:profile';
const DEFAULT: Profile = {
  xp: 0, credits: 200, owned: ['trail-cyan', 'kill-default', 'glow-default'],
  equipped: { trail: 'trail-cyan', kill: 'kill-default', glow: 'glow-default' },
  passXp: 0, claimed: [], titles: ['PILOTO'], title: 'PILOTO', matches: 0,
};

/** XP needed to go from `level` to `level + 1`. */
export function xpForLevel(level: number): number { return 600 + (level - 1) * 200; }

export function levelInfo(xp: number): { level: number; into: number; need: number } {
  let level = 1, left = xp;
  while (left >= xpForLevel(level)) { left -= xpForLevel(level); level++; }
  return { level, into: left, need: xpForLevel(level) };
}

export function passTier(passXp: number): number { return Math.min(SEASON_PASS.length, Math.floor(passXp / PASS_TIER_XP)); }

export function loadProfile(): Profile {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Profile> | null;
    if (!raw) return structuredClone(DEFAULT);
    return { ...structuredClone(DEFAULT), ...raw, equipped: { ...DEFAULT.equipped, ...(raw.equipped ?? {}) } };
  } catch { return structuredClone(DEFAULT); }
}

export function saveProfile(p: Profile): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

export interface MatchSummary { xp: number; credits: number; levelBefore: number; levelAfter: number; tiersBefore: number; tiersAfter: number }

/** Award XP, credits and pass progress for one finished match. */
export function awardMatch(p: Profile, m: { score: number; kills: number; won: boolean; waves: number; online: boolean }): MatchSummary {
  const levelBefore = levelInfo(p.xp).level;
  const tiersBefore = passTier(p.passXp);
  const xp = Math.round(Math.min(2500, m.kills * 45 + m.waves * 120 + (m.won ? 400 : 120) + m.score / 60 + (m.online ? 150 : 0)));
  const credits = Math.round(xp / 8) + (m.won ? 60 : 0);
  p.xp += xp;
  p.passXp += xp;
  p.credits += credits;
  p.matches++;
  const levelAfter = levelInfo(p.xp).level;
  // Level-ups also pay a small bonus.
  p.credits += (levelAfter - levelBefore) * 100;
  saveProfile(p);
  return { xp, credits: credits + (levelAfter - levelBefore) * 100, levelBefore, levelAfter, tiersBefore, tiersAfter: passTier(p.passXp) };
}

export function claimTier(p: Profile, tier: number): string | null {
  if (tier > passTier(p.passXp) || p.claimed.includes(tier)) return null;
  const reward = SEASON_PASS[tier - 1].reward;
  p.claimed.push(tier);
  const parts: string[] = [];
  if (reward.credits) { p.credits += reward.credits; parts.push(`+${reward.credits} créditos`); }
  if (reward.item && !p.owned.includes(reward.item)) { p.owned.push(reward.item); parts.push(SHOP.find((s) => s.id === reward.item)?.name ?? reward.item); }
  if (reward.title && !p.titles.includes(reward.title)) { p.titles.push(reward.title); parts.push(`título ${reward.title}`); }
  saveProfile(p);
  return parts.join(' · ');
}

export function buyItem(p: Profile, id: string): 'ok' | 'owned' | 'credits' | 'level' {
  const item = SHOP.find((s) => s.id === id);
  if (!item) return 'credits';
  if (p.owned.includes(id)) return 'owned';
  if (levelInfo(p.xp).level < item.level) return 'level';
  if (p.credits < item.price) return 'credits';
  p.credits -= item.price;
  p.owned.push(id);
  saveProfile(p);
  return 'ok';
}

export function equip(p: Profile, id: string): boolean {
  const item = SHOP.find((s) => s.id === id);
  if (!item || !p.owned.includes(id)) return false;
  p.equipped[item.slot] = id;
  saveProfile(p);
  return true;
}

export function equippedItem(p: Profile, slot: CosmeticSlot): ShopItem {
  return SHOP.find((s) => s.id === p.equipped[slot]) ?? SHOP.find((s) => s.slot === slot)!;
}
