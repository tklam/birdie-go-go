import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '../core/types.gen';
import { CURRENT_SAVE_VERSION, clampBond, isKeiStage, newGame, season } from './state';
import { emptyContent } from '../test/content';

const content: ContentBundle = {
  ...emptyContent(),
  game: { title: 'T', contentVersion: '0', startMap: 'tko', startSpawn: 'estate_plaza' },
};

describe('newGame', () => {
  it('starts on day 1 morning at the content start position', () => {
    const s = newGame(content, 42);
    expect(s.saveVersion).toBe(CURRENT_SAVE_VERSION);
    expect(s.day).toBe(1);
    expect(s.slot).toBe('morning');
    expect(s.money).toBe(500);
    expect(s.position).toEqual({ map: 'tko', spawn: 'estate_plaza' });
    expect(s.keiStage).toBe('none');
    expect(s.bond).toEqual({ oboy: 0, kei: 0 });
    expect(s.party).toEqual([]);
  });

  it('stores the seed as uint32', () => {
    expect(newGame(content, -1).worldSeed).toBe(0xffffffff);
    expect(newGame(content, 2 ** 32 + 5).worldSeed).toBe(5);
  });

  it('is plain JSON', () => {
    const s = newGame(content, 1);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('returns independent objects', () => {
    const a = newGame(content, 1);
    const b = newGame(content, 1);
    a.flags.x = true;
    a.settings.musicVolume = 0;
    expect(b.flags).toEqual({});
    expect(b.settings.musicVolume).not.toBe(0);
  });
});

describe('season', () => {
  it('changes every 14 days starting with spring', () => {
    expect(season(1)).toBe('spring');
    expect(season(14)).toBe('spring');
    expect(season(15)).toBe('summer');
    expect(season(29)).toBe('autumn');
    expect(season(43)).toBe('winter');
    expect(season(56)).toBe('winter');
    expect(season(57)).toBe('spring');
  });

  it('treats days below 1 as day 1', () => {
    expect(season(0)).toBe('spring');
    expect(season(-50)).toBe('spring');
  });
});

describe('helpers', () => {
  it('clamps bond to 0–100', () => {
    expect(clampBond(-5)).toBe(0);
    expect(clampBond(50)).toBe(50);
    expect(clampBond(150)).toBe(100);
  });

  it('recognises Kei stages', () => {
    expect(isKeiStage('dating')).toBe(true);
    expect(isKeiStage('divorced')).toBe(false);
    expect(isKeiStage(3)).toBe(false);
  });
});
