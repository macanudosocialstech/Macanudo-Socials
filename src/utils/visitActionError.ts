import type { TFunction } from 'i18next';

const loungeCodes = [
  'backend-unavailable', 'auth-required', 'service-unavailable', 'invalid-hours',
  'invalid-request', 'forbidden', 'not-ready', 'not-enabled', 'outside-hours',
  'already-checked-in', 'membership-inactive', 'insufficient-checkin',
  'lounge-unavailable', 'session-not-found', 'member-not-found', 'active-visits',
  'channel-unverified', 'busy', 'before-closing',
] as const;

const legacyReasons: Array<[RegExp, string]> = [
  [/Firestore索引|index.*required/i, 'scanner.systemConfigurationError'],
  [/用户不存在|member.*not found/i, 'scanner.memberNotFound'],
  [/驻店记录不存在|visit.*not found/i, 'scanner.visitNotFound'],
  [/会员状态|开通会员|membership.*inactive/i, 'scanner.membershipRequired'],
  [/已有未完成|active visit already exists/i, 'scanner.activeVisitAlreadyExists'],
  [/积分不足|insufficient points/i, 'scanner.insufficientPoints'],
  [/已完成|已过期|already completed|expired/i, 'scanner.visitAlreadyClosed'],
  [/原会所|原门店|original lounge|original store/i, 'scanner.visitStoreRestricted'],
  [/雪茄不存在|兑换|库存|redemption|inventory/i, 'scanner.visitSettlementFailed'],
];

export function visitActionError(error: unknown, t: TFunction, errorCode?: string): string {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  const rawCode = errorCode || (error && typeof error === 'object' && 'code' in error ? String(error.code) : '');
  const code = rawCode.replace(/^(firestore|auth)\//, '');
  if (['permission-denied', 'unauthorized'].includes(code)) return String(t('scanner.permissionDenied'));
  if (['unauthenticated', 'user-token-expired', 'id-token-expired'].includes(code)) return String(t('loungeOperations.errors.auth-required'));
  if (['unavailable', 'network-request-failed', 'deadline-exceeded'].includes(code)) return String(t('scanner.connectionFailed'));
  if (code === 'resource-exhausted') return String(t('scanner.serviceBusy'));
  if (code === 'failed-precondition' || code === 'aborted') return String(t(code === 'aborted' ? 'scanner.serviceBusy' : 'scanner.systemConfigurationError'));

  // Only preserve known UI messages, never arbitrary SDK errors, URLs or tokens.
  for (const reason of loungeCodes) {
    const key = `loungeOperations.errors.${reason}`;
    const translated = String(t(key));
    if (code === reason || (translated !== key && message === translated)) return translated;
  }
  for (const key of ['scanner.permissionDenied', 'scanner.connectionFailed', 'scanner.serviceBusy',
    'scanner.failureUnknown', ...legacyReasons.map(([, key]) => key)]) {
    if (message === String(t(key))) return message;
  }
  for (const [pattern, key] of legacyReasons) if (pattern.test(message)) return String(t(key));
  return String(t('scanner.failureUnknown'));
}
