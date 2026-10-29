import { exportSave, importSave } from './save';
import type { GameState } from './state';

/** Downloads the state as a JSON backup file (Settings → Export save). */
export function downloadSave(state: GameState): void {
  const blob = new Blob([exportSave(state)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `birdie-go-go-day${state.day}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Asks the player for a backup file and returns its state, or null if cancelled. */
export function pickSave(): Promise<GameState | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then((text) => {
        try {
          resolve(importSave(text));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }, reject);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
