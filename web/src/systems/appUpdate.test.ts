import { describe, expect, it, vi } from 'vitest';
import { appUpdateReady, applyAppUpdate, onAppUpdate, setAppUpdate } from './appUpdate';

describe('app updates', () => {
  it('waits for a new version, notifies once and applies on request', () => {
    const heard = vi.fn();
    onAppUpdate(heard);
    expect(appUpdateReady()).toBe(false);
    const reload = vi.fn();
    setAppUpdate(reload);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(appUpdateReady()).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    applyAppUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
