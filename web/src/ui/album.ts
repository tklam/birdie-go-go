import type { ContentBundle } from '../core/types.gen';
import type { GameState } from '../systems/state';
import { modal, overlay } from './overlay';

const STARS = { perfect: '★★★', great: '★★', good: '★', blurry: '' } as const;

/** Shows the photo album: every species, with the best shot if taken. */
export function showAlbum(content: ContentBundle, state: GameState): Promise<void> {
  const box = document.createElement('div');
  box.className = 'window panel';
  const h = document.createElement('div');
  h.className = 'speaker';
  const caught = content.birds.filter((b) => state.album[b.id]).length;
  h.textContent = `Album ${caught}/${content.birds.length}`;
  box.appendChild(h);
  for (const bird of content.birds) {
    const entry = state.album[bird.id];
    const row = document.createElement('div');
    row.className = `album-row${entry ? '' : ' unknown'}`;
    const name = document.createElement('span');
    name.textContent = entry ? bird.name : '??????';
    const score = document.createElement('span');
    score.textContent = entry ? `${STARS[entry.rating]} ${entry.score}` : '';
    row.append(name, score);
    box.appendChild(row);
  }
  const b = document.createElement('div');
  b.className = 'panel-button';
  b.textContent = '▶ Close';
  box.appendChild(b);
  overlay().appendChild(box);
  modal.open++;
  return new Promise((resolve) => {
    const close = () => {
      box.remove();
      window.removeEventListener('keydown', onKey, true);
      modal.open--;
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (['Space', 'Enter', 'Escape', 'KeyZ'].includes(e.code)) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    setTimeout(() => {
      box.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        close();
      });
      window.addEventListener('keydown', onKey, true);
    }, 200);
  });
}
