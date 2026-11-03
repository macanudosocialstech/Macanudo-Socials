import { describe, expect, it } from 'vitest';
import { getReloadDisplayStatus, reloadStatusQuery } from './reloadStatus';
import en from '../i18n/locales/en-US.json';
import zh from '../i18n/locales/zh-CN.json';

describe('user withdrawal display', () => {
  it.each([{}, { membershipOrderId: 'initial-order', paymentPurpose: 'initial_package' },
    { membershipOrderId: 'annual-order', paymentPurpose: 'annual_pass' }])('distinguishes user cancellation from rejection (%j)', metadata => {
    const record = { ...metadata, status: 'rejected' as const, reviewAction: 'cancel' as const };
    expect(getReloadDisplayStatus(record)).toBe('withdrawn');
    expect(getReloadDisplayStatus({ status: 'rejected', reviewAction: 'reject' })).toBe('rejected');
  });
  it('does not guess cancellation for ambiguous legacy rejections', () => {
    expect(getReloadDisplayStatus({ status: 'rejected' })).toBe('rejected');
  });
  it.each(['pending', 'completed'] as const)('preserves %s even with stale audit metadata', status => {
    expect(getReloadDisplayStatus({ status, reviewAction: 'cancel' })).toBe(status);
  });
  it('queries the persisted rejection bucket for withdrawals without adding a database status', () => {
    expect(reloadStatusQuery('withdrawn')).toBe('rejected');
    expect(reloadStatusQuery('rejected')).toBe('rejected');
    expect(reloadStatusQuery('all')).toBeUndefined();
    expect(reloadStatusQuery('pending')).toBe('pending');
  });
  it('uses the requested English wording and provides the Chinese translation', () => {
    expect(en.pointsConfig.reloadVerification.statusWithdrawed).toBe('Withdrawed');
    expect(zh.pointsConfig.reloadVerification.statusWithdrawed).toBe('已撤回');
  });
});
