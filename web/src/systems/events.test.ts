import { describe, expect, it } from 'vitest';
import type { Action, Condition, ContentBundle, Dialogue, Event } from '../core/types.gen';
import {
  checkCondition,
  EventRunner,
  fire,
  matchesTrigger,
  visibleLines,
  type EventHost,
} from './events';
import { newGame, SEASON_DAYS, type GameState } from './state';
import { emptyContent } from '../test/content';

const content: ContentBundle = {
  ...emptyContent(),
  game: { title: 'T', contentVersion: '0', startMap: 'tko', startSpawn: 'estate_plaza' },
};

function state(): GameState {
  return newGame(content, 1);
}

function ev(partial: Partial<Event> & Pick<Event, 'id'>): Event {
  return {
    trigger: { type: 'talk', params: {} },
    conditions: [],
    actions: [],
    once: true,
    ...partial,
  };
}

const c = (type: string, value: unknown): Condition => ({ type, value });
const a = (type: string, value: unknown): Action => ({ type, value });

class RecordingHost implements EventHost {
  readonly calls: string[] = [];
  onDialogue: ((id: string) => Promise<void>) | null = null;

  async showDialogue(id: string): Promise<void> {
    this.calls.push(`dialogue:${id}`);
    if (this.onDialogue) await this.onDialogue(id);
  }

  async startScene(value: unknown): Promise<void> {
    this.calls.push(`scene:${JSON.stringify(value)}`);
  }

  other(action: Action): void {
    this.calls.push(`other:${action.type}`);
  }
}

describe('matchesTrigger', () => {
  const e = ev({ id: 'e', trigger: { type: 'photo_session_end', params: { spot: 'park' } } });

  it('needs the same type and all event params', () => {
    expect(matchesTrigger(e, { type: 'photo_session_end', params: { spot: 'park' } })).toBe(true);
    expect(matchesTrigger(e, { type: 'photo_session_end', params: { spot: 'park', extra: 'x' } })).toBe(true);
    expect(matchesTrigger(e, { type: 'photo_session_end', params: { spot: 'bay' } })).toBe(false);
    expect(matchesTrigger(e, { type: 'photo_session_end' })).toBe(false);
    expect(matchesTrigger(e, { type: 'photo_taken', params: { spot: 'park' } })).toBe(false);
  });

  it('matches any params when the event has none', () => {
    const any = ev({ id: 'any', trigger: { type: 'photo_session_end', params: {} } });
    expect(matchesTrigger(any, { type: 'photo_session_end', params: { spot: 'bay' } })).toBe(true);
    expect(matchesTrigger(any, { type: 'photo_session_end' })).toBe(true);
  });
});

describe('checkCondition', () => {
  it('checks flags', () => {
    const s = state();
    expect(checkCondition(c('flag_set', 'f'), s)).toBe(false);
    expect(checkCondition(c('flag_not_set', 'f'), s)).toBe(true);
    s.flags.f = true;
    expect(checkCondition(c('flag_set', 'f'), s)).toBe(true);
    expect(checkCondition(c('flag_not_set', 'f'), s)).toBe(false);
  });

  it('checks chapter, money and bond thresholds', () => {
    const s = state();
    s.chapter = 2;
    s.bond.oboy = 40;
    expect(checkCondition(c('chapter_at_least', 2), s)).toBe(true);
    expect(checkCondition(c('chapter_at_least', 3), s)).toBe(false);
    expect(checkCondition(c('money_at_least', 500), s)).toBe(true);
    expect(checkCondition(c('money_at_least', 501), s)).toBe(false);
    expect(checkCondition(c('bond_at_least', { who: 'oboy', amount: 40 }), s)).toBe(true);
    expect(checkCondition(c('bond_at_least', { who: 'oboy', amount: 41 }), s)).toBe(false);
    expect(checkCondition(c('bond_at_least', { who: 'kei', amount: 0 }), s)).toBe(true);
  });

  it('treats kei_stage as "reached or beyond"', () => {
    const s = state();
    expect(checkCondition(c('kei_stage', 'met'), s)).toBe(false);
    s.keiStage = 'dating';
    expect(checkCondition(c('kei_stage', 'met'), s)).toBe(true);
    expect(checkCondition(c('kei_stage', 'friends'), s)).toBe(true);
    expect(checkCondition(c('kei_stage', 'dating'), s)).toBe(true);
    expect(checkCondition(c('kei_stage', 'engaged'), s)).toBe(false);
  });

  it('checks the party', () => {
    const s = state();
    s.party = ['oboy'];
    expect(checkCondition(c('party_has', 'oboy'), s)).toBe(true);
    expect(checkCondition(c('party_has', 'kei'), s)).toBe(false);
    expect(checkCondition(c('party_lacks', 'kei'), s)).toBe(true);
    expect(checkCondition(c('party_lacks', 'oboy'), s)).toBe(false);
  });

  it('checks items by name or count', () => {
    const s = state();
    s.items.lens_part = 2;
    expect(checkCondition(c('has_item', 'lens_part'), s)).toBe(true);
    expect(checkCondition(c('has_item', 'boots'), s)).toBe(false);
    expect(checkCondition(c('has_item', { item: 'lens_part', count: 2 }), s)).toBe(true);
    expect(checkCondition(c('has_item', { item: 'lens_part', count: 3 }), s)).toBe(false);
    expect(checkCondition(c('has_item', { item: 'lens_part' }), s)).toBe(true);
  });

  it('checks season and time slot (single value or list)', () => {
    const s = state();
    s.day = SEASON_DAYS + 2;
    s.slot = 'evening';
    expect(checkCondition(c('season', 'summer'), s)).toBe(true);
    expect(checkCondition(c('season', 'spring'), s)).toBe(false);
    expect(checkCondition(c('season', ['winter', 'summer']), s)).toBe(true);
    expect(checkCondition(c('time_slot', 'evening'), s)).toBe(true);
    expect(checkCondition(c('time_slot', 'morning'), s)).toBe(false);
  });

  it('checks the album', () => {
    const s = state();
    expect(checkCondition(c('album_has', 'little_egret'), s)).toBe(false);
    s.album.little_egret = {
      species: 'little_egret', score: 80, rating: 'great', day: 1, slot: 'morning',
      area: 'tko', spot: 'bay', companions: [],
    };
    expect(checkCondition(c('album_has', 'little_egret'), s)).toBe(true);
  });

  it('is false and warns for unknown types', () => {
    const warnings: string[] = [];
    expect(checkCondition(c('weather', 'rain'), state(), { onWarn: (m) => warnings.push(m) })).toBe(false);
    expect(warnings).toEqual(['unknown condition type "weather"']);
  });

  it('is false and warns for malformed values', () => {
    const s = state();
    const warnings: string[] = [];
    const ctx = { onWarn: (m: string) => warnings.push(m) };
    const bad: Condition[] = [
      c('flag_set', 3),
      c('flag_not_set', ''),
      c('chapter_at_least', '1'),
      c('bond_at_least', { who: 'mei', amount: 1 }),
      c('bond_at_least', { who: 'oboy' }),
      c('kei_stage', 'divorced'),
      c('party_lacks', null),
      c('has_item', { count: 1 }),
      c('money_at_least', Number.NaN),
      c('season', []),
      c('time_slot', 7),
      c('album_has', {}),
    ];
    for (const cond of bad) expect(checkCondition(cond, s, ctx)).toBe(false);
    expect(warnings).toHaveLength(bad.length);
  });

  it('uses custom evaluators for extra condition types', () => {
    const ctx = { custom: { weather: (v: unknown) => v === 'rain' } };
    expect(checkCondition(c('weather', 'rain'), state(), ctx)).toBe(true);
    expect(checkCondition(c('weather', 'sun'), state(), ctx)).toBe(false);
  });
});

describe('visibleLines', () => {
  it('keeps lines whose conditions hold', () => {
    const d: Dialogue = {
      id: 'd',
      lines: [
        { speaker: 'angie', text: 'always' },
        { speaker: 'kei', text: 'with kei', if: [c('party_has', 'kei')] },
        { speaker: 'angie', text: 'alone', if: [c('party_lacks', 'kei'), c('party_lacks', 'oboy')] },
      ],
    };
    const s = state();
    expect(visibleLines(d, s).map((l) => l.text)).toEqual(['always', 'alone']);
    s.party = ['kei'];
    expect(visibleLines(d, s).map((l) => l.text)).toEqual(['always', 'with kei']);
  });
});

describe('fire', () => {
  it('runs the prologue-style event once', async () => {
    const events = [
      ev({
        id: 'prologue_arrival',
        trigger: { type: 'new_game', params: {} },
        conditions: [c('flag_not_set', 'prologue_arrived')],
        actions: [a('dialogue', 'prologue_arrival'), a('set_flag', 'prologue_arrived'), a('set_chapter', 0)],
      }),
    ];
    const s = state();
    const host = new RecordingHost();
    expect(await fire({ type: 'new_game' }, s, { events }, host)).toEqual(['prologue_arrival']);
    expect(host.calls).toEqual(['dialogue:prologue_arrival']);
    expect(s.flags.prologue_arrived).toBe(true);
    expect(s.firedEvents.prologue_arrival).toBe(true);
    expect(await fire({ type: 'new_game' }, s, { events }, host)).toEqual([]);
  });

  it('applies every state action', async () => {
    const s = state();
    s.flags.old = true;
    s.bond.kei = 95;
    const events = [
      ev({
        id: 'all',
        actions: [
          a('set_flag', 'new'),
          a('clear_flag', 'old'),
          a('set_chapter', 3),
          a('join_party', 'oboy'),
          a('join_party', 'oboy'),
          a('add_bond', { who: 'oboy', amount: 10 }),
          a('add_bond', { who: 'kei', amount: 10 }),
          a('set_kei_stage', 'friends'),
          a('give_item', 'boots'),
          a('give_item', { item: 'lens_part', count: 3 }),
          a('give_money', 120),
        ],
      }),
    ];
    await fire({ type: 'talk' }, s, { events }, new RecordingHost());
    expect(s.flags).toEqual({ new: true });
    expect(s.chapter).toBe(3);
    expect(s.joined).toEqual(['oboy']);
    expect(s.party).toEqual(['oboy']);
    expect(s.bond).toEqual({ oboy: 10, kei: 100 });
    expect(s.keiStage).toBe('friends');
    expect(s.items).toEqual({ boots: 1, lens_part: 3 });
    expect(s.money).toBe(620);
  });

  it('clamps bond at 0 and money at 0', async () => {
    const s = state();
    const events = [
      ev({ id: 'x', actions: [a('add_bond', { who: 'oboy', amount: -30 }), a('give_money', -9999)] }),
    ];
    await fire({ type: 'talk' }, s, { events }, new RecordingHost());
    expect(s.bond.oboy).toBe(0);
    expect(s.money).toBe(0);
  });

  it('removes items whose count drops to zero', async () => {
    const s = state();
    s.items.ticket = 1;
    await fire({ type: 'talk' }, s, { events: [ev({ id: 'x', actions: [a('give_item', { item: 'ticket', count: -1 })] })] }, new RecordingHost());
    expect(s.items).toEqual({});
  });

  it('sends presentation actions to the host in order, awaiting each', async () => {
    const s = state();
    const host = new RecordingHost();
    let release: () => void = () => {};
    host.onDialogue = () => new Promise<void>((r) => (release = r));
    const events = [
      ev({
        id: 'x',
        actions: [
          a('dialogue', 'intro'),
          a('set_flag', 'after_intro'),
          a('start_scene', { scene: 'photo', spot: 'park' }),
          a('unlock_area', 'wetlands'),
        ],
      }),
    ];
    const done = fire({ type: 'talk' }, s, { events }, host);
    await Promise.resolve();
    expect(host.calls).toEqual(['dialogue:intro']);
    expect(s.flags.after_intro).toBeUndefined();
    release();
    await done;
    expect(s.flags.after_intro).toBe(true);
    expect(host.calls).toEqual([
      'dialogue:intro',
      'scene:{"scene":"photo","spot":"park"}',
      'other:unlock_area',
    ]);
  });

  it('runs matching events in content order and lets earlier ones affect later conditions', async () => {
    const s = state();
    const events = [
      ev({ id: 'b_needs_a', conditions: [c('flag_set', 'a')], actions: [a('set_flag', 'b')] }),
      ev({ id: 'a', actions: [a('set_flag', 'a')] }),
      ev({ id: 'c_needs_a', conditions: [c('flag_set', 'a')], actions: [a('set_flag', 'c')] }),
      ev({ id: 'other_trigger', trigger: { type: 'interact', params: {} }, actions: [a('set_flag', 'no')] }),
    ];
    expect(await fire({ type: 'talk' }, s, { events }, new RecordingHost())).toEqual(['a', 'c_needs_a']);
    expect(s.flags).toEqual({ a: true, c: true });
  });

  it('holds back events canRun rejects without marking them fired', async () => {
    const s = state();
    const events = [ev({ id: 'story', actions: [a('set_flag', 'told')] })];
    let room = false;
    const ctx = { canRun: () => room };
    expect(await fire({ type: 'talk' }, s, { events }, new RecordingHost(), ctx)).toEqual([]);
    expect(s.firedEvents).toEqual({});
    room = true;
    expect(await fire({ type: 'talk' }, s, { events }, new RecordingHost(), ctx)).toEqual(['story']);
    expect(s.flags.told).toBe(true);
  });

  it('repeats events with once: false', async () => {
    const s = state();
    const events = [ev({ id: 'tip', once: false, actions: [a('give_money', 10)] })];
    await fire({ type: 'talk' }, s, { events }, new RecordingHost());
    await fire({ type: 'talk' }, s, { events }, new RecordingHost());
    expect(s.money).toBe(520);
    expect(s.firedEvents).toEqual({});
  });

  it('skips events whose conditions fail and does not mark them fired', async () => {
    const s = state();
    const events = [ev({ id: 'x', conditions: [c('chapter_at_least', 1)], actions: [a('set_flag', 'x')] })];
    expect(await fire({ type: 'talk' }, s, { events }, new RecordingHost())).toEqual([]);
    expect(s.firedEvents).toEqual({});
    s.chapter = 1;
    expect(await fire({ type: 'talk' }, s, { events }, new RecordingHost())).toEqual(['x']);
  });

  it('marks once-events fired before running actions, so re-entrant fires cannot repeat them', async () => {
    const s = state();
    const events = [ev({ id: 'x', actions: [a('dialogue', 'd'), a('give_money', 1)] })];
    const host = new RecordingHost();
    const inner: string[][] = [];
    host.onDialogue = async () => {
      inner.push(await fire({ type: 'talk' }, s, { events }, host));
    };
    expect(await fire({ type: 'talk' }, s, { events }, host)).toEqual(['x']);
    expect(inner).toEqual([[]]);
    expect(s.money).toBe(501);
  });

  it('warns about malformed actions and keeps going', async () => {
    const s = state();
    const warnings: string[] = [];
    const host = new RecordingHost();
    const events = [ev({ id: 'x', actions: [a('set_flag', 5), a('dialogue', null), a('give_money', 'lots'), a('set_flag', 'ok')] })];
    await fire({ type: 'talk' }, s, { events }, host, { onWarn: (m) => warnings.push(m) });
    expect(s.flags).toEqual({ ok: true });
    expect(s.money).toBe(500);
    expect(host.calls).toEqual([]);
    expect(warnings).toHaveLength(3);
  });

  it('works through EventRunner', async () => {
    const s = state();
    const host = new RecordingHost();
    const runner = new EventRunner(
      { events: [ev({ id: 'p', trigger: { type: 'lesson_complete', params: { student: 'mei' } }, actions: [a('dialogue', 'p')] })] },
      host,
    );
    expect(await runner.fire({ type: 'lesson_complete', params: { student: 'ken' } }, s)).toEqual([]);
    expect(await runner.fire({ type: 'lesson_complete', params: { student: 'mei' } }, s)).toEqual(['p']);
    expect(host.calls).toEqual(['dialogue:p']);
  });
});
