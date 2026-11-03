import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ getDocs: vi.fn(), getDoc: vi.fn(), getMeta: vi.fn(), hours: vi.fn(), annotate: vi.fn((ref: any) => ref) }));
vi.mock('./visitMemberStats', () => ({ readReadyCompletedMemberVisitHours: m.hours }));
vi.mock('i18next', () => ({ default: { t: (key: string) => key } }));
vi.mock('../../config/firebase', () => ({ db: {} }));
vi.mock('./firestore', () => ({ COLLECTIONS: {}, createOutboundOrder: vi.fn(), getCigarById: vi.fn() }));
vi.mock('@/services/firebase/monitoredFirestore', () => ({
  collection: (_db: any, name: string) => name, doc: (...parts: any[]) => parts,
  getDocs: m.getDocs, getDoc: m.getDoc, withMonitoringOperation: m.annotate,
  getDocFromServer: m.getMeta,
  query: (source: any, ...constraints: any[]) => ({ source, constraints }),
  where: (...args: any[]) => ['where', ...args], orderBy: (...args: any[]) => ['orderBy', ...args],
  limit: (n: number) => ['limit', n], startAfter: (cursor: any) => ['startAfter', cursor.id], documentId: () => '__name__',
  setDoc: vi.fn(), addDoc: vi.fn(), updateDoc: vi.fn(), Timestamp: {}, arrayUnion: vi.fn(),
  runTransaction: vi.fn(), FieldValue: {}, onSnapshot: vi.fn(),
}));
import { getVisitSessionsPage } from './visitSessions';
import { getAllRedemptionRecords, getRedemptionRecordsPage, getUserTotalVisitHoursInPeriod, getUserRedemptionLimits, canUserRedeem } from './redemption';
const scope = { allStores: false as const, storeId: 'store-a' };
const entry = (id: string, data: object = {}) => ({ id, data: () => data });

describe('bounded admin visit and redemption pages', () => {
  beforeEach(() => { vi.clearAllMocks(); m.getMeta.mockResolvedValue({ exists: () => true, data: () => ({ ready: true, schemaVersion: 1 }) }); vi.stubEnv('VITE_ADMIN_VISIT_PAGINATION_READY', 'true'); });
  it('requires server-verified migration readiness even when the build flag is enabled', async () => {
    m.getMeta.mockResolvedValueOnce({ exists: () => false });
    await expect(getVisitSessionsPage({ scope })).rejects.toThrow('MIGRATION_REQUIRED');
    expect(m.getDocs).not.toHaveBeenCalled();
  });
  it('blocks unmigrated reads and missing store assignments without querying', async () => {
    vi.stubEnv('VITE_ADMIN_VISIT_PAGINATION_READY', 'false');
    await expect(getVisitSessionsPage({ scope })).rejects.toThrow('MIGRATION_REQUIRED');
    await expect(getRedemptionRecordsPage({ scope })).rejects.toThrow('MIGRATION_REQUIRED');
    vi.stubEnv('VITE_ADMIN_VISIT_PAGINATION_READY', 'true');
    await expect(getVisitSessionsPage({ scope: { allStores: false, storeId: '' } })).rejects.toThrow('STORE_SCOPE_REQUIRED');
    await expect(getRedemptionRecordsPage({ scope: { allStores: false, storeId: '' } })).rejects.toThrow('STORE_SCOPE_REQUIRED');
    expect(m.getDocs).not.toHaveBeenCalled();
  });
  it('exhausts pending visits before history, with stable snapshot cursors and bounded lookahead', async () => {
    const pending = entry('p', { status: 'pending' });
    const completed = entry('c', { status: 'completed' });
    m.getDocs.mockResolvedValueOnce({ docs: [pending] }).mockResolvedValueOnce({ docs: [completed] });
    const first = await getVisitSessionsPage({ scope, pageSize: 1, userId: 'u' });
    expect(first.records.map(row => row.id)).toEqual(['p']);
    expect(first.next?.phase).toBe(1);
    m.getDocs.mockResolvedValueOnce({ docs: [completed] });
    const second = await getVisitSessionsPage({ scope, pageSize: 1, userId: 'u', cursor: first.next });
    expect(second.records.map(row => row.id)).toEqual(['c']);
    expect(second.next).toBeUndefined();
    for (const [query] of m.getDocs.mock.calls) {
      expect(query.constraints).toContainEqual(['where', 'storeId', '==', 'store-a']);
      expect(query.constraints).toContainEqual(['where', 'userId', '==', 'u']);
      expect(query.constraints).toContainEqual(['orderBy', '__name__', 'desc']);
      expect(query.constraints.some((c: any) => c[0] === 'limit' && c[1] <= 2)).toBe(true);
    }
    expect(m.annotate).toHaveBeenCalledWith(expect.anything(), 'visitSessions.historyPage');
  });
  it('advances tied visit timestamps using document snapshots and rejects changed scope', async () => {
    const a = entry('a', { status: 'pending', checkInAt: new Date(0) });
    m.getDocs.mockResolvedValueOnce({ docs: [a, entry('b')] });
    const first = await getVisitSessionsPage({ scope, pageSize: 1, status: 'pending' });
    m.getDocs.mockResolvedValueOnce({ docs: [] });
    await getVisitSessionsPage({ scope, pageSize: 1, status: 'pending', cursor: first.next });
    expect(m.getDocs.mock.calls.at(-1)?.[0].constraints).toContainEqual(['startAfter', 'a']);
    await expect(getVisitSessionsPage({ scope: { allStores: true }, pageSize: 1, status: 'pending', cursor: first.next })).rejects.toThrow('CURSOR_SCOPE_MISMATCH');
  });
  it('keeps grouped mixed-status documents intact and emits pending items only in the pending phase', async () => {
    const item = { id: 'pending', userId: 'u', quantity: 1, status: 'pending', redeemedAt: new Date(), createdAt: new Date() };
    m.getDocs.mockResolvedValueOnce({ docs: [entry('session', { redemptions: [item, { ...item, id: 'done', status: 'completed' }] })] });
    const first = await getRedemptionRecordsPage({ scope, pageSize: 1 });
    expect(first.records.map(row => row.id)).toEqual(['pending']);
    expect(first.records[0].visitSessionId).toBe('session');
    expect(first.next?.phase).toBe(1);
    m.getDocs.mockResolvedValueOnce({ docs: [entry('session', { redemptions: [item, { ...item, id: 'done', status: 'completed' }] })] });
    const second = await getRedemptionRecordsPage({ scope, pageSize: 1, cursor: first.next });
    expect(second.records.map(row => row.id)).toEqual(['done']);
    expect(m.getDoc).not.toHaveBeenCalled();
    expect(m.getDocs.mock.calls.every(([query]) => query.source !== 'visitSessions')).toBe(true);
  });
  it('retains referral milestone rewards and bounded empty-page navigation', async () => {
    m.getDocs.mockResolvedValueOnce({ docs: [entry('no-rewards'), entry('reward-user')] });
    const first = await getRedemptionRecordsPage({ scope, type: 'referral_reward', pageSize: 1 });
    expect(first.records).toEqual([]);
    expect(first.next).toBeTruthy();
    m.getDocs.mockResolvedValueOnce({ docs: [entry('reward-user', { referral: { redeemedMilestones: [3, 5] }, updatedAt: new Date() })] });
    const second = await getRedemptionRecordsPage({ scope, type: 'referral_reward', pageSize: 1, cursor: first.next });
    expect(second.records).toHaveLength(2);
    expect(second.records.every(row => row.type === 'referral_reward')).toBe(true);
    expect(m.getDocs.mock.calls[0][0].source).toBe('users');
    expect(m.annotate).toHaveBeenCalledWith(expect.anything(), 'redemptions.byStore');
  });
  it('removes the store-wide session join from the report compatibility API', async () => {
    m.getDocs.mockResolvedValue({ docs: [] });
    await expect(getAllRedemptionRecords('store-a')).resolves.toEqual([]);
    expect(m.getDocs).toHaveBeenCalledTimes(2);
    expect(m.getDocs.mock.calls.map(([query]) => query.source)).toEqual(['redemptionRecords', 'users']);
    for (const [query] of m.getDocs.mock.calls) expect(query.constraints).toContainEqual(['where', 'storeId', '==', 'store-a']);
  });
  it('propagates missing-index failures instead of falling back to an unbounded query', async () => {
    m.getDocs.mockRejectedValue(new Error('index required'));
    await expect(getVisitSessionsPage({ scope })).rejects.toThrow('index required');
    await expect(getRedemptionRecordsPage({ scope })).rejects.toThrow('index required');
    expect(m.getDocs).toHaveBeenCalledTimes(2);
  });
  it('uses authoritative completed-member hours and keeps milestone arithmetic', async () => {
    m.hours.mockResolvedValue(120);
    m.getDoc.mockResolvedValue({ exists: () => false });
    await expect(getUserTotalVisitHoursInPeriod('member')).resolves.toBe(120);
    await expect(getUserRedemptionLimits('member')).resolves.toEqual({ dailyLimit: 3, totalLimit: 75, hourlyLimit: undefined });
    expect(m.hours).toHaveBeenCalledWith('member');
    expect(m.getDocs).not.toHaveBeenCalled();
  });
  it('propagates stats readiness errors and denies actual eligibility with a localized reason', async () => {
    const failure = new Error('VISIT_STATS_NOT_READY');
    m.hours.mockRejectedValue(failure);
    m.getDoc.mockResolvedValue({ exists: () => false });
    await expect(getUserTotalVisitHoursInPeriod('member')).rejects.toBe(failure);
    await expect(getUserRedemptionLimits('member')).rejects.toBe(failure);
    m.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ status: 'active' }) })
      .mockResolvedValue({ exists: () => false });
    m.getDocs.mockResolvedValueOnce({ empty: false, docs: [entry('visit', { status: 'pending', userId: 'member' })] });
    await expect(canUserRedeem('member', 1)).resolves.toEqual({ canRedeem: false, reason: 'visitTimer.redemptionStatsUnavailable' });
  });
});
