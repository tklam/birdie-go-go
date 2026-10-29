// The memory mini game's rules (pure): a grid of face-down cards in pairs;
// flip two, matches stay up, misses flip back. Win by matching every pair
// before the moves run out.

/** Most pairs a board holds (3 rows of 8 cards on the 320×180 screen). */
export const MAX_PAIRS = 12;

export interface MemoryState {
  /** The icon on each card, by board position. */
  cards: string[];
  matched: boolean[];
  /** Face-up cards not yet matched (at most two). */
  up: number[];
  /** Turns taken (a turn is two flips). */
  moves: number;
  maxMoves: number;
}

export type FlipResult = 'ignored' | 'first' | 'match' | 'miss';

/** How many pairs to play: `pairs` (default: one per icon), at most one per icon and MAX_PAIRS. */
export function pairCount(pairs: number | undefined, icons: number): number {
  const want = pairs && pairs > 0 ? pairs : icons;
  return Math.max(0, Math.min(want, icons, MAX_PAIRS));
}

/**
 * Turns allowed: one per pair plus pairs×2+4 misses, more with the easier
 * setting (`slower` ≥ 1).
 */
export function moveLimit(pairs: number, slower = 1): number {
  return pairs + Math.ceil((pairs * 2 + 4) * Math.max(1, slower));
}

/** Two cards of each of the first `pairs` icons, shuffled with `random`. */
export function deal(icons: readonly string[], pairs: number, random: () => number): string[] {
  const out: string[] = [];
  for (const icon of icons.slice(0, pairs)) out.push(icon, icon);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function startMemory(cards: readonly string[], maxMoves: number): MemoryState {
  return { cards: [...cards], matched: cards.map(() => false), up: [], moves: 0, maxMoves };
}

/** Whether a card shows its face (matched or turned up this turn). */
export function faceUp(state: MemoryState, index: number): boolean {
  return state.matched[index] || state.up.includes(index);
}

/**
 * Flips a card. Ignored when the card is already up, out of range, two
 * cards wait to flip back, or the game is over. Mutates state.
 */
export function flip(state: MemoryState, index: number): FlipResult {
  if (index < 0 || index >= state.cards.length) return 'ignored';
  if (state.up.length >= 2 || faceUp(state, index) || memoryOver(state)) return 'ignored';
  state.up.push(index);
  if (state.up.length === 1) return 'first';
  state.moves++;
  const [a, b] = state.up;
  if (state.cards[a] === state.cards[b]) {
    state.matched[a] = state.matched[b] = true;
    state.up = [];
    return 'match';
  }
  return 'miss';
}

/** Turns a missed pair face down again; returns the cards turned. */
export function hideMiss(state: MemoryState): number[] {
  if (state.up.length < 2) return [];
  const down = state.up;
  state.up = [];
  return down;
}

export function pairsMatched(state: MemoryState): number {
  return state.matched.filter(Boolean).length / 2;
}

export function memoryWon(state: MemoryState): boolean {
  return state.cards.length > 0 && state.matched.every(Boolean);
}

export function movesLeft(state: MemoryState): number {
  return Math.max(0, state.maxMoves - state.moves);
}

/** Won, or out of moves with no missed pair still showing. */
export function memoryOver(state: MemoryState): boolean {
  return memoryWon(state) || (movesLeft(state) === 0 && state.up.length === 0);
}

/** Columns and rows for `cards` cards: at most 8 columns, 2+ rows from 6 cards. */
export function memoryGrid(cards: number): { cols: number; rows: number } {
  if (cards <= 0) return { cols: 0, rows: 0 };
  const rows = Math.max(cards >= 6 ? 2 : 1, Math.ceil(cards / 8));
  return { cols: Math.ceil(cards / rows), rows };
}

/** The card the cursor lands on after an arrow key (clamped to the board). */
export function moveCursor(index: number, dx: number, dy: number, cols: number, count: number): number {
  const col = Math.min(cols - 1, Math.max(0, (index % cols) + dx));
  const row = Math.max(0, Math.floor(index / cols) + dy);
  const next = row * cols + col;
  return next < count ? next : index;
}
