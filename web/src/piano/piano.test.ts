import { describe, expect, it } from 'vitest';
import type { Song, Student } from '../core/types.gen';
import { calibrate, median } from './calibration';
import { gradientBands, lerpColor } from './frame';
import {
  applyLessonResult,
  CALIBRATED_FLAG,
  fnv1a,
  isLatencyCalibrated,
  lessonDifficulty,
  lessonSeed,
  pickSong,
  setLatencyOffset,
} from './lesson';
import { beatsPerBar, msPerBeat, notesEndMs, perfToScoreMs, songToNotes } from './notes';
import { formatTime, lessonPay, mistakeLabel, summarizeMistakes } from './results';
import { fitX, isBlackKey, labelRows, msToX, pitchToY, PLAYHEAD_X, rollLayout, visibleRange } from './roll';

const song: Song = {
  id: 'waltz',
  title: 'Waltz',
  tempo: 120,
  timeSignature: [3, 4],
  difficulty: 1,
  notes: [
    { pitch: 74, start: 1, dur: 1, vel: 82 },
    { pitch: 55, start: 0, dur: 3, vel: 58 },
    { pitch: 74, start: 0, dur: 1, vel: 82 },
  ],
};

const student: Student = {
  id: 'mei',
  name: 'Mei',
  level: 1,
  home: 'x',
  repertoire: ['missing', 'waltz'],
  tendencies: {},
  fee: 120,
};

describe('songToNotes', () => {
  it('converts beats to ms like the core (beats × 60000 / tempo), sorted', () => {
    expect(songToNotes(song)).toEqual([
      { pitch: 55, startMs: 0, durMs: 1500, vel: 58 },
      { pitch: 74, startMs: 0, durMs: 500, vel: 82 },
      { pitch: 74, startMs: 500, durMs: 500, vel: 82 },
    ]);
    expect(msPerBeat({ tempo: 92 })).toBeCloseTo(652.17, 2);
    expect(msPerBeat({ tempo: 0 })).toBe(0);
    expect(notesEndMs(songToNotes(song))).toBe(1500);
    expect(beatsPerBar(song)).toBe(3);
    expect(beatsPerBar({ timeSignature: [] })).toBe(4);
  });
});

describe('roll layout', () => {
  it('fits the pitch range in whole-pixel rows, highest on top', () => {
    const l = rollLayout(songToNotes(song), 20, 100);
    expect(l.minPitch).toBe(54);
    expect(l.maxPitch).toBe(75);
    expect(l.rowH).toBe(4);
    expect(l.height).toBe(22 * 4);
    expect(Number.isInteger(l.top)).toBe(true);
    expect(pitchToY(l, 75)).toBe(l.top);
    expect(pitchToY(l, 54)).toBe(l.top + l.height - l.rowH);
  });

  it('clips very wide ranges to one px per row', () => {
    const l = rollLayout([{ pitch: 0 }, { pitch: 127 }], 0, 50);
    expect(l.rowH).toBe(1);
    expect(l.maxPitch - l.minPitch + 1).toBe(50);
  });

  it('defaults to an octave when empty', () => {
    expect(rollLayout([], 0, 100).minPitch).toBe(59);
  });

  it('puts the playhead at x=80 and scrolls by speed', () => {
    expect(PLAYHEAD_X).toBe(80);
    expect(msToX(1000, 1000)).toBe(80);
    expect(msToX(2000, 1000, 48)).toBe(128);
    expect(msToX(0, 1000, 48)).toBe(32);
    expect(Number.isInteger(msToX(1234.5, 17.3, 48))).toBe(true);
    const [from, to] = visibleRange(1000, 48);
    expect(msToX(from, 1000, 48)).toBe(0);
    expect(msToX(to, 1000, 48)).toBe(320);
  });

  it('fits a whole piece into a span', () => {
    const x = fitX(10000, 10, 310);
    expect(x(0)).toBe(10);
    expect(x(5000)).toBe(160);
    expect(x(20000)).toBe(310);
  });

  it('knows the black keys', () => {
    expect([60, 61, 62, 63, 64, 65, 66].map(isBlackKey)).toEqual([false, true, false, true, false, false, true]);
  });

  it('staggers overlapping labels', () => {
    expect(labelRows([10, 20, 100, 105], 40)).toEqual([0, 1, 0, 1]);
    expect(labelRows([10, 12, 14], 40)).toEqual([0, 1, 0]);
  });
});

describe('results', () => {
  it('labels mistake types', () => {
    expect(mistakeLabel('wrong_note')).toBe('Wrong note');
    expect(mistakeLabel('missed_note')).toBe('Missed note');
    expect(mistakeLabel('extra_note')).toBe('Extra note');
    expect(mistakeLabel('rush')).toBe('Rushed');
    expect(mistakeLabel('drag')).toBe('Dragged');
    expect(mistakeLabel('hesitation')).toBe('Hesitated');
    expect(mistakeLabel('sour_pedal')).toBe('Sour pedal');
  });

  it('counts mistakes per type in a fixed order', () => {
    const rows = summarizeMistakes([
      { type: 'rush', hit: true },
      { type: 'wrong_note', hit: false },
      { type: 'rush', hit: false },
      { type: 'zzz', hit: true },
    ]);
    expect(rows).toEqual([
      { type: 'wrong_note', label: 'Wrong note', total: 1, hit: 0 },
      { type: 'rush', label: 'Rushed', total: 2, hit: 1 },
      { type: 'zzz', label: 'Zzz', total: 1, hit: 1 },
    ]);
    expect(summarizeMistakes([])).toEqual([]);
  });

  it('pays half to full fee by score', () => {
    expect(lessonPay(120, 0)).toBe(60);
    expect(lessonPay(120, 100)).toBe(120);
    expect(lessonPay(120, 75)).toBe(Math.round(120 * (0.5 + 75 / 200)));
    expect(lessonPay(120, 150)).toBe(120);
  });

  it('formats times', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(3240)).toBe('0:03.2');
    expect(formatTime(61950)).toBe('1:02.0');
  });
});

describe('lesson bookkeeping', () => {
  it('tracks calibration via a flag', () => {
    const state = { flags: {} as Record<string, true>, settings: { latencyOffsetMs: 0 } };
    expect(isLatencyCalibrated(state)).toBe(false);
    setLatencyOffset(state, 42);
    expect(state.settings.latencyOffsetMs).toBe(42);
    expect(state.flags[CALIBRATED_FLAG]).toBe(true);
    expect(isLatencyCalibrated(state)).toBe(true);
  });

  it('clamps difficulty to 1–5', () => {
    expect([0, 1, 3, 9, Number.NaN].map(lessonDifficulty)).toEqual([1, 1, 3, 5, 1]);
  });

  it('derives deterministic uint32 seeds per world, day and student', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    const s = lessonSeed(42, 3, 'mei');
    expect(s).toBe(lessonSeed(42, 3, 'mei'));
    expect(s).not.toBe(lessonSeed(42, 4, 'mei'));
    expect(s).not.toBe(lessonSeed(42, 3, 'ken'));
    expect(s).not.toBe(lessonSeed(43, 3, 'mei'));
    expect(s >>> 0).toBe(s);
  });

  it('picks the requested song or the first known repertoire song', () => {
    const other = { ...song, id: 'other' };
    expect(pickSong(student, [song, other])?.id).toBe('waltz');
    expect(pickSong(student, [song, other], 'other')?.id).toBe('other');
    expect(pickSong(student, [song], 'nope')?.id).toBe('waltz');
    expect(pickSong(student, [])).toBeUndefined();
  });

  it('pays and advances progress, creating the entry', () => {
    const state = { money: 500, students: {} as Record<string, { progress: number; lessons: number }> };
    const out = applyLessonResult(state, student, 80);
    expect(out.pay).toBe(Math.round(120 * 0.9));
    expect(state.money).toBe(500 + out.pay);
    expect(state.students.mei).toEqual({ progress: 0.8, lessons: 1 });
    applyLessonResult(state, student, 50);
    expect(state.students.mei.lessons).toBe(2);
    expect(state.students.mei.progress).toBeCloseTo(1.3, 9);
  });
});

describe('calibration', () => {
  const clicks = [0, 600, 1200, 1800, 2400, 3000, 3600, 4200];

  it('takes medians', () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('uses the median tap − click, ignoring warm-up and stray taps', () => {
    const taps = [500, 640, 1250, 1840, 2440, 3045, 3630, 4240, 4300, 3300];
    const r = calibrate(taps, clicks);
    expect(r.ok).toBe(true);
    expect(r.deltas).toEqual([50, 40, 40, 45, 30, 40]);
    expect(r.offsetMs).toBe(40);
  });

  it('handles early (negative) taps', () => {
    const r = calibrate(clicks.map((c) => c - 30), clicks);
    expect(r.offsetMs).toBe(-30);
    expect(r.deltas).toHaveLength(6);
  });

  it('fails with too few valid taps', () => {
    const r = calibrate([1200, 1800, 2400, 5000], clicks);
    expect(r.ok).toBe(false);
    expect(r.offsetMs).toBe(0);
    expect(r.deltas).toHaveLength(3);
  });

  it('ignores taps outside ±250 ms', () => {
    expect(calibrate(clicks.map((c) => c + 300), clicks).ok).toBe(false);
    expect(calibrate(clicks.map((c) => c + 250), clicks).offsetMs).toBe(250);
  });
});

describe('window frame', () => {
  it('blends colours', () => {
    expect(lerpColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(lerpColor(0x102030, 0x405060, 0)).toBe(0x102030);
    expect(lerpColor(0x102030, 0x405060, 1)).toBe(0x405060);
  });

  it('covers the height with whole-pixel bands', () => {
    const bands = gradientBands(7, 0, 0xffffff, 2);
    expect(bands.map((b) => [b.y, b.h])).toEqual([[0, 2], [2, 2], [4, 2], [6, 1]]);
    expect(bands[0].color).toBe(0);
    expect(bands[3].color).toBe(0xffffff);
  });
});

describe('perfToScoreMs', () => {
  const pauses = [
    { scoreMs: 1500, ms: 400 },
    { scoreMs: 3500, ms: 600 },
  ];
  it('is the identity without pauses', () => {
    expect(perfToScoreMs(1234, [])).toBe(1234);
  });
  it('stands still during a pause and runs late after it', () => {
    expect(perfToScoreMs(1000, pauses)).toBe(1000);
    expect(perfToScoreMs(1500, pauses)).toBe(1500);
    expect(perfToScoreMs(1800, pauses)).toBe(1500);
    expect(perfToScoreMs(1900, pauses)).toBe(1500);
    expect(perfToScoreMs(2400, pauses)).toBe(2000);
  });
  it('accumulates pauses', () => {
    // Second pause starts at perf 3500 + 400 and lasts 600.
    expect(perfToScoreMs(4000, pauses)).toBe(3500);
    expect(perfToScoreMs(4500, pauses)).toBe(3500);
    expect(perfToScoreMs(5000, pauses)).toBe(4000);
  });
});

describe('pickSong progression', () => {
  const song = (id: string) => ({ id, title: id, tempo: 100, timeSignature: [4, 4] as [number, number], difficulty: 1, notes: [] });
  const songs = [song('a'), song('b'), song('c')];
  const student = { id: 's', name: 'S', level: 1, home: '', repertoire: ['a', 'missing', 'b', 'c'], tendencies: {}, fee: 1 };
  it('moves through the repertoire with progress, skipping unknown songs', () => {
    expect(pickSong(student, songs)?.id).toBe('a');
    expect(pickSong(student, songs, undefined, 0.9)?.id).toBe('a');
    expect(pickSong(student, songs, undefined, 1.2)?.id).toBe('b');
    expect(pickSong(student, songs, undefined, 9)?.id).toBe('c');
    expect(pickSong(student, songs, 'b', 0)?.id).toBe('b');
  });
});
