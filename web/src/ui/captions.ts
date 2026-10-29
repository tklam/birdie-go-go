// Captions for sound cues (SPEC.md §1.3, accessibility): a short line near
// the bottom of the screen, e.g. "♪ O Boy chirps", while Captions is on.
import { overlay } from './overlay';

let enabled = false;
let el: HTMLDivElement | null = null;
let timer = 0;

export function setCaptions(on: boolean): void {
  enabled = on;
  if (!on) el?.classList.add('hidden');
}

/** Shows a caption for a sound if captions are on. */
export function caption(text: string, ms = 1800): void {
  if (!enabled) return;
  if (!el) {
    el = document.createElement('div');
    el.className = 'window caption hidden';
    overlay().appendChild(el);
  }
  el.textContent = `♪ ${text}`;
  el.classList.remove('hidden');
  clearTimeout(timer);
  timer = window.setTimeout(() => el?.classList.add('hidden'), ms);
}
