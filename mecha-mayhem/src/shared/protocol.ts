/** Wire protocol for the online mode (JSON over WebSocket at /online). */
import type { MechPalette } from './palette.ts';
import type { MechInput, MechState } from './sim.ts';
import type { WeaponId } from './weapons.ts';
import type { HitZone } from './arena.ts';
import type { MapId } from './maps.ts';
import type { MechPartConfig } from './customization.ts';
export type { MapId } from './maps.ts';

export const PROTOCOL_VERSION = 8;
export type OnlineMode = 'ffa' | 'duel' | 'team2' | 'team5' | 'core';
export type Team = 'blue' | 'orange' | null;
export type MatchPhase = 'waiting' | 'countdown' | 'playing' | 'ended';
export type CoreState = 'neutral' | 'blue' | 'orange' | 'contested';

/** Core Control rules, shared by the server scoring and the client display. */
export const CORE_RULES = {
  /** Capture zone: centre of the arena, on the central deck only. */
  x: 0, z: 0, radius: 7,
  /** Feet must be within this height of the deck top (no scoring from jets or crates). */
  maxHeight: 1.1,
  /** Seconds of uncontested presence to flip the core. */
  captureTime: 3,
  /** Points per second for the owning team. */
  pointsPerSecond: 2,
} as const;

/** How many pilots (humans + bots) a public room fills to. */
export const BOT_FILL: Record<OnlineMode, number> = { ffa: 4, duel: 2, team2: 4, team5: 10, core: 8 };

export function isTeamMode(mode: OnlineMode): boolean { return mode === 'team2' || mode === 'team5' || mode === 'core'; }

export const MODE_RULES: Record<OnlineMode, { label: string; maxPlayers: number; fragLimit: number; timeLimit: number }> = {
  ffa: { label: 'MATA-MATA', maxPlayers: 6, fragLimit: 15, timeLimit: 360 },
  duel: { label: 'DUELO 1V1', maxPlayers: 2, fragLimit: 7, timeLimit: 300 },
  team2: { label: 'TIMES 2V2', maxPlayers: 4, fragLimit: 20, timeLimit: 360 },
  team5: { label: 'TIMES 5V5', maxPlayers: 10, fragLimit: 50, timeLimit: 480 },
  core: { label: 'CORE CONTROL', maxPlayers: 10, fragLimit: 100, timeLimit: 480 },
};

export interface InputFrame extends MechInput { seq: number; dt: number }

export interface PlayerInfo { id: number; name: string; palette: MechPalette; weapon: WeaponId; team: Team; parts: MechPartConfig; bot?: boolean }

export interface PlayerSnap {
  id: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  hp: number;
  w: WeaponId;
  sh: boolean;
  dash: boolean;
  jet: boolean;
  air: boolean;
  alive: boolean;
  inv: boolean;
  charge: number;
  kills: number;
  deaths: number;
  score: number;
  ping: number;
  team: Team;
}

export interface MissileSnap { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number }

export type ClientMessage =
  | { t: 'hello'; v: number; name: string; palette: MechPalette; weapon: WeaponId; mode: OnlineMode; map: MapId; parts?: MechPartConfig; room?: string; create?: boolean }
  | { t: 'input'; frames: InputFrame[] }
  | { t: 'fire'; weapon: WeaponId; o: [number, number, number]; d: [number, number, number]; charge: number; seed: number; rt: number; target?: number }
  | { t: 'weapon'; weapon: WeaponId }
  | { t: 'charge'; amount: number }
  | { t: 'impact'; rt: number }
  | { t: 'ping'; c: number; p?: number };

export type ServerMessage =
  | { t: 'welcome'; id: number; room: string; mode: OnlineMode; map: MapId; private: boolean; players: PlayerInfo[]; time: number }
  | { t: 'join'; player: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'info'; player: PlayerInfo }
  | { t: 'snap'; time: number; ack: number; phase: MatchPhase; timer: number; me: MechState | null; players: PlayerSnap[]; missiles: MissileSnap[]; teamScores: [number, number]; coreOwner: Team; coreState: CoreState; coreProgress: number }
  | { t: 'shot'; id: number; weapon: WeaponId; o: [number, number, number]; ends: Array<[number, number, number]>; charge: number }
  | { t: 'hit'; target: number; by: number; amount: number; crit: boolean; zone: HitZone; detached: boolean; hp: number; at: [number, number, number] }
  | { t: 'kill'; killer: number; victim: number; weapon: WeaponId | 'impact' | 'missile' }
  | { t: 'spawn'; id: number; x: number; y: number; z: number; yaw: number }
  | { t: 'boom'; x: number; y: number; z: number; r: number }
  | { t: 'impact'; id: number }
  | { t: 'phase'; phase: MatchPhase; timer: number; ranking?: Array<{ id: number; name: string; kills: number; deaths: number; score: number; team: Team; bot: boolean }>; winnerTeam?: Team | 'draw'; winnerId?: number | null; teamScores?: [number, number] }
  | { t: 'pong'; c: number; s: number }
  | { t: 'error'; message: string };
