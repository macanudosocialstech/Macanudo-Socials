import { afterEach, describe, expect, it, vi } from 'vitest';
import { startVisiblePolling } from './visiblePolling';

describe('visible serial polling', () => {
  afterEach(() => vi.useRealTimers());
  it('suspends hidden ticks, resumes immediately, deduplicates slow work and removes listeners', async () => {
    vi.useFakeTimers();
    const surface = new EventTarget() as EventTarget & { hidden: boolean };
    surface.hidden = true;
    let finish!: () => void;
    const task = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const stop = startVisiblePolling(task, 10000, surface);
    await vi.advanceTimersByTimeAsync(30000);
    expect(task).not.toHaveBeenCalled();
    surface.hidden = false;
    surface.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(30000);
    expect(task).toHaveBeenCalledTimes(1);
    finish(); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10000);
    expect(task).toHaveBeenCalledTimes(2);
    stop(); finish();
    surface.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(30000);
    expect(task).toHaveBeenCalledTimes(2);
  });
  it('continues after a failed tick', async () => {
    vi.useFakeTimers();
    const surface = Object.assign(new EventTarget(), { hidden: false });
    const task = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const stop = startVisiblePolling(task, 10000, surface);
    await vi.advanceTimersByTimeAsync(10000);
    expect(task).toHaveBeenCalledTimes(2);
    stop();
  });
});
