import { describe, expect, it } from 'vitest';
import { FollowerTrail, KEI_FOLLOW_DISTANCE } from './party';

describe('FollowerTrail', () => {
  it('has no position before anything is recorded', () => {
    expect(new FollowerTrail().positionAt(12)).toBeNull();
  });

  it('waits at the oldest point until enough path exists', () => {
    const t = new FollowerTrail();
    t.push(0, 0);
    t.push(5, 0);
    expect(t.positionAt(KEI_FOLLOW_DISTANCE)).toEqual({ x: 0, y: 0 });
  });

  it('interpolates along a straight path', () => {
    const t = new FollowerTrail();
    for (let x = 0; x <= 30; x += 2) t.push(x, 0);
    expect(t.positionAt(12)).toEqual({ x: 18, y: 0 });
    expect(t.positionAt(13)).toEqual({ x: 17, y: 0 });
    expect(t.positionAt(0)).toEqual({ x: 30, y: 0 });
  });

  it('follows around corners along the recorded path, not the straight line', () => {
    const t = new FollowerTrail();
    t.push(0, 0);
    t.push(10, 0);
    t.push(10, 10);
    // 12 px back: 10 px down the vertical leg, 2 px along the horizontal one.
    const p = t.positionAt(12);
    expect(p?.x).toBeCloseTo(8);
    expect(p?.y).toBeCloseTo(0);
  });

  it('ignores sub-pixel jitter', () => {
    const t = new FollowerTrail();
    t.push(0, 0);
    t.push(0.4, 0.3);
    t.push(0.2, -0.5);
    expect(t.path).toEqual([{ x: 0, y: 0 }]);
    t.push(1, 0);
    expect(t.path).toHaveLength(2);
  });

  it('does not move the follower while the leader stands still', () => {
    const t = new FollowerTrail();
    for (let x = 0; x <= 20; x++) t.push(x, 0);
    const before = t.positionAt(12);
    for (let i = 0; i < 10; i++) t.push(20, 0);
    expect(t.positionAt(12)).toEqual(before);
  });

  it('trims old points but keeps enough path for maxLength', () => {
    const t = new FollowerTrail({ maxLength: 20 });
    for (let x = 0; x <= 200; x += 3) t.push(x, 0);
    expect(t.path.length).toBeLessThan(12);
    expect(t.length).toBeGreaterThanOrEqual(20);
    expect(t.length).toBeLessThan(20 + 3);
    expect(t.positionAt(12)?.x).toBeCloseTo(198 - 12);
  });

  it('resets to a single point', () => {
    const t = new FollowerTrail();
    t.push(0, 0);
    t.push(50, 0);
    t.reset(300, 300);
    expect(t.positionAt(12)).toEqual({ x: 300, y: 300 });
    expect(t.length).toBe(0);
  });

  it('returns copies of its points', () => {
    const t = new FollowerTrail();
    t.push(1, 1);
    t.path[0].x = 99;
    t.positionAt(0)!.x = 99;
    expect(t.positionAt(0)).toEqual({ x: 1, y: 1 });
  });
});
