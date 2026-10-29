import { modal, overlay } from './overlay';

export interface MenuItem {
  label: string;
  /** Runs when chosen. Return true to keep the menu open. */
  run: () => Promise<boolean | void> | boolean | void;
  /** Shown under the list while this item is highlighted (e.g. a shop item's description). */
  detail?: () => string;
}

export interface MenuOptions {
  /** The item the cursor starts on; updated to the last chosen item. */
  selected?: number;
  /** Tapping an item only highlights it; tapping it again chooses it (e.g. buying). */
  tapToSelect?: boolean;
}

/**
 * A 16-bit menu window with a highlighted row and a blinking cursor. Arrow
 * keys / W,S move, Space/Enter choose, Esc closes; tapping an item chooses it
 * (or, with tapToSelect, highlights it first). Long menus scroll. `title` may
 * be a function, re-read whenever the menu redraws (e.g. money in a shop).
 */
export function showMenu(title: string | (() => string), items: MenuItem[], opts: MenuOptions = {}): Promise<void> {
  const box = document.createElement('div');
  box.className = 'window panel menu-window';
  const h = document.createElement('div');
  h.className = 'speaker';
  const list = document.createElement('div');
  list.className = 'menu-list';
  box.append(h, list);
  let selected = Math.min(Math.max(0, opts.selected ?? 0), items.length - 1);
  let busy = false;
  let choose: () => Promise<void> = async () => {};
  const rows = items.map((item, i) => {
    const row = document.createElement('div');
    row.className = 'menu-item';
    row.textContent = item.label;
    row.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const already = selected === i;
      selected = i;
      render();
      if (!opts.tapToSelect || already) void choose();
    });
    list.appendChild(row);
    return row;
  });
  const detail = document.createElement('div');
  detail.className = 'menu-detail';
  if (items.some((it) => it.detail)) box.appendChild(detail);
  overlay().appendChild(box);
  modal.open++;
  const render = () => {
    h.textContent = typeof title === 'function' ? title() : title;
    rows.forEach((r, i) => r.classList.toggle('selected', i === selected));
    rows[selected]?.scrollIntoView({ block: 'nearest' });
    detail.textContent = items[selected]?.detail?.() ?? '';
  };
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
      opts.selected = selected;
      box.style.visibility = 'hidden';
      window.removeEventListener('keydown', onKey, true);
      const keep = await items[selected].run();
      busy = false;
      if (keep) {
        render();
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
