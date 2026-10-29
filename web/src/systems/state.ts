// The save-able game state (SPEC.md §9.8). Plain JSON only: no Sets, Maps,
// classes or undefined-valued keys that matter, so it round-trips through
// JSON.stringify and IndexedDB unchanged.
import type { ContentBundle } from '../core/types.gen';

/** Bumped whenever GameState changes shape; see migrations in save.ts. */
export const CURRENT_SAVE_VERSION = 3;

export const TIME_SLOTS = ['morning', 'afternoon', 'evening'] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number];

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

/** Days per season (SPEC.md §3.1). */
export const SEASON_DAYS = 14;

/** Kei's romance stages in story order (SPEC.md §2.3, AGENTS.md rule 3). */
export const KEI_STAGES = ['none', 'met', 'friends', 'dating', 'engaged', 'married'] as const;
export type KeiStage = (typeof KEI_STAGES)[number];

export const COMPANIONS = ['oboy', 'kei'] as const;
export type Companion = (typeof COMPANIONS)[number];

export const BOND_MIN = 0;
export const BOND_MAX = 100;

/** Money a new game starts with. */
export const START_MONEY = 500;

export type PhotoRating = 'perfect' | 'great' | 'good' | 'blurry';

/** The best photo of one species (SPEC.md §5.6). */
export interface AlbumEntry {
  species: string;
  score: number;
  rating: PhotoRating;
  day: number;
  slot: TimeSlot;
  area: string;
  spot: string;
  /** Companions in the party when the photo was taken. */
  companions: string[];
}

export interface StudentProgress {
  progress: number;
  lessons: number;
}

export interface Position {
  map: string;
  spawn?: string;
  x?: number;
  y?: number;
}

export const TEXT_SPEEDS = ['slow', 'normal', 'fast', 'instant'] as const;
export type TextSpeed = (typeof TEXT_SPEEDS)[number];
export const WINDOW_COLORS = ['blue', 'green', 'plum', 'grey'] as const;
export type WindowColor = (typeof WINDOW_COLORS)[number];

export interface Settings {
  latencyOffsetMs: number;
  tapToMove: boolean;
  /** 0–1. */
  musicVolume: number;
  /** 0–1. */
  sfxVolume: number;
  /** Calmer screen effects: fades instead of wipes, no shake or flash, gentle rain. */
  reducedMotion: boolean;
  /** Dialogue typewriter speed. */
  textSpeed: TextSpeed;
  /** Colour theme of menu and dialogue windows. */
  windowColor: WindowColor;
  /** Encounters (SPEC.md §4.13): holding fills the run meter instead of mashing. */
  holdInsteadOfMash: boolean;
  /** Encounters: combo windows are 1.5× longer. */
  slowerPrompts: boolean;
  /** Encounters: offer "Skip" (auto-escape for half the Energy cost). */
  skipEncounters: boolean;
}

export interface GameState {
  saveVersion: number;
  /** uint32 seed for deterministic lessons and weather. */
  worldSeed: number;
  flags: Record<string, true>;
  /** Ids of once-events that have already fired. */
  firedEvents: Record<string, true>;
  chapter: number;
  /** 1-based day counter. */
  day: number;
  slot: TimeSlot;
  money: number;
  items: Record<string, number>;
  /** Companions currently along. */
  party: string[];
  /** Companions met (available for the party). */
  joined: string[];
  bond: Record<Companion, number>;
  keiStage: KeiStage;
  album: Record<string, AlbumEntry>;
  students: Record<string, StudentProgress>;
  position: Position;
  settings: Settings;
  /** 0–100, the game's HP (SPEC.md §4.12). Added in save version 2. */
  energy: number;
  /** Worn gear by slot (head, body, hand) → item id. */
  equipped: Partial<Record<GearSlot, string>>;
  /** Consumables in effect → time slots left (e.g. sunscreen). */
  active: Record<string, number>;
  /** Transit card balance (SPEC.md §4.11). Added in save version 3. */
  card: number;
}

export const GEAR_SLOTS = ['head', 'body', 'hand'] as const;
export type GearSlot = (typeof GEAR_SLOTS)[number];
export const MAX_ENERGY = 100;

export function defaultSettings(): Settings {
  return {
    latencyOffsetMs: 0,
    tapToMove: true,
    musicVolume: 0.8,
    sfxVolume: 0.8,
    reducedMotion: false,
    textSpeed: 'normal',
    windowColor: 'blue',
    holdInsteadOfMash: false,
    slowerPrompts: false,
    skipEncounters: false,
  };
}

/** A fresh save: day 1 morning at the content's start position. */
export function newGame(content: ContentBundle, seed: number): GameState {
  return {
    saveVersion: CURRENT_SAVE_VERSION,
    worldSeed: seed >>> 0,
    flags: {},
    firedEvents: {},
    chapter: 0,
    day: 1,
    slot: 'morning',
    money: START_MONEY,
    items: {},
    party: [],
    joined: [],
    bond: { oboy: 0, kei: 0 },
    keiStage: 'none',
    album: {},
    students: {},
    position: { map: content.game.startMap, spawn: content.game.startSpawn },
    settings: defaultSettings(),
    card: content.game.transitCard?.startBalance ?? 0,
    energy: MAX_ENERGY,
    equipped: {},
    active: {},
  };
}

/** The season of a 1-based day; seasons last 14 days and start with spring. */
export function season(day: number): Season {
  const index = Math.floor((Math.max(1, Math.floor(day)) - 1) / SEASON_DAYS) % SEASONS.length;
  return SEASONS[index];
}

export function isTimeSlot(value: unknown): value is TimeSlot {
  return typeof value === 'string' && (TIME_SLOTS as readonly string[]).includes(value);
}

export function isKeiStage(value: unknown): value is KeiStage {
  return typeof value === 'string' && (KEI_STAGES as readonly string[]).includes(value);
}

export function isCompanion(value: unknown): value is Companion {
  return typeof value === 'string' && (COMPANIONS as readonly string[]).includes(value);
}

export function clampBond(value: number): number {
  return Math.min(BOND_MAX, Math.max(BOND_MIN, value));
}
