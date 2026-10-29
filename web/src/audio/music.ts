// Looping 16-bit-style background music (SPEC.md §1.3): square, pulse,
// triangle and noise voices scheduled ahead on the AudioContext clock.
import type { Music } from '../core/types.gen';
import { midiToFreq } from './voice';

/** A note to play, with its absolute start in beats since the music started. */
export interface DueNote {
  track: number;
  pitch: number;
  beat: number;
  dur: number;
  vel: number;
}

/**
 * Notes of a looping tune that start in [fromBeat, toBeat), across loop
 * boundaries (pure; the scheduler calls it every tick).
 */
export function notesBetween(music: Pick<Music, 'loopBeats' | 'tracks'>, fromBeat: number, toBeat: number): DueNote[] {
  const out: DueNote[] = [];
  const loop = music.loopBeats;
  if (loop <= 0 || toBeat <= fromBeat) return out;
  const firstLoop = Math.floor(fromBeat / loop);
  const lastLoop = Math.floor((toBeat - 1e-9) / loop);
  for (let k = firstLoop; k <= lastLoop; k++) {
    music.tracks.forEach((t, track) => {
      for (const n of t.notes) {
        const beat = k * loop + n.start;
        if (beat >= fromBeat && beat < toBeat) out.push({ track, pitch: n.pitch, beat, dur: n.dur, vel: n.vel });
      }
    });
  }
  return out.sort((a, b) => a.beat - b.beat || a.track - b.track);
}

const LOOKAHEAD_S = 0.6;
const TICK_MS = 100;
const FADE_S = 0.8;

interface Playing {
  music: Music;
  gain: GainNode;
  startTime: number;
  scheduledTo: number; // beats
  timer: number;
}

/** Plays one tune at a time on the music bus, crossfading between tunes. */
export class MusicPlayer {
  private current: Playing | null = null;
  private pulseWave: PeriodicWave | null = null;
  private noise: AudioBuffer | null = null;

  constructor(
    private readonly context: () => AudioContext | null,
    private readonly output: () => AudioNode | null,
  ) {}

  /** The id of the tune playing, or null. */
  get playing(): string | null {
    return this.current?.music.id ?? null;
  }

  /** Starts `music` (crossfading from the current tune); null fades out. */
  play(music: Music | null): void {
    if (music && this.current?.music.id === music.id) return;
    this.fadeOut();
    if (!music) return;
    const ctx = this.context();
    const out = this.output();
    if (!ctx || !out) return; // not unlocked yet; the caller can retry
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE_S);
    gain.connect(out);
    const p: Playing = { music, gain, startTime: ctx.currentTime + 0.1, scheduledTo: 0, timer: 0 };
    p.timer = window.setInterval(() => this.tick(p), TICK_MS);
    this.current = p;
    this.tick(p);
  }

  stop(): void {
    this.play(null);
  }

  private fadeOut(): void {
    const p = this.current;
    const ctx = this.context();
    this.current = null;
    if (!p) return;
    clearInterval(p.timer);
    if (!ctx) return;
    p.gain.gain.cancelScheduledValues(ctx.currentTime);
    p.gain.gain.setValueAtTime(p.gain.gain.value, ctx.currentTime);
    p.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE_S);
    window.setTimeout(() => p.gain.disconnect(), (FADE_S + 0.2) * 1000);
  }

  private tick(p: Playing): void {
    const ctx = this.context();
    if (!ctx) return;
    const spb = 60 / p.music.tempo;
    const until = (ctx.currentTime + LOOKAHEAD_S - p.startTime) / spb;
    if (until <= p.scheduledTo) return;
    for (const n of notesBetween(p.music, p.scheduledTo, until)) {
      const t = p.startTime + n.beat * spb;
      if (t < ctx.currentTime) continue;
      const track = p.music.tracks[n.track];
      this.voice(ctx, p.gain, track.instrument, n.pitch, t, n.dur * spb, (n.vel / 127) * track.volume);
    }
    p.scheduledTo = until;
  }

  private voice(ctx: AudioContext, out: AudioNode, instrument: string, pitch: number, t: number, len: number, level: number): void {
    const g = ctx.createGain();
    g.connect(out);
    const peak = level * 0.5;
    if (instrument === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(ctx);
      // Low "pitches" are snares (longer, darker), high ones hi-hats.
      const filter = ctx.createBiquadFilter();
      filter.type = pitch < 50 ? 'bandpass' : 'highpass';
      filter.frequency.value = pitch < 50 ? 1800 : 7000;
      src.connect(filter).connect(g);
      const decay = pitch < 50 ? 0.12 : 0.04;
      g.gain.setValueAtTime(peak, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      src.start(t);
      src.stop(t + decay + 0.02);
      src.onended = () => g.disconnect();
      return;
    }
    const osc = ctx.createOscillator();
    if (instrument === 'pulse') osc.setPeriodicWave(this.pulse(ctx));
    else osc.type = instrument === 'triangle' ? 'triangle' : 'square';
    osc.frequency.value = midiToFreq(pitch);
    osc.connect(g);
    const sustain = instrument === 'triangle' ? peak * 0.85 : peak * 0.6;
    const end = t + Math.max(0.03, len);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.linearRampToValueAtTime(sustain, t + 0.06);
    g.gain.setValueAtTime(sustain, end);
    g.gain.linearRampToValueAtTime(0, end + 0.04);
    osc.start(t);
    osc.stop(end + 0.05);
    osc.onended = () => g.disconnect();
  }

  /** A 25% duty-cycle pulse wave, the classic 16-bit lead/harmony timbre. */
  private pulse(ctx: AudioContext): PeriodicWave {
    if (!this.pulseWave) {
      const n = 32;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25);
      this.pulseWave = ctx.createPeriodicWave(real, imag);
    }
    return this.pulseWave;
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }
}
