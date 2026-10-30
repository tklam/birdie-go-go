import './ui.css';
import { GAME_HEIGHT, GAME_WIDTH } from '../systems/display';

let root: HTMLDivElement | null = null;

/** The DOM layer above the canvas for windows and touch controls. */
export function overlay(): HTMLDivElement {
  if (root) return root;
  root = document.createElement('div');
  root.id = 'ui';
  document.body.appendChild(root);
  const markTouch = () => root?.classList.add('touch');
  if (matchMedia('(pointer: coarse)').matches) markTouch();
  window.addEventListener('touchstart', markTouch, { once: true, passive: true });
  return root;
}

/** Keeps --px (one game pixel in CSS px) in sync with the canvas zoom. */
export function setOverlayZoom(zoom: number): void {
  const s = document.documentElement.style;
  s.setProperty('--px', `${zoom}px`);
  s.setProperty('--game-w', `${GAME_WIDTH * zoom}px`);
  s.setProperty('--game-h', `${GAME_HEIGHT * zoom}px`);
}

/**
 * True while a modal window (dialogue, menu) owns input. `closedAt` is when
 * the last one closed (performance.now()), so the key press that closed it
 * isn't read again as a fresh action by the scene underneath.
 */
export const modal = { open: 0, closedAt: -Infinity };

/** Marks a modal window as closed; call instead of `modal.open--`. */
export function closeModal(): void {
  modal.open = Math.max(0, modal.open - 1);
  modal.closedAt = performance.now();
}
