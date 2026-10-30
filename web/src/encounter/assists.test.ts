import { describe, expect, it } from 'vitest';
import type { CompanionAbilities } from '../core/types.gen';
import { activate, afterSuccess, counterHit, partyAbilities, readyAbilities, startAssists, windowScale } from './assists';

const cfg: CompanionAbilities = {
  sing: { uses: 2, turns: 2, windowScale: 1.4, damageScale: 0.5 },
  guardian: { minStage: 'dating', uses: 1, turns: 3, bonusHit: 12, guards: 1 },
  duet: true,
};

describe('partyAbilities', () => {
  it.each([
    [[], 'married', []],
    [['oboy'], 'none', ['sing']],
    [['kei'], 'friends', []],
    [['oboy', 'kei'], 'dating', ['sing', 'guardian']],
    [['kei'], 'married', ['guardian']],
  ] as const)('%j at %s → %j', (party, stage, want) => {
    expect(partyAbilities(cfg, party, stage)).toEqual(want);
  });
});

describe('the song', () => {
  it('widens windows for its turns and softens one counter-hit', () => {
    let s = activate(startAssists(cfg, ['sing']), 'sing', cfg).state;
    expect(s.uses.sing).toBe(1);
    expect(windowScale(s, cfg)).toBe(1.4);
    s = afterSuccess(s, cfg).state;
    expect(windowScale(s, cfg)).toBe(1.4);
    const hit = counterHit(s, 15, cfg);
    expect(hit.damage).toBe(8);
    expect(windowScale(hit.state, cfg)).toBe(1);
    expect(counterHit(hit.state, 15, cfg).damage).toBe(15);
  });

  it('runs out of uses', () => {
    let s = startAssists(cfg, ['sing']);
    s = activate(s, 'sing', cfg).state;
    s = activate(s, 'sing', cfg).state;
    expect(readyAbilities(s)).toEqual([]);
    expect(activate(s, 'sing', cfg).state).toBe(s);
  });
});

describe("Kei's guardian", () => {
  it('strikes after each completed combo while it lasts', () => {
    let s = activate(startAssists(cfg, ['guardian']), 'guardian', cfg).state;
    const hits: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = afterSuccess(s, cfg);
      hits.push(r.bonusHit);
      s = r.state;
    }
    expect(hits).toEqual([12, 12, 12, 0]);
  });

  it('blocks one counter-hit, then they land', () => {
    let s = activate(startAssists(cfg, ['guardian']), 'guardian', cfg).state;
    const first = counterHit(s, 15, cfg);
    expect(first).toMatchObject({ damage: 0, blocked: true });
    s = first.state;
    expect(counterHit(s, 15, cfg)).toMatchObject({ damage: 15, blocked: false });
  });
});

describe('the duet', () => {
  it('gives one free success when both act together, once', () => {
    let s = startAssists(cfg, ['sing', 'guardian']);
    const first = activate(s, 'sing', cfg);
    expect(first.duet).toBe(false);
    const both = activate(first.state, 'guardian', cfg);
    expect(both.duet).toBe(true);
    expect(both.state.freeSuccess).toBe(true);
    s = afterSuccess(both.state, cfg).state;
    expect(s.freeSuccess).toBe(false);
    expect(activate(s, 'sing', cfg).duet).toBe(false);
  });

  it('needs the other one still active', () => {
    let s = activate(startAssists(cfg, ['sing', 'guardian']), 'sing', cfg).state;
    s = afterSuccess(afterSuccess(s, cfg).state, cfg).state;
    expect(activate(s, 'guardian', cfg).duet).toBe(false);
  });
});
