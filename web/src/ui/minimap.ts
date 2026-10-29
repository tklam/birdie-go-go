import { modal, overlay } from './overlay';

export interface MapMarker {
  /** World pixels. */
  x: number;
  y: number;
  kind: 'angie' | 'spot' | 'stop' | 'gateway' | 'shop' | 'door';
  label?: string;
  /** Highlighted (pulsing ring), e.g. birding spots near Angie. */
  near?: boolean;
}

const KIND_CLASS: Record<MapMarker['kind'], string> = {
  angie: 'mm-angie',
  spot: 'mm-spot',
  stop: 'mm-stop',
  gateway: 'mm-gateway',
  shop: 'mm-shop',
  door: 'mm-door',
};

/**
 * Shows the world map: the one-pixel-per-tile overview scaled up by a whole
 * number (crisp), with markers. Tap, Space, Enter or Esc closes it.
 */
export function showMinimap(opts: {
  title: string;
  imageUrl: string;
  widthTiles: number;
  heightTiles: number;
  tileSize: number;
  markers: MapMarker[];
  /** A line under the map, e.g. the nearby birding spots. */
  note?: string;
}): Promise<void> {
  const box = document.createElement('div');
  box.className = 'window panel minimap';
  const h = document.createElement('div');
  h.className = 'speaker';
  h.textContent = opts.title;
  box.appendChild(h);

  // Largest whole-number scale that fits ~90% of the viewport width and 65% of its height.
  const scale = Math.max(1, Math.floor(Math.min((innerWidth * 0.86) / opts.widthTiles, (innerHeight * 0.62) / opts.heightTiles)));
  const frame = document.createElement('div');
  frame.className = 'mm-frame';
  frame.style.width = `${opts.widthTiles * scale}px`;
  frame.style.height = `${opts.heightTiles * scale}px`;
  const img = document.createElement('img');
  img.src = opts.imageUrl;
  img.alt = 'Map';
  img.className = 'mm-image';
  frame.appendChild(img);
  for (const m of opts.markers) {
    const dot = document.createElement('div');
    dot.className = `mm-marker ${KIND_CLASS[m.kind]}${m.near ? ' mm-near' : ''}`;
    dot.style.left = `${(m.x / opts.tileSize) * scale}px`;
    dot.style.top = `${(m.y / opts.tileSize) * scale}px`;
    if (m.label) dot.title = m.label;
    frame.appendChild(dot);
  }
  box.appendChild(frame);
  if (opts.note) {
    const note = document.createElement('div');
    note.className = 'mm-note';
    note.textContent = opts.note;
    box.appendChild(note);
  }
  const legend = document.createElement('div');
  legend.className = 'mm-legend';
  legend.innerHTML =
    '<span class="mm-key mm-angie"></span>You <span class="mm-key mm-spot"></span>Birds <span class="mm-key mm-stop"></span>Transit <span class="mm-key mm-gateway"></span>Gate <span class="mm-key mm-shop"></span>Shop <span class="mm-key mm-door"></span>Homes';
  box.appendChild(legend);
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
      if (['Space', 'Enter', 'Escape', 'KeyZ', 'KeyM'].includes(e.code)) {
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
