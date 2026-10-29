import { describe, expect, it } from 'vitest';
import { closedGateAt, gateFrom, openWaterAt, spotBlocked } from './gates';

describe('gates', () => {
  const gate = gateFrom({ x: 56 * 16 + 8, y: 49 * 16 + 8, props: { requires: 'boots', w: '6', h: '4', hint: 'Mud!' } }, 16)!;
  it('reads a gate object', () => {
    expect(gate).toEqual({ tx: 56, ty: 49, w: 6, h: 4, requires: 'boots', hint: 'Mud!', water: false });
    expect(gateFrom({ x: 0, y: 0, props: {} }, 16)).toBeNull();
  });
  it('closes its tiles until Angie owns the item', () => {
    expect(closedGateAt([gate], 58, 50, {})).toBe(gate);
    expect(closedGateAt([gate], 62, 50, {})).toBeNull();
    expect(closedGateAt([gate], 58, 50, { boots: 1 })).toBeNull();
  });
  it('blocks spots that need gear or another time', () => {
    const night = { requiresItem: 'lens', slots: ['evening'] };
    expect(spotBlocked(night, { items: {}, slot: 'evening' })).toBe('needs');
    expect(spotBlocked(night, { items: { lens: 1 }, slot: 'morning' })).toBe('closed');
    expect(spotBlocked(night, { items: { lens: 1 }, slot: 'evening' })).toBeNull();
    expect(spotBlocked({}, { items: {}, slot: 'morning' })).toBeNull();
  });
});

describe('water gates', () => {
  it('open water for the item holder', () => {
    const g = gateFrom({ x: 8, y: 8, props: { requires: 'kayak', w: '3', h: '1', water: 'true' } }, 16)!;
    expect(openWaterAt([g], 1, 0, {})).toBe(false);
    expect(openWaterAt([g], 1, 0, { kayak: 1 })).toBe(true);
    expect(openWaterAt([g], 1, 1, { kayak: 1 })).toBe(false);
  });
});
