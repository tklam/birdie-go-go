// The game's one AudioContext: master/music/sfx/piano buses, a synthesized
// piano voice, a metronome click and a few 16-bit-flavoured SFX generated with
// oscillators, plus short recorded samples (O Boy's calls) from the asset
// manifest, decoded once and cached for offline play. Content sound cues
// (bird calls, the tram bell; ./cues.ts) are synthesized by playCue.
// All timing is against AudioContext.currentTime (AGENTS.md rule 10).
import {
  ATTACK_S,
  clampVolume,
  dueUntil,
  midiToFreq,
  nearestSample,
  noteTimes,
  pianoPartials,
  releaseTau,
  samplePitch,
  scheduleEnd,
  sortNotes,
  velocityGain,
  voiceLength,
  type ScheduleNote,
} from './voice';
import type { CueEvent } from './cues';

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
  /** Weather ambience: rain hiss and wind rumble from looping noise. */
  private ambience: { rain: GainNode; wind: GainNode; filter: BiquadFilterNode; out: GainNode } | null = null;
  /** Two seconds of looping noise for the ambience, soundscape beds and noise notes. */
  private loopNoise: AudioBuffer | null = null;
  private readonly volumes: Record<Bus, number> = { master: 1, music: 0.8, sfx: 0.8, piano: 1 };
  /** Sample id → URL (registered from the manifest), and decoded buffers. */
  private readonly sampleUrls = new Map<string, string>();
  private readonly samples = new Map<string, Promise<AudioBuffer | null>>();
  /** Decoded piano samples by MIDI pitch (Salamander Grand Piano); empty until loaded, then lessons use them. */
  private readonly pianoBank = new Map<number, AudioBuffer>();
  private pianoBankLoading = false;

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
    this.loadPianoBank();
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

  /** The music bus, for the background-music player (null until unlocked). */
  musicOutput(): AudioNode | null {
    return this.buses?.music ?? null;
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

  /** Registers recorded samples by id; they're decoded on first use. */
  registerSamples(urls: Record<string, string>): void {
    for (const [id, url] of Object.entries(urls)) this.sampleUrls.set(id, url);
    this.loadPianoBank();
  }

  /** Ids of registered samples that start with `prefix`. */
  sampleIds(prefix = ''): string[] {
    return [...this.sampleUrls.keys()].filter((id) => id.startsWith(prefix));
  }

  /**
   * Weather ambience (SPEC.md §4.9): rain and wind levels 0–1, eased; muffled
   * (low-passed and quieter) indoors. Built on first use.
   */
  setAmbience(rain: number, wind: number, muffled: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.buses) return;
    this.ambience ??= this.buildAmbience(ctx, this.buses.sfx);
    const a = this.ambience;
    const t = ctx.currentTime;
    a.rain.gain.setTargetAtTime(Math.max(0, Math.min(1, rain)) * 0.12, t, 0.6);
    a.wind.gain.setTargetAtTime(Math.max(0, Math.min(1, wind)) * 0.16, t, 0.9);
    a.filter.frequency.setTargetAtTime(muffled ? 450 : 16000, t, 0.3);
    a.out.gain.setTargetAtTime(muffled ? 0.5 : 1, t, 0.3);
  }

  /**
   * The outdoor sound chain (null before unlock): weather, soundscapes and
   * sounds placed in the world go through it, so indoors muffles them all.
   */
  outdoor(): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.buses) return null;
    this.ambience ??= this.buildAmbience(ctx, this.buses.sfx);
    return this.ambience.filter;
  }

  /** Two seconds of white noise, meant to be looped (null before unlock). */
  noise2s(): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    if (!this.loopNoise) {
      // From a fixed LCG (no global random state).
      const len = ctx.sampleRate * 2;
      this.loopNoise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.loopNoise.getChannelData(0);
      let x = 12345;
      for (let i = 0; i < len; i++) {
        x = (x * 1103515245 + 12345) >>> 0;
        data[i] = (x / 2 ** 32) * 2 - 1;
      }
    }
    return this.loopNoise;
  }

  /**
   * Plays a synthesized cue (expandCue's events) at `at` (an AudioContext
   * time; now by default), scaled by `gain` and panned −1…1. `outdoor`
   * sounds go through the outdoor chain and are muffled indoors.
   */
  playCue(events: readonly CueEvent[], opts: { at?: number; gain?: number; pan?: number; outdoor?: boolean } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.buses || events.length === 0) return;
    const t0 = Math.max(opts.at ?? 0, ctx.currentTime) + 0.01;
    const out = ctx.createGain();
    out.gain.value = opts.gain ?? 1;
    const pan = ctx.createStereoPanner?.();
    if (pan) {
      pan.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0));
      out.connect(pan).connect((opts.outdoor && this.outdoor()) || this.buses.sfx);
    } else {
      out.connect((opts.outdoor && this.outdoor()) || this.buses.sfx);
    }
    let end = t0;
    for (const e of events) {
      const t = t0 + e.start;
      // Band-passed noise keeps little of the noise's power; make up for it
      // so a noise note sounds about as loud as a tone of the same gain.
      const level = e.wave === 'noise' ? e.gain * 2 * Math.sqrt(e.q) : e.gain;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      if (e.env === 'swell') {
        const rise = Math.min(0.4, e.dur * 0.35);
        g.gain.linearRampToValueAtTime(level, t + rise);
        g.gain.setValueAtTime(level, t + e.dur - rise);
        g.gain.linearRampToValueAtTime(0, t + e.dur);
      } else {
        g.gain.linearRampToValueAtTime(level, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + e.dur);
      }
      g.connect(out);
      let src: AudioScheduledSourceNode;
      if (e.wave === 'noise') {
        const n = ctx.createBufferSource();
        n.buffer = this.noise2s();
        n.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = e.q;
        bp.frequency.setValueAtTime(e.freq, t);
        if (e.to !== e.freq) bp.frequency.exponentialRampToValueAtTime(e.to, t + e.dur);
        n.connect(bp).connect(g);
        // A different stretch of the loop each time.
        n.start(t, (e.freq * 7.3 + e.start * 131) % 1.9);
        src = n;
      } else {
        const osc = ctx.createOscillator();
        osc.type = e.wave as OscillatorType;
        osc.frequency.setValueAtTime(e.freq, t);
        if (e.to !== e.freq) osc.frequency.exponentialRampToValueAtTime(e.to, t + e.dur);
        osc.connect(g);
        osc.start(t);
        src = osc;
      }
      src.stop(t + e.dur + 0.02);
      end = Math.max(end, t + e.dur + 0.02);
    }
    setTimeout(() => out.disconnect(), (end - ctx.currentTime) * 1000 + 300);
  }

  private buildAmbience(ctx: AudioContext, bus: AudioNode) {
    const buf = this.noise2s()!;
    const source = (offset: number) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start(ctx.currentTime, offset);
      return s;
    };
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 16000;
    const out = ctx.createGain();
    filter.connect(out).connect(bus);
    const rainBand = ctx.createBiquadFilter();
    rainBand.type = 'bandpass';
    rainBand.frequency.value = 2800;
    rainBand.Q.value = 0.6;
    const rain = ctx.createGain();
    rain.gain.value = 0;
    source(0).connect(rainBand).connect(rain).connect(filter);
    const windBand = ctx.createBiquadFilter();
    windBand.type = 'lowpass';
    windBand.frequency.value = 320;
    const wind = ctx.createGain();
    wind.gain.value = 0;
    source(0.7).connect(windBand).connect(wind).connect(filter);
    return { rain, wind, filter, out };
  }

  /**
   * Plays a recorded sample on the SFX bus as soon as it's decoded. `rate`
   * shifts pitch and speed slightly so repeats don't sound identical.
   */
  playSample(id: string, opts: { rate?: number; gain?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.buses) return;
    void this.decode(id).then((buffer) => {
      if (!buffer || !this.buses) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = opts.rate ?? 1;
      const g = ctx.createGain();
      g.gain.value = opts.gain ?? 0.8;
      src.connect(g).connect(this.buses.sfx);
      src.start(ctx.currentTime);
      src.onended = () => g.disconnect();
    });
  }

  /** Decodes the piano samples (sfx_piano_*) once; the synth plays until they're in. */
  private loadPianoBank(): void {
    if (this.pianoBankLoading || !this.ctx) return;
    // Audio may unlock before the manifest's samples are registered; then
    // registerSamples() tries again.
    const ids = [...this.sampleUrls.keys()].filter((id) => samplePitch(id) !== null);
    if (ids.length === 0) return;
    this.pianoBankLoading = true;
    for (const id of ids) {
      void this.decode(id).then((buf) => {
        if (buf) this.pianoBank.set(samplePitch(id) as number, buf);
      });
    }
  }

  /** A sampled piano note, or false if no sample is loaded. */
  private sampledVoice(note: ScheduleNote, start: number, end: number, out: AudioNode, track: (s: AudioScheduledSourceNode) => void): boolean {
    const near = nearestSample([...this.pianoBank.keys()], note.pitch);
    const buf = near && this.pianoBank.get(near.pitch);
    if (!near || !buf) return false;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = near.rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(velocityGain(note.vel) * 1.6, start);
    g.gain.setTargetAtTime(0, end, releaseTau(note.pitch));
    src.connect(g).connect(out);
    const stopAt = Math.min(start + buf.duration / near.rate, end + 5 * releaseTau(note.pitch));
    src.start(start);
    src.stop(stopAt);
    track(src);
    setTimeout(() => g.disconnect(), (stopAt - ctx.currentTime) * 1000 + 300);
    return true;
  }

  private decode(id: string): Promise<AudioBuffer | null> {
    let p = this.samples.get(id);
    const url = this.sampleUrls.get(id);
    if (!p && url && this.ctx) {
      const ctx = this.ctx;
      p = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .catch((err: unknown) => {
          console.warn(`sample ${id} failed to load`, err);
          return null;
        });
      this.samples.set(id, p);
    }
    return p ?? Promise.resolve(null);
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

  /**
   * A festival drum stroke at `atTime` (or now): a low sine thump falling in
   * pitch, plus a short noise slap for the drumhead. Used by the rhythm game.
   */
  drum(atTime?: number): void {
    const t = this.at(atTime);
    if (t === null) return;
    const ctx = this.ctx!;
    const bus = this.buses!.sfx;
    this.tone('sine', 150, t, 0.3, 0.55, bus, 52);
    this.tone('triangle', 95, t, 0.18, 0.2, bus, 60);
    if (this.noise) {
      const slap = ctx.createBufferSource();
      slap.buffer = this.noise;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.002);
      g.gain.setTargetAtTime(0, t + 0.002, 0.02);
      slap.connect(lp).connect(g).connect(bus);
      slap.start(t);
      slap.stop(t + 0.1);
      slap.onended = () => g.disconnect();
    }
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
    if (this.sampledVoice(note, start, end, out, track)) return;

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
