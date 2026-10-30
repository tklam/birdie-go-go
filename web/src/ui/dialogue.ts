import { closeModal, modal, overlay } from './overlay';
import { textCharsPerSecond } from './prefs';

export interface Line {
  speaker: string;
  text: string;
  /** The speaker's character sheet; its first frame's head is shown as a portrait. */
  portrait?: string | null;
}

/**
 * Shows lines one at a time in a 16-bit dialogue window with a typewriter
 * effect. Tap/click, Space or Enter finishes the line or advances. Resolves
 * after the last line.
 */
export function showDialogue(lines: Line[], onLine?: (index: number) => void): Promise<void> {
  if (lines.length === 0) return Promise.resolve();
  const box = document.createElement('div');
  box.className = 'window dialogue';
  const face = document.createElement('div');
  face.className = 'portrait';
  box.appendChild(face);
  const speaker = document.createElement('div');
  speaker.className = 'speaker';
  const text = document.createElement('div');
  const next = document.createElement('div');
  next.className = 'next';
  next.textContent = '▼';
  box.append(speaker, text, next);
  overlay().appendChild(box);
  modal.open++;

  return new Promise((resolve) => {
    let line = 0;
    let shown = 0;
    let timer = 0;

    const render = () => {
      const l = lines[line];
      speaker.textContent = l.speaker;
      face.style.display = l.portrait ? '' : 'none';
      box.classList.toggle('with-portrait', !!l.portrait);
      if (l.portrait) face.style.backgroundImage = `url("${l.portrait}")`;
      text.textContent = l.text.slice(0, shown);
      next.style.visibility = shown >= l.text.length ? 'visible' : 'hidden';
    };
    const type = () => {
      clearInterval(timer);
      onLine?.(line);
      const cps = textCharsPerSecond();
      shown = cps > 0 ? 0 : lines[line].text.length;
      render();
      if (cps <= 0) return;
      timer = window.setInterval(() => {
        shown++;
        render();
        if (shown >= lines[line].text.length) clearInterval(timer);
      }, 1000 / cps);
    };
    const advance = () => {
      if (shown < lines[line].text.length) {
        shown = lines[line].text.length;
        clearInterval(timer);
        render();
        return;
      }
      line++;
      if (line < lines.length) {
        type();
        return;
      }
      clearInterval(timer);
      box.remove();
      window.removeEventListener('keydown', onKey);
      closeModal();
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyZ') {
        e.preventDefault();
        advance();
      }
    };
    box.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      advance();
    });
    window.addEventListener('keydown', onKey);
    type();
  });
}
