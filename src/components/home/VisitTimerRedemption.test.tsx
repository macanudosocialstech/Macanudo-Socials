import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  user: { id: 'user', status: 'active', membership: { points: 1000 } } as any,
  session: null as any, sessionListener: null as any, daily: vi.fn(), navigate: vi.fn(),
  pending: { request: null, loading: false, error: null, retry: vi.fn() } as any,
  visitStats: { status: 'ready', completedHours: 50 } as any, visitStatsListener: null as any,
  history: vi.fn(), legacyLimits: vi.fn(), getSession: vi.fn(), deduct: vi.fn(), total: vi.fn(), redemptionListener: null as any,
}));
vi.mock('antd', () => {
  const Box = ({ children }: any) => <div>{children}</div>;
  return { Card: Box, Typography: { Title: Box, Text: Box }, Space: Box, Image: Box,
    App: { useApp: () => ({ modal: {}, message: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }) },
    Modal: ({ open, children }: any) => open ? <div>{children}</div> : null,
    List: Object.assign(Box, { Item: Box }), Tag: Box, Row: Box, Col: Box, Select: Box, Alert: Box,
    Button: Box, Spin: Box };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@ant-design/icons', () => {
  const Icon = () => <span aria-hidden="true" />;
  return { ClockCircleOutlined: Icon, GiftOutlined: Icon, PictureOutlined: Icon, ShoppingCartOutlined: Icon,
    ReloadOutlined: Icon, WalletOutlined: Icon, LoadingOutlined: Icon };
});
vi.mock('react-router-dom', () => ({ useNavigate: () => m.navigate }));
vi.mock('../../store/modules/auth', () => ({ useAuthStore: Object.assign(
  () => ({ user: m.user, setUser: vi.fn() }), { getState: () => ({ user: m.user }) }) }));
vi.mock('../../hooks/usePendingPayments', () => ({ usePendingPayments: () => m.pending }));
vi.mock('../../services/firebase/redemptionStats', () => ({ subscribeToRedemptionStats: (userId: string, callback: any) => {
  callback({ userId, status: 'ready', completedQuantity: 12, pendingQuantity: 2 }); return () => {};
} }));
vi.mock('../../services/firebase/visitSessions', () => ({
  getPendingVisitSession: m.getSession, getUserVisitSessions: m.history, processSessionRealtimeDeduction: m.deduct,
  subscribeToVisitSession: (_id: string, callback: any) => { m.sessionListener = callback; return () => {}; },
}));
vi.mock('../../services/firebase/redemption', () => ({
  getUserRedemptionLimits: m.legacyLimits,
  getDailyRedemptions: m.daily, getTotalRedemptions: m.total, getHourlyRedemptions: async () => [],
  getRedemptionConfig: async () => ({ cutoffTime: '23:59' }), canUserRedeem: vi.fn(), createRedemptionRecord: vi.fn(),
  subscribeToRedemptionRecordsBySession: (_id: string, listener: any) => {
    m.redemptionListener = listener; listener([]); return () => {};
  },
}));
vi.mock('../../services/firebase/visitMemberStats', () => ({ subscribeToVisitMemberStats: (userId: string, callback: any) => {
  m.visitStatsListener = callback; callback({ userId, ...m.visitStats }); return () => {};
} }));
vi.mock('../../services/firebase/membershipFee', () => ({ getCurrentAnnualFeeAmount: async () => 199, getUserMembershipPeriod: vi.fn() }));
vi.mock('../../services/membershipActivation', () => ({ activateMembership: vi.fn(), createMembershipPayment: vi.fn(), getMembershipPaymentQuote: vi.fn() }));
vi.mock('../../services/firebase/auth', () => ({ getUserData: vi.fn() }));
vi.mock('../../services/firebase/appConfig', () => ({ getAppConfig: async () => null }));
vi.mock('../../services/firebase/pointsConfig', () => ({ getPointsConfig: async () => ({}) }));
vi.mock('../common/StoreSelect', () => ({ default: () => null }));
vi.mock('../../config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), onSnapshot: () => () => {} }));
import { VisitTimerRedemption } from './VisitTimerRedemption';

describe('visit entry button', () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear(); m.session = null; m.sessionListener = null;
    m.user = { id: 'user', status: 'active', membership: { points: 1000 } };
    m.daily.mockResolvedValue([]);
    m.getSession.mockImplementation(async () => m.session);
    m.visitStats = { status: 'ready', completedHours: 50 };
    m.deduct.mockResolvedValue(undefined);
    m.total.mockResolvedValue([]);
    m.pending = { request: null, loading: false, error: null, retry: vi.fn() };
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  const checkedIn = () => ({ id: 'session', userId: 'user', status: 'pending', checkInAt: new Date(), storeId: 'store' });
  it('shows Reload outside a visit even when the daily quota is exhausted', async () => {
    m.daily.mockResolvedValue([{ quantity: 3 }]);
    render(<VisitTimerRedemption />);
    const button = await screen.findByRole('button', { name: 'visitTimer.reload' });
    await waitFor(() => expect(m.daily).toHaveBeenCalled());
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(m.navigate).toHaveBeenCalledWith('/reload');
    expect(screen.queryByRole('button', { name: 'visitTimer.noQuota' })).toBeNull();
  });
  it('shows Redeem during a visit at low balance and returns to Reload on checkout', async () => {
    m.user.membership.points = 10; m.session = checkedIn();
    render(<VisitTimerRedemption />);
    const button = await screen.findByRole('button', { name: 'visitTimer.redeem' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('button', { name: 'visitTimer.reload' })).toBeNull();
    act(() => m.sessionListener({ ...m.session, status: 'completed', checkOutAt: new Date() }));
    expect(screen.getByRole('button', { name: 'visitTimer.reload' })).toBeTruthy();
  });
  it('keeps checkout shortfalls on the Reload path', async () => {
    m.session = { ...checkedIn(), checkoutPending: { status: 'awaiting_reload', pointsDueNow: 1100 } };
    render(<VisitTimerRedemption />);
    await screen.findByRole('button', { name: 'visitTimer.reload' });
    await waitFor(() => expect(m.navigate).toHaveBeenCalledWith('/reload'));
  });
  it('preserves daily quota restrictions after check-in', async () => {
    m.session = checkedIn(); m.daily.mockResolvedValue([{ quantity: 3 }]);
    render(<VisitTimerRedemption />);
    const button = await screen.findByRole('button', { name: 'visitTimer.noQuota' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
  it('allows retry after a failed redemption query instead of treating it as zero usage', async () => {
    m.session = checkedIn(); m.daily.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
    render(<VisitTimerRedemption />);
    fireEvent.click(await screen.findByRole('button', { name: 'common.retry' }));
    await screen.findByRole('button', { name: 'visitTimer.redeem' });
  });
  it('keeps member activation and pending payments ahead of visit actions', async () => {
    m.user.status = 'inactive'; m.pending.request = { kind: 'manual_membership' };
    render(<VisitTimerRedemption />);
    fireEvent.click(await screen.findByRole('button', { name: 'annualPassPayment.viewManualRequest' }));
    expect(m.navigate).toHaveBeenCalledWith('/reload');
  });
  it('does not let a Day Pass bypass account suspension', async () => {
    m.user.status = 'suspended'; m.session = { ...checkedIn(), dayPass: { isPurchased: true, config: { cigarAllowance: 1 } } };
    render(<VisitTimerRedemption />);
    const button = await screen.findByRole('button', { name: 'annualPassPayment.suspended' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
  it('preserves the Day Pass redemption restriction after check-in', async () => {
    m.session = { ...checkedIn(), dayPass: { isPurchased: true, config: { cigarAllowance: 1 } } };
    render(<VisitTimerRedemption />);
    const button = await screen.findByRole('button', { name: 'visitTimer.redeem' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
  it('does not use a completed historical visit as a current check-in', async () => {
    m.session = { ...checkedIn(), status: 'completed', checkOutAt: new Date() };
    render(<VisitTimerRedemption />);
    expect(await screen.findByRole('button', { name: 'visitTimer.reload' })).toBeTruthy();
  });
  it('shows the subscribed occupied quantity without waiting for history calculations', async () => {
    m.daily.mockImplementation(() => new Promise(() => {}));
    render(<VisitTimerRedemption />);
    expect(await screen.findByText('14')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'visitTimer.reload' })).toBeTruthy();
  });
  it('derives milestone limits from summary hours without direct or indirect history scans', async () => {
    render(<VisitTimerRedemption />);
    await waitFor(() => expect(m.daily).toHaveBeenCalledTimes(1));
    expect(m.history).not.toHaveBeenCalled(); expect(m.legacyLimits).not.toHaveBeenCalled();
    expect(await screen.findByText('/ 50 visitTimer.cigars')).toBeTruthy();
  });
  it('shows unavailable hours and blocks redemption until the projection is ready', async () => {
    m.session = checkedIn(); m.visitStats = { status: 'initializing', completedHours: null };
    render(<VisitTimerRedemption />);
    await screen.findByRole('button', { name: 'common.retry' });
    expect(m.daily).not.toHaveBeenCalled(); expect(m.history).not.toHaveBeenCalled();
    expect(screen.queryByText('0')).toBeNull();
    act(() => m.visitStatsListener({ userId: 'user', status: 'ready', completedHours: 50 }));
    await screen.findByRole('button', { name: 'visitTimer.redeem' });
  });
  it('does not re-read visits when unrelated user fields change and still performs due deductions', async () => {
    m.session = { ...checkedIn(), realtimeDeductionsEnabled: true, nextDeductionAt: new Date(Date.now() - 1000) };
    const view = render(<VisitTimerRedemption />);
    await waitFor(() => expect(m.deduct).toHaveBeenCalledTimes(1));
    m.user = { ...m.user, membership: { points: 200 } }; view.rerender(<VisitTimerRedemption />);
    expect(m.getSession).toHaveBeenCalledTimes(1);
  });
  it('reuses cooldown history on minute ticks and invalidates on session changes and visibility resume', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T03:10:00Z'));
    m.session = checkedIn();
    await act(async () => { render(<VisitTimerRedemption />); });
    expect(m.total).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(m.total).toHaveBeenCalledTimes(1);
    expect(m.daily).toHaveBeenCalledTimes(1);
    await act(async () => { m.redemptionListener([]); });
    expect(m.total).toHaveBeenCalledTimes(2);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(m.total).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(3600000); });
    expect(m.total).toHaveBeenCalledTimes(4);
  });
});
