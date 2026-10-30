import type Phaser from 'phaser';
import { modal } from '../ui/overlay';
import type { TouchControls } from '../ui/touchControls';

export interface MoveInput {
  /** Direction, magnitude ≤ 1. */
  x: number;
  y: number;
  sneak: boolean;
  action: boolean;
  menu: boolean;
}

/** Joystick deflection below this counts as sneaking (SPEC.md §4.4). */
export const SNEAK_THRESHOLD = 0.55;

/** Combines a keyboard direction and a joystick vector (pure). */
export function combine(
  keys: { left: boolean; right: boolean; up: boolean; down: boolean; sneak: boolean },
  stick: { x: number; y: number },
): { x: number; y: number; sneak: boolean } {
  let x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  let y = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  if (x !== 0 || y !== 0) {
    const m = Math.hypot(x, y);
    return { x: x / m, y: y / m, sneak: keys.sneak };
  }
  const m = Math.hypot(stick.x, stick.y);
  if (m < 0.15) return { x: 0, y: 0, sneak: false };
  x = stick.x;
  y = stick.y;
  return { x, y, sneak: m < SNEAK_THRESHOLD };
}

/** Reads keyboard (arrows/WASD, Shift, Space/Enter/Z, Esc/Tab) and touch. */
export class InputReader {
  private readonly keys: Record<string, Phaser.Input.Keyboard.Key>;

  constructor(
    scene: Phaser.Scene,
    private readonly touch: TouchControls,
  ) {
    const kb = scene.input.keyboard;
    if (!kb) throw new Error('keyboard input unavailable');
    this.keys = kb.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D,SHIFT,SPACE,ENTER,Z,ESC,TAB') as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
  }

  read(): MoveInput {
    const k = this.keys;
    const dir = combine(
      {
        left: k.LEFT.isDown || k.A.isDown,
        right: k.RIGHT.isDown || k.D.isDown,
        up: k.UP.isDown || k.W.isDown,
        down: k.DOWN.isDown || k.S.isDown,
        sneak: k.SHIFT.isDown,
      },
      this.touch.stick,
    );
    // A key press that closed a dialogue or menu isn't also a fresh action.
    const after = modal.closedAt;
    const action = this.touch.takeAction() || freshPress(k.SPACE, after) || freshPress(k.ENTER, after) || freshPress(k.Z, after);
    const menu = this.touch.takeMenu() || freshPress(k.ESC, after) || freshPress(k.TAB, after);
    if (modal.open > 0) return { x: 0, y: 0, sneak: false, action: false, menu: false };
    return { ...dir, action, menu };
  }
}

/**
 * Whether a key went down after `since` (performance.now() time). Phaser
 * stamps keys with the DOM event's timeStamp, on the same clock (pure).
 */
export function pressedSince(timeDown: number, since: number): boolean {
  return timeDown > since;
}

/** A just-down key pressed after `since`; consumes the press either way. */
function freshPress(key: Phaser.Input.Keyboard.Key, since: number): boolean {
  return justDown(key) && pressedSince(key.timeDown, since);
}

// Same as Phaser.Input.Keyboard.JustDown, without importing Phaser at
// module load (keeps this file testable in Node).
function justDown(key: Phaser.Input.Keyboard.Key): boolean {
  const k = key as Phaser.Input.Keyboard.Key & { _justDown: boolean };
  if (k._justDown) {
    k._justDown = false;
    return true;
  }
  return false;
}
