import { overlay } from './overlay';

let el: HTMLDivElement | null = null;
let timer = 0;

/** Shows a short message (e.g. an area name) at the top of the game. */
export function toast(message: string, ms = 2200): void {
  if (!el) {
    el = document.createElement('div');
    el.className = 'window toast hidden';
    overlay().appendChild(el);
  }
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(timer);
  timer = window.setTimeout(() => el?.classList.add('hidden'), ms);
}
