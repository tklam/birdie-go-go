import { describe, expect, it } from 'vitest';
import {
  ATTACK_S,
  clampVolume,
  clickTimes,
  dueUntil,
  envelopeGainAt,
  fundamentalDecay,
  midiToFreq,
  noteTimes,
  partialFreq,
  pianoPartials,
  releaseTau,
  scheduleEnd,
  sortNotes,
  velocityGain,
  voiceLength,
} from './voice';

describe('midiToFreq', () => {
  it('maps A4 to 440 Hz and octaves to doublings', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 9);
    expect(midiToFreq(81)).toBeCloseTo(880, 9);
    expect(midiToFreq(60)).toBeCloseTo(261.6256, 3);
  });

  it('puts a semitone ~6% apart (audibly different)', () => {
    expect(midiToFreq(61) / midiToFreq(60)).toBeCloseTo(2 ** (1 / 12), 9);
  });
});

describe('pianoPartials', () => {
  it('starts at the fundamental and stretches upper partials sharp', () => {
    const f0 = midiToFreq(60);
    const parts = pianoPartials(60, 100);
    expect(parts[0].freq).toBeCloseTo(f0, -1);
    const third = parts.find((p) => p.freq > 2.5 * f0 && p.freq < 3.5 * f0)!;
    expect(third.freq).toBeGreaterThan(3 * f0);
    expect(partialFreq(100, 1, 0)).toBe(100);
  });

  it('sums to the velocity gain and decays upper partials faster', () => {
    const parts = pianoPartials(60, 90);
    const sum = parts.reduce((s, p) => s + p.gain, 0);
    expect(sum).toBeCloseTo(velocityGain(90), 9);
    const last = parts[parts.length - 1];
    expect(last.decay).toBeLessThan(parts[0].decay);
  });

  it('is brighter at higher velocity', () => {
    const share = (vel: number) => {
      const parts = pianoPartials(60, vel);
      const sum = parts.reduce((s, p) => s + p.gain, 0);
      return parts.filter((p) => p.freq > 3 * midiToFreq(60)).reduce((s, p) => s + p.gain, 0) / sum;
    };
    expect(share(120)).toBeGreaterThan(share(30));
  });

  it('drops partials above the frequency limit', () => {
    for (const p of pianoPartials(100, 100, 8000)) expect(p.freq).toBeLessThanOrEqual(8000);
    expect(pianoPartials(108, 100, 1000)).toEqual([]);
  });

  it('sustains longer in the bass', () => {
    expect(fundamentalDecay(36)).toBeGreaterThan(fundamentalDecay(84));
    expect(releaseTau(36)).toBeGreaterThan(releaseTau(72));
  });
});

describe('velocityGain', () => {
  it('is monotonic, zero at zero and clamped', () => {
    expect(velocityGain(0)).toBe(0);
    expect(velocityGain(64)).toBeLessThan(velocityGain(100));
    expect(velocityGain(200)).toBe(velocityGain(127));
  });
});

describe('envelopeGainAt', () => {
  const e = { peak: 1, attack: ATTACK_S, decay: 1, releaseAt: 0.5, releaseTau: 0.1 };

  it('ramps up, decays while held and releases faster', () => {
    expect(envelopeGainAt(0, e)).toBe(0);
    expect(envelopeGainAt(ATTACK_S / 2, e)).toBeCloseTo(0.5, 9);
    expect(envelopeGainAt(ATTACK_S, e)).toBeCloseTo(1, 9);
    const atRelease = envelopeGainAt(0.5, e);
    expect(atRelease).toBeCloseTo(Math.exp(-(0.5 - ATTACK_S)), 9);
    expect(envelopeGainAt(0.6, e)).toBeCloseTo(atRelease * Math.exp(-1), 9);
  });

  it('releases from the attack ramp when released early', () => {
    const early = { ...e, releaseAt: ATTACK_S / 2 };
    expect(envelopeGainAt(ATTACK_S / 2 + 0.1, early)).toBeCloseTo(0.5 * Math.exp(-1), 9);
  });

  it('is inaudible by voiceLength', () => {
    const len = voiceLength(e.releaseAt, e.releaseTau);
    expect(envelopeGainAt(len, e)).toBeLessThan(0.001);
  });
});

describe('scheduling plans', () => {
  const notes = [
    { pitch: 64, startMs: 500, durMs: 250, vel: 80 },
    { pitch: 60, startMs: 0, durMs: 500, vel: 80 },
    { pitch: 48, startMs: 0, durMs: 1000, vel: 60 },
  ];

  it('sorts by start then pitch without mutating', () => {
    const sorted = sortNotes(notes);
    expect(sorted.map((n) => n.pitch)).toEqual([48, 60, 64]);
    expect(notes[0].pitch).toBe(64);
  });

  it('converts to absolute context times', () => {
    expect(noteTimes(notes[0], 10)).toEqual({ start: 10.5, end: 10.75 });
  });

  it('advances a lookahead cursor', () => {
    const sorted = sortNotes(notes);
    expect(dueUntil(sorted, 0, 10, 9.9)).toBe(0);
    expect(dueUntil(sorted, 0, 10, 10.1)).toBe(2);
    expect(dueUntil(sorted, 2, 10, 10.6)).toBe(3);
    expect(dueUntil(sorted, 3, 10, 99)).toBe(3);
  });

  it('ends after the last release tail', () => {
    const end = scheduleEnd(notes, 10);
    expect(end).toBeGreaterThan(11);
    expect(end).toBeCloseTo(10 + voiceLength(1, releaseTau(48)), 9);
    expect(scheduleEnd([], 3)).toBe(3);
  });

  it('spaces metronome clicks by the beat', () => {
    expect(clickTimes(4, 120, 1)).toEqual([1, 1.5, 2, 2.5]);
    expect(clickTimes(0, 120, 1)).toEqual([]);
  });

  it('clamps volumes', () => {
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(2)).toBe(1);
    expect(clampVolume(Number.NaN)).toBe(0);
    expect(clampVolume(0.3)).toBe(0.3);
  });
});
