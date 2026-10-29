import type { ContentBundle } from '../core/types.gen';
import type { Manifest } from '../systems/assets';
import type { GameState } from '../systems/state';
import { modal, overlay } from './overlay';

const STARS = { perfect: '★★★', great: '★★', good: '★', blurry: '' } as const;

/** Album rows per page: five portraits fit the 180-pixel-high screen. */
export const ALBUM_PAGE_SIZE = 5;

/**
 * Shows the photo album, a page of species at a time, with the best shot of
 * each species photographed. ◀ ▶ (or the arrow keys) turn pages; Close (or
 * Esc) closes.
 */
export function showAlbum(content: ContentBundle, state: GameState, manifest: Manifest = {}): Promise<void> {
  const birds = content.birds;
  const pages = Math.max(1, Math.ceil(birds.length / ALBUM_PAGE_SIZE));
  const caught = birds.filter((b) => state.album[b.id]).length;
  let page = 0;

  const box = document.createElement('div');
  box.className = 'window panel album-window';
  const h = document.createElement('div');
  h.className = 'speaker';
  const list = document.createElement('div');
  const nav = document.createElement('div');
  nav.className = 'album-nav';
  const prev = navButton('◀');
  const next = navButton('▶');
  const close = navButton('Close');
  nav.append(prev, next, close);
  box.append(h, list, nav);

  const render = () => {
    const feathers = state.items.feather ?? 0;
    h.textContent = `Album ${caught}/${birds.length}${feathers ? ` · Feathers ${feathers}` : ''} · ${page + 1}/${pages}`;
    list.replaceChildren(...birds.slice(page * ALBUM_PAGE_SIZE, (page + 1) * ALBUM_PAGE_SIZE).map((bird) => albumRow(bird, state, manifest)));
    prev.style.visibility = page > 0 ? 'visible' : 'hidden';
    next.style.visibility = page < pages - 1 ? 'visible' : 'hidden';
  };
  const turn = (by: number) => {
    page = Math.min(pages - 1, Math.max(0, page + by));
    render();
  };
  render();
  overlay().appendChild(box);
  modal.open++;
  return new Promise((resolve) => {
    const done = () => {
      box.remove();
      window.removeEventListener('keydown', onKey, true);
      modal.open--;
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') turn(-1);
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') turn(1);
      else if (['Space', 'Enter', 'Escape', 'KeyZ', 'KeyX'].includes(e.code)) done();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const tap = (el: HTMLElement, run: () => void) =>
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        run();
      });
    // A short delay so the tap that opened the album doesn't also close it.
    setTimeout(() => {
      tap(prev, () => turn(-1));
      tap(next, () => turn(1));
      tap(close, done);
      window.addEventListener('keydown', onKey, true);
    }, 200);
  });
}

function navButton(label: string): HTMLElement {
  const b = document.createElement('div');
  b.className = 'album-btn';
  b.textContent = label;
  return b;
}

function albumRow(bird: ContentBundle['birds'][number], state: GameState, manifest: Manifest): HTMLElement {
  const entry = state.album[bird.id];
  const row = document.createElement('div');
  row.className = `album-row${entry ? '' : ' unknown'}`;
  const portrait = manifest[`album_${bird.id}`]?.file;
  const pic = document.createElement('div');
  pic.className = 'album-pic';
  if (entry && portrait) {
    const img = document.createElement('img');
    img.src = `${import.meta.env.BASE_URL}assets/${portrait}`;
    img.alt = bird.name;
    pic.appendChild(img);
  }
  row.appendChild(pic);
  const name = document.createElement('span');
  name.textContent = entry ? bird.name : '??????';
  const score = document.createElement('span');
  score.textContent = entry ? `${STARS[entry.rating]} ${entry.score}` : '';
  row.append(name, score);
  return row;
}
