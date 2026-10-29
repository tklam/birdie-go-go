import { modal, overlay } from './overlay';

export interface MenuItem {
  label: string;
  /** Runs when chosen. Return true to keep the menu open. */
  run: () => Promise<boolean | void> | boolean | void;
}

/**
 * A 16-bit menu window with a blinking cursor. Arrow keys / W,S move,
 * Space/Enter choose, Esc closes; tapping an item chooses it.
 */
export function showMenu(title: string, items: MenuItem[]): Promise<void> {
  const box = document.createElement('div');
  box.className = 'window panel menu-window';
  const h = document.createElement('div');
  h.className = 'speaker';
  h.textContent = title;
  box.appendChild(h);
  let selected = 0;
  let busy = false;
  let choose: () => Promise<void> = async () => {};
  const rows = items.map((item, i) => {
    const row = document.createElement('div');
    row.className = 'menu-item';
    row.textContent = item.label;
    row.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selected = i;
      render();
      void choose();
    });
    box.appendChild(row);
    return row;
  });
  overlay().appendChild(box);
  modal.open++;
  const render = () => rows.forEach((r, i) => r.classList.toggle('selected', i === selected));
  render();

  return new Promise((resolve) => {
    const close = () => {
      box.remove();
      window.removeEventListener('keydown', onKey, true);
      modal.open--;
      resolve();
    };
    choose = async () => {
      if (busy) return;
      busy = true;
      box.style.visibility = 'hidden';
      window.removeEventListener('keydown', onKey, true);
      const keep = await items[selected].run();
      busy = false;
      if (keep) {
        box.style.visibility = 'visible';
        window.addEventListener('keydown', onKey, true);
      } else {
        close();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const code = e.code;
      if (code === 'ArrowUp' || code === 'KeyW') selected = (selected + items.length - 1) % items.length;
      else if (code === 'ArrowDown' || code === 'KeyS') selected = (selected + 1) % items.length;
      else if (code === 'Space' || code === 'Enter' || code === 'KeyZ') void choose();
      else if (code === 'Escape' || code === 'Tab') close();
      else return;
      e.preventDefault();
      e.stopPropagation();
      render();
    };
    window.addEventListener('keydown', onKey, true);
  });
}
