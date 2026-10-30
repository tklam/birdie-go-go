import { overlay } from './overlay';

/** Floating joystick + Action and Menu buttons (SPEC.md §4.4). */
export class TouchControls {
  /** Joystick vector, each axis −1…1, magnitude ≤ 1. */
  readonly stick = { x: 0, y: 0 };
  private actionQueued = false;
  private menuQueued = false;
  private readonly root: HTMLDivElement;
  private readonly actionBtn: HTMLButtonElement;
  private readonly zone: HTMLDivElement;

  constructor() {
    this.root = document.createElement('div');
    const zone = document.createElement('div');
    this.zone = zone;
    zone.className = 'joystick-zone touch-only';
    const ring = document.createElement('div');
    ring.className = 'joystick';
    ring.style.display = 'none';
    const knob = document.createElement('div');
    knob.className = 'knob';
    ring.appendChild(knob);
    zone.appendChild(ring);

    const radius = 40;
    let pointer = -1;
    let ox = 0;
    let oy = 0;
    zone.addEventListener('pointerdown', (e) => {
      if (pointer !== -1) return;
      pointer = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      ox = e.clientX;
      oy = e.clientY;
      ring.style.left = `${ox}px`;
      ring.style.top = `${oy}px`;
      ring.style.display = 'block';
      knob.style.transform = '';
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointer) return;
      let dx = (e.clientX - ox) / radius;
      let dy = (e.clientY - oy) / radius;
      const m = Math.hypot(dx, dy);
      if (m > 1) {
        dx /= m;
        dy /= m;
      }
      this.stick.x = dx;
      this.stick.y = dy;
      knob.style.transform = `translate(${dx * radius}px, ${dy * radius}px)`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = -1;
      this.stick.x = 0;
      this.stick.y = 0;
      ring.style.display = 'none';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    this.actionBtn = this.button('btn action touch-only idle', 'A', () => (this.actionQueued = true));
    const menu = this.button('btn menu', 'Menu', () => (this.menuQueued = true));
    this.root.append(zone, this.actionBtn, menu);
    overlay().appendChild(this.root);
  }

  /** Shows or hides all touch controls, e.g. during a staged scene. */
  setVisible(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
  }

  /** Shows or hides the joystick (hidden for tap-to-move, so taps reach the map). */
  setJoystick(on: boolean): void {
    this.zone.style.display = on ? '' : 'none';
    if (!on) {
      this.stick.x = 0;
      this.stick.y = 0;
    }
  }

  /** Sets the Action button label (e.g. "Talk"), or idles it with null. */
  setAction(label: string | null): void {
    this.actionBtn.textContent = label ?? 'A';
    this.actionBtn.classList.toggle('idle', label === null);
  }

  /** Returns and clears a pending Action press. */
  takeAction(): boolean {
    const v = this.actionQueued;
    this.actionQueued = false;
    return v;
  }

  takeMenu(): boolean {
    const v = this.menuQueued;
    this.menuQueued = false;
    return v;
  }

  destroy(): void {
    this.root.remove();
  }

  private button(className: string, label: string, onPress: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = className;
    b.textContent = label;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onPress();
    });
    return b;
  }
}
