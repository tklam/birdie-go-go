import { closeModal, modal, overlay } from './overlay';

/**
 * Shows a centered 16-bit window with a title, lines of text and a button.
 * Resolves when the player taps the window or presses Space/Enter.
 */
export function showPanel(title: string, lines: string[], button = 'OK'): Promise<void> {
  const box = document.createElement('div');
  box.className = 'window panel';
  const h = document.createElement('div');
  h.className = 'speaker';
  h.textContent = title;
  box.appendChild(h);
  for (const l of lines) {
    const p = document.createElement('div');
    p.textContent = l;
    box.appendChild(p);
  }
  const b = document.createElement('div');
  b.className = 'panel-button';
  b.textContent = `▶ ${button}`;
  box.appendChild(b);
  overlay().appendChild(box);
  modal.open++;
  return new Promise((resolve) => {
    const close = () => {
      box.remove();
      window.removeEventListener('keydown', onKey);
      closeModal();
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        close();
      }
    };
    // Ignore the press that opened the panel.
    setTimeout(() => {
      box.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        close();
      });
      window.addEventListener('keydown', onKey);
    }, 250);
  });
}

/** A floating DOM button (e.g. Back) that calls onPress. Returns a remover. */
export function floatingButton(label: string, className: string, onPress: () => void): () => void {
  const b = document.createElement('button');
  b.className = `btn ${className}`;
  b.textContent = label;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onPress();
  });
  overlay().appendChild(b);
  return () => b.remove();
}
