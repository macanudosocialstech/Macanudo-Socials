import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ listeners: new Map<string, any>(), stop: vi.fn(), read: vi.fn(), history: vi.fn(), tags: vi.fn() }));
vi.mock('../../config/firebase', () => ({ db: {} }));
vi.mock('./monitoredFirestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
  collection: (_db: unknown, id: string) => ({ path: id }), query: (ref: object) => ref, where: vi.fn(),
  withMonitoringOperation: (ref: any, tag: string) => { m.tags(tag); return ref; },
  getDocFromServer: m.read, getDocsFromServer: m.history,
  onSnapshot: (ref: any, _options: unknown, next: any, error: any) => {
    m.listeners.set(ref.path, { next, error }); return m.stop;
  },
}));
import { readCompletedMemberVisitHours, readReadyCompletedMemberVisitHours, subscribeToVisitMemberStats } from './visitMemberStats';
const snapshot = (value?: object, cache = false) => ({ exists: () => value !== undefined, data: () => value, metadata: { fromCache: cache } });
const meta = () => m.listeners.get('_visitMemberStatsMeta/default');
const stats = () => m.listeners.get('_visitMemberStats/member');

describe('trusted member visit projection reads', () => {
  beforeEach(() => { m.listeners.clear(); vi.clearAllMocks(); m.read.mockReset(); });
  it('never interprets missing, cached, unready or corrupt summaries as zero', () => {
    const next = vi.fn(); subscribeToVisitMemberStats('member', next);
    meta().next(snapshot({ ready: true, version: 1 }, true));
    stats().next(snapshot());
    expect(next.mock.lastCall?.[0].status).not.toBe('ready');
    meta().next(snapshot({ ready: true, version: 1 }));
    expect(next.mock.lastCall?.[0].completedHours).toBeNull();
    stats().next(snapshot({ userId: 'member', version: 1, completedHours: 0 }, true));
    expect(next.mock.lastCall?.[0].status).not.toBe('ready');
    stats().next(snapshot({ userId: 'member', version: 1, completedHours: 0 }));
    expect(next.mock.lastCall?.[0]).toEqual({ userId: 'member', status: 'ready', completedHours: 0 });
    stats().next(snapshot({ userId: 'member', version: 1, completedHours: -1 }));
    expect(next.mock.lastCall?.[0].status).toBe('error');
    expect(m.tags).toHaveBeenCalledWith('home.memberStats');
  });
  it('ignores late listener callbacks after unmount or account changes', () => {
    const next = vi.fn(); const stop = subscribeToVisitMemberStats('member', next);
    stop(); next.mockClear(); meta().next(snapshot({ ready: true, version: 1 }));
    expect(next).not.toHaveBeenCalled(); expect(m.stop).toHaveBeenCalledTimes(2);
  });
  it('fails eligibility closed for missing/unready stats and readiness changes during reads', async () => {
    m.read.mockResolvedValueOnce(snapshot({ ready: false, version: 1 }));
    await expect(readReadyCompletedMemberVisitHours('member')).rejects.toThrow('VISIT_STATS_NOT_READY');
    m.read.mockResolvedValueOnce(snapshot({ ready: true, version: 1, runId: 'a' })).mockResolvedValueOnce(snapshot());
    await expect(readReadyCompletedMemberVisitHours('member')).rejects.toThrow('VISIT_STATS_NOT_READY');
    m.read.mockResolvedValueOnce(snapshot({ ready: true, version: 1, runId: 'a' }))
      .mockResolvedValueOnce(snapshot({ userId: 'member', version: 1, completedHours: 50 }))
      .mockResolvedValueOnce(snapshot({ ready: true, version: 1, runId: 'b' }));
    await expect(readReadyCompletedMemberVisitHours('member')).rejects.toThrow('VISIT_STATS_NOT_READY');
  });
  it('uses constant document reads for ready eligibility and propagates failures', async () => {
    const gate = snapshot({ ready: true, version: 1, runId: 'a' });
    m.read.mockResolvedValueOnce(gate).mockResolvedValueOnce(snapshot({ userId: 'member', version: 1, completedHours: 50 })).mockResolvedValueOnce(gate);
    await expect(readReadyCompletedMemberVisitHours('member')).resolves.toBe(50);
    expect(m.history).not.toHaveBeenCalled();
    m.read.mockRejectedValueOnce(new Error('denied'));
    await expect(readReadyCompletedMemberVisitHours('member')).rejects.toThrow('denied');
  });
  it('offers an explicit strict history read without swallowing failures', async () => {
    m.history.mockRejectedValueOnce(new Error('offline'));
    await expect(readCompletedMemberVisitHours('member')).rejects.toThrow('offline');
    m.history.mockResolvedValueOnce({ docs: [] });
    await expect(readCompletedMemberVisitHours('member')).resolves.toBe(0);
  });
});
