// Area soundscapes and one-off sound cues (SPEC.md §1.3): looping noise beds
// that swell and fade, crossfaded as Angie moves between areas, plus cues
// scattered at random (a car horn, a gull, cicadas) and cues the map plays
// itself (bird calls, a tram's bell). One player per AudioEngine, so the
// ambience carries on across scene restarts.
import type { AudioEngine } from './AudioEngine';
import type { SoundCue, Soundscape } from '../core/types.gen';
import { caption } from '../ui/captions';
import { cueAllowed, expandCue, nextWait } from './cues';

const FADE_S = 1.5;

interface Playing {
  id: string;
  out: GainNode;
  sources: AudioScheduledSourceNode[];
  scape: Soundscape;
  /** performance.now() ms when each of the soundscape's cues is next due. */
  due: number[];
}

export class SoundscapePlayer {
  private current: Playing | null = null;
  private readonly cues: Map<string, SoundCue>;

  constructor(
    private readonly audio: AudioEngine,
    cues: readonly SoundCue[],
  ) {
    this.cues = new Map(cues.map((c) => [c.id, c]));
  }

  /** Crossfades to `scape` (null fades to silence); the same one carries on. */
  set(scape: Soundscape | null): void {
    if ((scape?.id ?? null) === (this.current?.id ?? null)) return;
    const ctx = this.audio.context;
    const dest = this.audio.outdoor();
    const noise = this.audio.noise2s();
    if (!ctx || !dest || !noise) return;
    const t = ctx.currentTime;
    const old = this.current;
    if (old) {
      old.out.gain.cancelScheduledValues(t);
      old.out.gain.setValueAtTime(old.out.gain.value, t);
      old.out.gain.linearRampToValueAtTime(0, t + FADE_S);
      for (const s of old.sources) s.stop(t + FADE_S + 0.1);
      setTimeout(() => old.out.disconnect(), (FADE_S + 0.5) * 1000);
    }
    this.current = null;
    if (!scape) return;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + FADE_S);
    out.connect(dest);
    const sources: AudioScheduledSourceNode[] = [];
    scape.beds.forEach((b, i) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = b.filter as BiquadFilterType;
      filter.frequency.value = b.freq;
      filter.Q.value = b.q || 0.7;
      const level = ctx.createGain();
      const wobble = b.wobble ?? 0;
      level.gain.value = b.gain * (1 - wobble / 2);
      src.connect(filter).connect(level).connect(out);
      src.start(t, (i * 0.61) % 2);
      sources.push(src);
      if (wobble > 0 && b.rate) {
        // A slow swell: an LFO adding ± gain × wobble / 2.
        const lfo = ctx.createOscillator();
        lfo.frequency.value = b.rate;
        const depth = ctx.createGain();
        depth.gain.value = (b.gain * wobble) / 2;
        lfo.connect(depth).connect(level.gain);
        lfo.start(t);
        sources.push(lfo);
      }
    });
    const now = performance.now();
    // First cues come soon, so a new area announces itself.
    const due = scape.cues.map((c) => now + nextWait(c.every, Math.random()) * 400);
    this.current = { id: scape.id, out, sources, scape, due };
  }

  /** Plays the soundscape's scattered cues that are due (call a few times a second). */
  update(slot: string, season: string, rain: number): void {
    const p = this.current;
    if (!p || !this.audio.ready) return;
    const now = performance.now();
    p.scape.cues.forEach((c, i) => {
      if (now < p.due[i]) return;
      p.due[i] = now + nextWait(c.every, Math.random()) * 1000;
      if (!cueAllowed(c, slot, season, rain)) return;
      const vary = c.pitch ? 1 + (Math.random() * 2 - 1) * c.pitch : 1;
      this.cue(c.cue, { pitch: vary, gain: c.gain || 1, pan: Math.random() * 1.2 - 0.6, outdoor: true, silent: true });
    });
  }

  /**
   * Plays a cue by id now. Outdoor cues are muffled indoors. The cue's
   * caption shows unless `silent` (ambient background) or `caption` replaces it.
   */
  cue(id: string, opts: { pitch?: number; gain?: number; pan?: number; outdoor?: boolean; silent?: boolean; caption?: string } = {}): void {
    const cue = this.cues.get(id);
    if (!cue) return;
    this.audio.playCue(expandCue(cue, opts.pitch ?? 1), { gain: opts.gain, pan: opts.pan, outdoor: opts.outdoor });
    const text = opts.caption ?? cue.caption;
    if (text && !opts.silent) caption(text);
  }
}

const players = new WeakMap<AudioEngine, SoundscapePlayer>();

/** The engine's soundscape player, made on first use from the content's cues. */
export function soundscapes(audio: AudioEngine, cues: readonly SoundCue[]): SoundscapePlayer {
  let p = players.get(audio);
  if (!p) {
    p = new SoundscapePlayer(audio, cues);
    players.set(audio, p);
  }
  return p;
}
