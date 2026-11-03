import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from 'antd';
import type { ReloadRecord } from '../../types';

const mocks = vi.hoisted(() => ({ records: vi.fn(), mobile: false }));
vi.mock('../../services/firebase/reload', () => ({ getAllReloadRecords: mocks.records,
  verifyReloadRecord: vi.fn(), rejectReloadRecord: vi.fn(), createReloadRecord: vi.fn() }));
vi.mock('../../services/firebase/stores', () => ({ getAllStores: async () => [] }));
vi.mock('../../services/firebase/firestore', () => ({ getAllUsers: async () => [], getDocument: async () => null }));
vi.mock('../../services/cloudinary/create', () => ({ uploadFile: vi.fn() }));
vi.mock('../../store/modules', () => ({ useAuthStore: (select?: (state: any) => any) => {
  const state = { user: { id: 'operator' }, actualUser: null, isSuperAdmin: false };
  return select ? select(state) : state;
} }));
vi.mock('../common/StoreSelect', () => ({ default: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en-US' },
  t: (key: string) => key.endsWith('.statusWithdrawed') ? 'Withdrawed' : key.endsWith('.statusRejected') ? 'Rejected' : key }) }));
import { ReloadVerification } from './ReloadVerification';

const base = { requestedAmount: 200, pointsEquivalent: 200, createdAt: new Date('2026-10-20'),
  updatedAt: new Date('2026-10-20'), status: 'rejected' as const };
const records: ReloadRecord[] = [
  { ...base, id: 'reload', userId: 'one', userName: 'Withdrawn Reload', reviewAction: 'cancel' },
  { ...base, id: 'membership', userId: 'two', userName: 'Withdrawn Membership', membershipOrderId: 'order', paymentPurpose: 'initial_package', reviewAction: 'cancel' },
  { ...base, id: 'rejected', userId: 'three', userName: 'Rejected Request', reviewAction: 'reject' },
];
beforeEach(() => {
  mocks.mobile = false;
  mocks.records.mockResolvedValue(records);
  window.matchMedia = vi.fn().mockImplementation(query => ({ matches: mocks.mobile && query === '(max-width: 768px)',
    media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('reload and membership withdrawal labels', () => {
  it('separates desktop status from reviewer and shows review tools only for pending requests', async () => {
    mocks.records.mockResolvedValue([
      { ...base, id: 'pending', userId: 'pending-member', userName: 'Desktop Pending', status: 'pending',
        membershipOrderId: 'package', paymentPurpose: 'initial_package', walletAmount: 100, annualFeeAmount: 199 },
      { ...records[0], verifiedByName: 'Request Owner' },
    ]);
    render(<App><ReloadVerification /></App>);
    await screen.findByText('Desktop Pending');
    expect(screen.getByRole('columnheader', { name: 'common.status' })).toBeTruthy();
    const reviewerCell = screen.getByText('Request Owner').closest('td')!;
    expect(within(reviewerCell).queryByText('Withdrawed')).toBeNull();
    const pendingRow = screen.getByText('Desktop Pending').closest('tr')!;
    const withdrawnRow = screen.getByText('Withdrawn Reload').closest('tr')!;
    expect(within(withdrawnRow).queryByRole('button', { name: 'pointsConfig.reloadVerification.verify' })).toBeNull();
    expect(within(withdrawnRow).queryByRole('button', { name: 'pointsConfig.reloadVerification.reject' })).toBeNull();
    fireEvent.click(within(pendingRow).getByRole('button', { name: 'pointsConfig.reloadVerification.verify' }));
    expect(await screen.findByText('pointsConfig.reloadVerification.verifyModalTitle')).toBeTruthy();
  }, 20000);
  it('keeps mobile package details, notes, status and review actions in separate rows', async () => {
    mocks.mobile = true;
    mocks.records.mockResolvedValue([{ ...base, id: 'pending', userId: 'member', userName: 'A Long Member Name For Mobile Review',
      status: 'pending', membershipOrderId: 'package', paymentPurpose: 'initial_package', requestedAmount: 299,
      walletAmount: 100, annualFeeAmount: 199, adminNotes: 'A complete note that should remain readable without truncation.' }]);
    render(<App><ReloadVerification /></App>);
    const name = await screen.findByText('A Long Member Name For Mobile Review');
    const card = name.closest('.reload-verification-mobile-card')! as HTMLElement;
    expect(within(card).getByText('RM 100')).toBeTruthy();
    expect(within(card).getByText('RM 199')).toBeTruthy();
    expect(within(card).getByText('A complete note that should remain readable without truncation.')).toBeTruthy();
    expect(within(card).getByText('pointsConfig.reloadVerification.statusPending').closest('.reload-verification-mobile-summary')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: /pointsConfig\.reloadVerification\.verify$/ }));
    expect(await screen.findByText('pointsConfig.reloadVerification.verifyModalTitle')).toBeTruthy();
  }, 20000);
  it.each([false, true])('shows Withdrawed separately from Rejected (mobile=%s)', async mobile => {
    mocks.mobile = mobile;
    render(<App><ReloadVerification /></App>);
    await waitFor(() => expect(screen.getAllByText('Withdrawed')).toHaveLength(2));
    expect(screen.getAllByText('Rejected')).toHaveLength(1);
    expect(screen.getByText('Withdrawn Reload')).toBeTruthy();
    expect(screen.getByText('Withdrawn Membership')).toBeTruthy();
  }, 20000);
  it('filters withdrawals without mixing in operator rejections', async () => {
    render(<App><ReloadVerification /></App>);
    await screen.findByText('Withdrawn Reload');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'common.status' }));
    fireEvent.click((await screen.findAllByText('Withdrawed')).at(-1)!);
    await waitFor(() => expect(mocks.records).toHaveBeenLastCalledWith('rejected'));
    await waitFor(() => expect(screen.queryByText('Rejected Request')).toBeNull());
    expect(screen.getByText('Withdrawn Reload')).toBeTruthy();
    expect(screen.getByText('Withdrawn Membership')).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'common.status' }));
    fireEvent.click((await screen.findAllByText('Rejected')).at(-1)!);
    await screen.findByText('Rejected Request');
    expect(screen.queryByText('Withdrawn Reload')).toBeNull();
    expect(screen.queryByText('Withdrawn Membership')).toBeNull();
  }, 20000);
});
