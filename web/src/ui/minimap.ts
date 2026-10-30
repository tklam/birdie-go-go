import { closeModal, modal, overlay } from './overlay';

export interface MapMarker {
  /** World pixels. */
  x: number;
  y: number;
  kind: 'angie' | 'spot' | 'stop' | 'gateway' | 'shop' | 'door';
  label?: string;
  /** Highlighted (pulsing ring), e.g. birding spots near Angie. */
  near?: boolean;
}

/** A transit line drawn on the map, in world pixels. */
export interface MapLine {
  points: number[][];
  mode: string;
}

const KIND_CLASS: Record<MapMarker['kind'], string> = {
  angie: 'mm-angie',
  spot: 'mm-spot',
  stop: 'mm-stop',
  gateway: 'mm-gateway',
  shop: 'mm-shop',
  door: 'mm-door',
};

const ZOOMS = [1, 2, 3];

/**
 * Darkens the overview where the area isn't discovered yet (pure, on RGBA
 * pixels): `areas` holds one area index per pixel.
 */
export function fogPixels(rgba: Uint8ClampedArray, areas: ArrayLike<number>, discovered: (area: number) => boolean): void {
  for (let i = 0; i < areas.length; i++) {
    if (discovered(areas[i])) continue;
    const o = i * 4;
    rgba[o] = Math.round(rgba[o] * 0.15 + 16 * 0.85);
    rgba[o + 1] = Math.round(rgba[o + 1] * 0.15 + 24 * 0.85);
    rgba[o + 2] = Math.round(rgba[o + 2] * 0.15 + 48 * 0.85);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`map image ${url} failed to load`));
    img.src = url;
  });
}

/** The overview with undiscovered areas fogged, as a canvas (falls back to the plain picture). */
async function mapCanvas(url: string, fog?: { url: string; discovered: (area: number) => boolean }): Promise<HTMLCanvasElement> {
  const img = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(img, 0, 0);
  if (!fog) return canvas;
  try {
    const areasImg = await loadImage(fog.url);
    const a = document.createElement('canvas');
    a.width = areasImg.width;
    a.height = areasImg.height;
    const actx = a.getContext('2d');
    if (!actx) return canvas;
    actx.drawImage(areasImg, 0, 0);
    const src = actx.getImageData(0, 0, a.width, a.height).data;
    const areas = new Uint8Array(a.width * a.height);
    for (let i = 0; i < areas.length; i++) areas[i] = src[i * 4];
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    fogPixels(data.data, areas, fog.discovered);
    ctx.putImageData(data, 0, 0);
  } catch {
    // No fog: the plain map is still useful.
  }
  return canvas;
}

/**
 * Shows the world map: the one-pixel-per-tile overview scaled up by a whole
 * number (crisp), undiscovered areas fogged, transit lines and markers. − and
 * + zoom in on Angie (the map scrolls); Close, Space, Enter or Esc closes it.
 */
export async function showMinimap(opts: {
  title: string;
  imageUrl: string;
  widthTiles: number;
  heightTiles: number;
  tileSize: number;
  markers: MapMarker[];
  lines?: MapLine[];
  fog?: { url: string; discovered: (area: number) => boolean };
  /** A line under the map, e.g. the nearby birding spots. */
  note?: string;
}): Promise<void> {
  modal.open++;
  const canvas = await mapCanvas(opts.imageUrl, opts.fog).catch(() => document.createElement('canvas'));
  const box = document.createElement('div');
  box.className = 'window panel minimap';
  const h = document.createElement('div');
  h.className = 'speaker';
  h.textContent = opts.title;
  box.appendChild(h);

  // Largest whole-number scale that fits ~90% of the viewport width and 62% of its height.
  const base = Math.max(1, Math.floor(Math.min((innerWidth * 0.86) / opts.widthTiles, (innerHeight * 0.62) / opts.heightTiles)));
  const view = document.createElement('div');
  view.className = 'mm-view';
  view.style.width = `${opts.widthTiles * base}px`;
  view.style.height = `${opts.heightTiles * base}px`;
  const frame = document.createElement('div');
  frame.className = 'mm-frame';
  canvas.className = 'mm-image';
  view.appendChild(frame);
  box.appendChild(view);

  let zoom = 0;
  const angie = opts.markers.find((m) => m.kind === 'angie');
  const render = () => {
    const scale = base * ZOOMS[zoom];
    frame.replaceChildren(canvas);
    frame.style.width = `${opts.widthTiles * scale}px`;
    frame.style.height = `${opts.heightTiles * scale}px`;
    if (opts.lines?.length) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'mm-lines');
      svg.setAttribute('viewBox', `0 0 ${opts.widthTiles} ${opts.heightTiles}`);
      for (const l of opts.lines) {
        const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        pl.setAttribute('points', l.points.map(([x, y]) => `${x / opts.tileSize},${y / opts.tileSize}`).join(' '));
        pl.setAttribute('class', `mm-line mm-line-${l.mode}`);
        svg.appendChild(pl);
      }
      frame.appendChild(svg);
    }
    for (const m of opts.markers) {
      const dot = document.createElement('div');
      dot.className = `mm-marker ${KIND_CLASS[m.kind]}${m.near ? ' mm-near' : ''}`;
      dot.style.left = `${(m.x / opts.tileSize) * scale}px`;
      dot.style.top = `${(m.y / opts.tileSize) * scale}px`;
      if (m.label) dot.title = m.label;
      frame.appendChild(dot);
    }
    if (angie) {
      view.scrollLeft = (angie.x / opts.tileSize) * scale - view.clientWidth / 2;
      view.scrollTop = (angie.y / opts.tileSize) * scale - view.clientHeight / 2;
    }
    zoomOut.disabled = zoom === 0;
    zoomIn.disabled = zoom === ZOOMS.length - 1;
  };

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
  const nav = document.createElement('div');
  nav.className = 'album-nav';
  const button = (label: string, onPress: () => void) => {
    const b = document.createElement('button');
    b.className = 'album-btn';
    b.textContent = label;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onPress();
    });
    return b;
  };
  const zoomOut = button('−', () => ((zoom = Math.max(0, zoom - 1)), render()));
  const zoomIn = button('+', () => ((zoom = Math.min(ZOOMS.length - 1, zoom + 1)), render()));
  let close = () => {};
  nav.append(zoomOut, zoomIn, button('Close', () => close()));
  box.appendChild(nav);
  overlay().appendChild(box);
  render();

  return new Promise((resolve) => {
    close = () => {
      box.remove();
      window.removeEventListener('keydown', onKey, true);
      closeModal();
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (['Space', 'Enter', 'Escape', 'KeyZ', 'KeyM'].includes(e.code)) close();
      else if (e.code === 'Equal' || e.code === 'NumpadAdd') zoomIn.dispatchEvent(new PointerEvent('pointerdown'));
      else if (e.code === 'Minus' || e.code === 'NumpadSubtract') zoomOut.dispatchEvent(new PointerEvent('pointerdown'));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
  });
}
