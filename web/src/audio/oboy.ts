// O Boy's voice: short clips cut from field recordings of Pacific parrotlets
// (art/audio/CREDITS.md), played with a slight pitch variation each time.
import type { AudioEngine } from './AudioEngine';
import { caption } from '../ui/captions';

const vary = () => 0.94 + Math.random() * 0.14;

/** One random chirp. */
export function oboyChirp(audio: AudioEngine | undefined): void {
  caption('O Boy chirps');
  const ids = audio?.sampleIds('sfx_oboy_chirp') ?? [];
  if (ids.length) audio?.playSample(ids[Math.floor(Math.random() * ids.length)], { rate: vary() });
}

/** The two-note contact call (photo sessions). */
export function oboyCall(audio: AudioEngine | undefined): void {
  caption('O Boy calls: chee-chee!');
  audio?.playSample('sfx_oboy_call', { rate: vary() });
}

/** An excited burst of calls (encounters). */
export function oboySquawk(audio: AudioEngine | undefined): void {
  caption('O Boy squawks loudly!');
  audio?.playSample('sfx_oboy_squawk', { gain: 0.9 });
}
