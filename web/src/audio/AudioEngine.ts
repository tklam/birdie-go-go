// The game's one AudioContext: master/music/sfx/piano buses, a synthesized
// piano voice, a metronome click and a few 16-bit-flavoured SFX. Everything
// is generated with oscillators, so it works offline with no sample files.
// All timing is against AudioContext.currentTime (AGENTS.md rule 10).
import {
  ATTACK_S,
  clampVolume,
  dueUntil,
  midiToFreq,
  noteTimes,
  pianoPartials,
  releaseTau,
  scheduleEnd,
  sortNotes,
  velocityGain,
  voiceLength,
  type ScheduleNote,
} from './voice';

export type Bus = 'master' | 'music' | 'sfx' | 'piano';

/** Stops a schedule early; `endTime` is when it would finish on its own. */
export interface ScheduleHandle {
  readonly startTime: number;
  readonly endTime: number;
  stop(): void;
}

/** How far ahead (s) notes are turned into audio nodes, and how often (ms). */
const LOOKAHEAD_S = 0.3;
const PUMP_MS = 25;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private buses: Record<Bus, GainNode> | null = null;
  private noise: AudioBuffer | null = null;
  private readonly volumes: Record<Bus, number> = { master: 1, music: 0.8, sfx: 0.8, piano: 1 };

  constructor(private readonly createContext: () => AudioContext = () => new AudioContext({ latencyHint: 'interactive' })) {}

  /** True once the context exists and is running. */
  get ready(): boolean {
    return this.ctx?.state === 'running';
  }

  /** The AudioContext, or null before the first unlock(). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /** AudioContext.currentTime (0 before unlock). */
  get currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /**
   * The context time currently reaching the speakers, interpolated with
   * performance.now() between audio callbacks. Smoother than currentTime for
   * drawing; falls back to currentTime where unsupported.
   */
  outputTime(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    if (typeof ctx.getOutputTimestamp === 'function') {
      const ts = ctx.getOutputTimestamp();
      if (ts.contextTime && ts.performanceTime) {
        const t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
        // Never run ahead of the scheduler clock or lag it absurdly.
        if (t <= ctx.currentTime + 0.05 && t > ctx.currentTime - 0.5) return t;
      }
    }
    return ctx.currentTime;
  }

  /**
   * Creates (on first call) and resumes the AudioContext. Call it from a user
   * gesture handler (pointerdown/keydown) so browsers allow audio.
   */
  unlock(): Promise<void> {
    if (!this.ctx) this.init(this.createContext());
    const ctx = this.ctx!;
    return ctx.state === 'running' ? Promise.resolve() : ctx.resume();
  }

  /** Calls unlock() on the first pointer, touch or key event on `target`. */
  unlockOnFirstGesture(target: EventTarget = window): void {
    const events = ['pointerdown', 'touchend', 'keydown'];
    const handler = () => {
      void this.unlock().then(() => {
        if (this.ready) for (const e of events) target.removeEventListener(e, handler, true);
      });
    };
    for (const e of events) target.addEventListener(e, handler, true);
  }

  setVolume(bus: Bus, volume: number): void {
    this.volumes[bus] = clampVolume(volume);
    if (this.buses && this.ctx) this.buses[bus].gain.setTargetAtTime(this.volumes[bus], this.ctx.currentTime, 0.02);
  }

  getVolume(bus: Bus): number {
    return this.volumes[bus];
  }

  /**
   * Plays piano notes (times relative to `atTime`, an AudioContext time) on
   * the piano bus. Nodes are created a little ahead of time by a lookahead
   * pump, so long pieces don't allocate everything up front.
   */
  schedule(notes: readonly ScheduleNote[], atTime: number): ScheduleHandle {
    const sorted = sortNotes(notes);
    const endTime = scheduleEnd(sorted, atTime);
    const ctx = this.ctx;
    const buses = this.buses;
    if (!ctx || !buses) return { startTime: atTime, endTime, stop: () => {} };

    const out = ctx.createGain();
    out.connect(buses.piano);
    const sources = new Set<AudioScheduledSourceNode>();
    let cursor = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const pump = () => {
      const next = dueUntil(sorted, cursor, atTime, ctx.currentTime + LOOKAHEAD_S);
      for (; cursor < next; cursor++) this.pianoVoice(sorted[cursor], atTime, out, sources);
      if (cursor >= sorted.length && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    pump();
    if (cursor < sorted.length) timer = setInterval(pump, PUMP_MS);
    let stopped = false;
    return {
      startTime: atTime,
      endTime,
      stop: () => {
        if (stopped) return;
        stopped = true;
        if (timer !== null) clearInterval(timer);
        const now = ctx.currentTime;
        out.gain.setTargetAtTime(0, now, 0.01);
        for (const s of sources) {
          try {
            s.stop(now + 0.08);
          } catch {
            // already stopped
          }
        }
        setTimeout(() => out.disconnect(), 200);
      },
    };
  }

  /** A metronome click at `atTime`; accented clicks are higher and louder. */
  click(atTime: number, accent = false): void {
    const ctx = this.ctx;
    if (!ctx || !this.buses) return;
    const t = Math.max(atTime, ctx.currentTime);
    this.tone('square', accent ? 1760 : 1320, t, 0.035, accent ? 0.22 : 0.14, this.buses.sfx);
    this.tone('triangle', accent ? 880 : 660, t, 0.05, accent ? 0.25 : 0.16, this.buses.sfx);
  }

  /** A short UI blip (menu cursor). */
  blip(atTime?: number): void {
    const t = this.at(atTime);
    if (t === null) return;
    this.tone('square', 990, t, 0.05, 0.12, this.buses!.sfx);
  }

  /** A bright two-note arpeggio chime (success). */
  chime(atTime?: number): void {
    const t = this.at(atTime);
    if (t === null) return;
    const bus = this.buses!.sfx;
    [72, 76, 79, 84].forEach((p, i) => this.tone('triangle', midiToFreq(p), t + i * 0.07, 0.35, 0.2, bus));
    [72, 76, 79, 84].forEach((p, i) => this.tone('square', midiToFreq(p + 12), t + i * 0.07, 0.12, 0.05, bus));
  }

  /** A low buzz (error / wrong). */
  buzz(atTime?: number): void {
    const t = this.at(atTime);
    if (t === null) return;
    const bus = this.buses!.sfx;
    this.tone('square', 110, t, 0.22, 0.14, bus, 98);
    this.tone('square', 116, t, 0.22, 0.1, bus, 103);
  }

  private at(atTime?: number): number | null {
    if (!this.ctx || !this.buses) return null;
    return Math.max(atTime ?? 0, this.ctx.currentTime);
  }

  private init(ctx: AudioContext): void {
    this.ctx = ctx;
    const master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    master.connect(limiter).connect(ctx.destination);
    const bus = (name: Bus) => {
      const g = ctx.createGain();
      g.gain.value = this.volumes[name];
      if (name !== 'master') g.connect(master);
      return g;
    };
    master.gain.value = this.volumes.master;
    this.buses = { master, music: bus('music'), sfx: bus('sfx'), piano: bus('piano') };
    // 0.1 s of white noise for the hammer thump; deterministic, no Math.random state needed.
    const len = Math.floor(ctx.sampleRate * 0.1);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let x = 0x2545f491;
    for (let i = 0; i < len; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      data[i] = ((x >>> 0) / 0xffffffff) * 2 - 1;
    }
  }

  /** One piano note: additive inharmonic partials plus a short hammer thump. */
  private pianoVoice(note: ScheduleNote, atTime: number, out: AudioNode, sources: Set<AudioScheduledSourceNode>): void {
    const ctx = this.ctx!;
    const { start: wanted, end: wantedEnd } = noteTimes(note, atTime);
    const start = Math.max(wanted, ctx.currentTime);
    const end = Math.max(wantedEnd, start + ATTACK_S * 2);
    const rel = releaseTau(note.pitch);
    const stopAt = start + voiceLength(end - start, rel);
    const track = (s: AudioScheduledSourceNode) => {
      sources.add(s);
      s.onended = () => sources.delete(s);
    };

    const voice = ctx.createGain();
    voice.connect(out);
    for (const p of pianoPartials(note.pitch, note.vel, ctx.sampleRate * 0.45)) {
      const osc = ctx.createOscillator();
      osc.frequency.value = p.freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(p.gain, start + ATTACK_S);
      g.gain.setTargetAtTime(0, start + ATTACK_S, p.decay);
      g.gain.setTargetAtTime(0, end, rel);
      osc.connect(g).connect(voice);
      osc.start(start);
      osc.stop(stopAt);
      track(osc);
    }

    if (this.noise) {
      const thump = ctx.createBufferSource();
      thump.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(4000, midiToFreq(note.pitch) * 3);
      bp.Q.value = 1.2;
      const g = ctx.createGain();
      const peak = velocityGain(note.vel) * 0.25;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(peak, start + 0.002);
      g.gain.setTargetAtTime(0, start + 0.002, 0.012);
      thump.connect(bp).connect(g).connect(voice);
      thump.start(start);
      thump.stop(start + 0.1);
      track(thump);
    }
    setTimeout(() => voice.disconnect(), (stopAt - ctx.currentTime) * 1000 + 300);
  }

  /** A plain chip-style tone with an instant attack and exponential decay. */
  private tone(type: OscillatorType, freq: number, t: number, len: number, gain: number, bus: AudioNode, endFreq?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.linearRampToValueAtTime(endFreq, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }
}
