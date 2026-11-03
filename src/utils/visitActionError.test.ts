import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '../i18n/locales/en-US.json';
import zh from '../i18n/locales/zh-CN.json';
import { visitActionError } from './visitActionError';

describe.each(['en-US', 'zh-CN'])('visit failure reasons (%s)', language => {
  async function translator() {
    const instance = createInstance();
    await instance.init({ lng: language, fallbackLng: false,
      resources: { 'en-US': { translation: en }, 'zh-CN': { translation: zh } } });
    return instance.t.bind(instance);
  }

  it.each(['outside-hours', 'not-ready', 'not-enabled', 'forbidden', 'already-checked-in',
    'membership-inactive', 'insufficient-checkin', 'backend-unavailable', 'auth-required', 'service-unavailable'])(
    'keeps the localized backend reason: %s', async code => {
      const t = await translator();
      const reason = String(t(`loungeOperations.errors.${code}`));
      expect(reason).not.toBe(`loungeOperations.errors.${code}`);
      expect(visitActionError(reason, t)).toBe(reason);
      expect(visitActionError(new Error(reason), t)).toBe(reason);
      expect(visitActionError(undefined, t, code)).toBe(reason);
    });

  it.each([
    ['permission-denied', 'scanner.permissionDenied'],
    ['firestore/permission-denied', 'scanner.permissionDenied'],
    ['auth/user-token-expired', 'loungeOperations.errors.auth-required'],
    ['unavailable', 'scanner.connectionFailed'],
    ['resource-exhausted', 'scanner.serviceBusy'],
    ['failed-precondition', 'scanner.systemConfigurationError'],
  ])('translates structured SDK errors: %s', async (code, key) => {
    const t = await translator();
    expect(visitActionError(Object.assign(new Error('internal diagnostics'), { code }), t)).toBe(t(key));
  });

  it('retains legacy business reasons and never displays unrecognized diagnostics', async () => {
    const t = await translator();
    expect(visitActionError('\u7b7e\u5230\u5931\u8d25\uff1a\u7528\u6237\u5df2\u6709\u672a\u5b8c\u6210\u7684\u9a7b\u5e97\u8bb0\u5f55', t))
      .toBe(t('scanner.activeVisitAlreadyExists'));
    expect(visitActionError('Internal error https://private.example?token=secret', t)).toBe(t('scanner.failureUnknown'));
    expect(visitActionError(undefined, t)).toBe(t('scanner.failureUnknown'));
  });
});
