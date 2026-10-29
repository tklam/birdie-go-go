import { describe, expect, it } from 'vitest';
import { rng } from '../encounter/random';
import {
  deal,
  faceUp,
  flip,
  hideMiss,
  memoryGrid,
  memoryOver,
  memoryWon,
  moveCursor,
  moveLimit,
  movesLeft,
  pairCount,
  pairsMatched,
  startMemory,
  MAX_PAIRS,
} from './memory';

describe('pairCount', () => {
  it.each([
    { pairs: 3, icons: 5, want: 3 },
    { pairs: 8, icons: 5, want: 5 },
    { pairs: undefined, icons: 4, want: 4 },
    { pairs: 0, icons: 4, want: 4 },
    { pairs: 20, icons: 20, want: MAX_PAIRS },
    { pairs: 3, icons: 0, want: 0 },
  ])('pairs $pairs with $icons icons → $want', ({ pairs, icons, want }) => {
    expect(pairCount(pairs, icons)).toBe(want);
  });
});

describe('moveLimit', () => {
  it.each([
    { pairs: 4, slower: 1, want: 4 + 12 },
    { pairs: 6, slower: 1, want: 6 + 16 },
    { pairs: 6, slower: 1.5, want: 6 + 24 },
    { pairs: 3, slower: 0.5, want: 3 + 10 },
  ])('$pairs pairs, slower $slower → $want', ({ pairs, slower, want }) => {
    expect(moveLimit(pairs, slower)).toBe(want);
  });

  it('gives more moves with the easier setting', () => {
    expect(moveLimit(5, 1.5)).toBeGreaterThan(moveLimit(5, 1));
  });
});

describe('deal', () => {
  it('lays two of each chosen icon', () => {
    const cards = deal(['a', 'b', 'c', 'd'], 3, rng(7));
    expect(cards).toHaveLength(6);
    expect([...cards].sort()).toEqual(['a', 'a', 'b', 'b', 'c', 'c']);
  });

  it('is deterministic for a seed', () => {
    const icons = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(deal(icons, 6, rng(42))).toEqual(deal(icons, 6, rng(42)));
  });
});

describe('flip', () => {
  const board = () => startMemory(['a', 'b', 'a', 'b'], 3);

  it('matches a pair and keeps it up', () => {
    const s = board();
    expect(flip(s, 0)).toBe('first');
    expect(flip(s, 2)).toBe('match');
    expect(s.matched).toEqual([true, false, true, false]);
    expect(s.up).toEqual([]);
    expect(s.moves).toBe(1);
    expect(pairsMatched(s)).toBe(1);
  });

  it('leaves a miss up until hidden', () => {
    const s = board();
    flip(s, 0);
    expect(flip(s, 1)).toBe('miss');
    expect(faceUp(s, 0) && faceUp(s, 1)).toBe(true);
    expect(flip(s, 3)).toBe('ignored');
    expect(hideMiss(s)).toEqual([0, 1]);
    expect(faceUp(s, 0) || faceUp(s, 1)).toBe(false);
    expect(hideMiss(s)).toEqual([]);
  });

  it.each([
    { name: 'out of range', setup: [] as number[], index: 9 },
    { name: 'negative', setup: [], index: -1 },
    { name: 'same card twice', setup: [0], index: 0 },
    { name: 'already matched', setup: [0, 2], index: 2 },
  ])('ignores $name', ({ setup, index }) => {
    const s = board();
    for (const i of setup) flip(s, i);
    const before = JSON.stringify(s);
    expect(flip(s, index)).toBe('ignored');
    expect(JSON.stringify(s)).toBe(before);
  });

  it('wins when every pair is matched', () => {
    const s = board();
    flip(s, 0);
    flip(s, 2);
    expect(memoryWon(s)).toBe(false);
    flip(s, 1);
    flip(s, 3);
    expect(memoryWon(s)).toBe(true);
    expect(memoryOver(s)).toBe(true);
  });

  it('ends when the moves run out', () => {
    const s = startMemory(['a', 'b', 'a', 'b'], 2);
    flip(s, 0);
    flip(s, 1);
    hideMiss(s);
    expect(movesLeft(s)).toBe(1);
    flip(s, 0);
    flip(s, 3);
    expect(movesLeft(s)).toBe(0);
    expect(memoryOver(s)).toBe(false); // the missed pair still shows
    hideMiss(s);
    expect(memoryOver(s)).toBe(true);
    expect(memoryWon(s)).toBe(false);
    expect(flip(s, 0)).toBe('ignored');
  });

  it('wins on the last move', () => {
    const s = startMemory(['a', 'a'], 1);
    flip(s, 0);
    expect(flip(s, 1)).toBe('match');
    expect(memoryWon(s)).toBe(true);
  });
});

describe('memoryGrid', () => {
  it.each([
    { cards: 0, cols: 0, rows: 0 },
    { cards: 4, cols: 4, rows: 1 },
    { cards: 6, cols: 3, rows: 2 },
    { cards: 12, cols: 6, rows: 2 },
    { cards: 16, cols: 8, rows: 2 },
    { cards: 18, cols: 6, rows: 3 },
    { cards: 24, cols: 8, rows: 3 },
  ])('$cards cards → $cols×$rows', ({ cards, cols, rows }) => {
    const g = memoryGrid(cards);
    expect(g).toEqual({ cols, rows });
    expect(g.cols * g.rows).toBeGreaterThanOrEqual(cards);
  });
});

describe('moveCursor', () => {
  it.each([
    { index: 0, dx: 1, dy: 0, want: 1 },
    { index: 0, dx: -1, dy: 0, want: 0 },
    { index: 0, dx: 0, dy: -1, want: 0 },
    { index: 3, dx: 1, dy: 0, want: 3 },
    { index: 1, dx: 0, dy: 1, want: 5 },
    { index: 3, dx: 0, dy: 1, want: 3 }, // no card below (6 cards in 4 columns)
  ])('$index by ($dx,$dy) → $want', ({ index, dx, dy, want }) => {
    expect(moveCursor(index, dx, dy, 4, 6)).toBe(want);
  });
});
