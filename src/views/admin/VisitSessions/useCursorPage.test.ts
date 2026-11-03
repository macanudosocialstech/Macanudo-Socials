import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCursorPage } from './useCursorPage';
afterEach(cleanup);

describe('admin cursor page lifecycle', () => {
  it('loads lazily, caches previous pages and awaits refresh', async () => {
    const fetch = vi.fn(async (cursor?: string) => ({ records: [cursor || 'first'], next: cursor ? undefined : 'second' }));
    const { result, rerender } = renderHook(({ active }) => useCursorPage(fetch, 'store-a', active), { initialProps: { active: false } });
    expect(fetch).not.toHaveBeenCalled();
    rerender({ active: true });
    await waitFor(() => expect(result.current.records).toEqual(['first']));
    act(() => result.current.next());
    await waitFor(() => expect(result.current.records).toEqual(['second']));
    act(() => result.current.previous());
    await waitFor(() => expect(result.current.records).toEqual(['first']));
    expect(fetch).toHaveBeenCalledTimes(2);
    let completion!: Promise<void>;
    act(() => { completion = result.current.refresh(); });
    await act(async () => { await completion; });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.current.page).toBe(1);
  });
  it('discards a late response after permission scope changes', async () => {
    let resolveOld!: (page: { records: string[] }) => void;
    const pending = new Promise<{ records: string[] }>(resolve => { resolveOld = resolve; });
    const { result, rerender } = renderHook(({ scope }) => useCursorPage(() => scope === 'old' ? pending : Promise.resolve({ records: ['new'] }), scope), { initialProps: { scope: 'old' } });
    rerender({ scope: 'new' });
    await waitFor(() => expect(result.current.records).toEqual(['new']));
    await act(async () => { resolveOld({ records: ['private-old'] }); });
    expect(result.current.records).toEqual(['new']);
    expect(result.current.page).toBe(1);
  });
});
