// Player UI preferences applied to the DOM overlay (SPEC.md §1.3).
import type { Settings, TextSpeed, WindowColor } from '../systems/state';
import { setCaptions } from './captions';

/** Typewriter characters per second; 0 shows each line at once. */
const CHARS_PER_SECOND: Record<TextSpeed, number> = { slow: 25, normal: 45, fast: 90, instant: 0 };

/** Window gradient top and bottom per theme, all from the master palette. */
const WINDOW_THEMES: Record<WindowColor, [string, string]> = {
  blue: ['#3f7fdf', '#1b2a4a'],
  green: ['#2f8f6f', '#14302a'],
  plum: ['#8f4f9f', '#2a1838'],
  grey: ['#6e6e80', '#26262e'],
};

let charsPerSecond = CHARS_PER_SECOND.normal;

/** The current dialogue speed in characters per second (0 = instant). */
export function textCharsPerSecond(): number {
  return charsPerSecond;
}

let colorBlind = false;

/** Whether the colour-blind-safe palette is on (scenes pick bar and marker colours by it). */
export function colorBlindSafe(): boolean {
  return colorBlind;
}

/** Good/bad colours for bars and marks: green/red, or blue/orange (Okabe-Ito) when colour-blind safe. */
export function goodBad(): { good: number; bad: number } {
  return colorBlind ? { good: 0x56b4e9, bad: 0xe69f00 } : { good: 0x5fcf5f, bad: 0xdf5f3f };
}

/** Applies text speed, window colour, captions and the colour-blind palette; call after loading and on change. */
export function applyUiPrefs(settings: Pick<Settings, 'textSpeed' | 'windowColor' | 'captions' | 'colorBlindSafe'>): void {
  setCaptions(settings.captions);
  colorBlind = settings.colorBlindSafe;
  document.documentElement.classList.toggle('cb-safe', colorBlind);
  charsPerSecond = CHARS_PER_SECOND[settings.textSpeed] ?? CHARS_PER_SECOND.normal;
  const [top, bottom] = WINDOW_THEMES[settings.windowColor] ?? WINDOW_THEMES.blue;
  const root = document.documentElement.style;
  root.setProperty('--win-top', top);
  root.setProperty('--win-bottom', bottom);
}
