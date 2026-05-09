import { describe, it, expect } from 'vitest';

import {
  DEFAULT_LICENSE_EXPIRY_WARNING_DAYS,
  LICENSE_EXPIRY_WARNING_DAYS_MIN,
  LICENSE_EXPIRY_WARNING_DAYS_MAX,
  emptyNotificationSettingsInput,
  sanitizeNotificationSettingsInput,
  validateNotificationSettingsInput,
  isNotificationSettingsInputValid,
} from '@/domain/notificationSettings.js';

describe('notificationSettings — constants', () => {
  it('default = 30, min = 1, max = 365', () => {
    expect(DEFAULT_LICENSE_EXPIRY_WARNING_DAYS).toBe(30);
    expect(LICENSE_EXPIRY_WARNING_DAYS_MIN).toBe(1);
    expect(LICENSE_EXPIRY_WARNING_DAYS_MAX).toBe(365);
  });
});

describe('notificationSettings — emptyNotificationSettingsInput', () => {
  it('returns the default', () => {
    expect(emptyNotificationSettingsInput()).toEqual({
      licenseExpiryWarningDays: 30,
    });
  });
});

describe('notificationSettings — sanitizeNotificationSettingsInput', () => {
  it('coerces strings to integers', () => {
    expect(sanitizeNotificationSettingsInput({ licenseExpiryWarningDays: '45' })).toEqual({
      licenseExpiryWarningDays: 45,
    });
  });

  it('falls back to default for non-numeric values', () => {
    expect(
      sanitizeNotificationSettingsInput({ licenseExpiryWarningDays: 'abc' })
    ).toEqual({ licenseExpiryWarningDays: 30 });
  });

  it('floors fractional input', () => {
    expect(sanitizeNotificationSettingsInput({ licenseExpiryWarningDays: 30.7 })).toEqual({
      licenseExpiryWarningDays: 30,
    });
  });
});

describe('notificationSettings — validateNotificationSettingsInput', () => {
  it('rejects values < 1', () => {
    expect(validateNotificationSettingsInput({ licenseExpiryWarningDays: 0 })).toEqual({
      licenseExpiryWarningDays: 'errorRange',
    });
  });

  it('rejects values > 365', () => {
    expect(validateNotificationSettingsInput({ licenseExpiryWarningDays: 400 })).toEqual({
      licenseExpiryWarningDays: 'errorRange',
    });
  });

  it('accepts boundary values 1 and 365', () => {
    expect(validateNotificationSettingsInput({ licenseExpiryWarningDays: 1 })).toEqual({});
    expect(validateNotificationSettingsInput({ licenseExpiryWarningDays: 365 })).toEqual({});
  });

  it('isNotificationSettingsInputValid is the inverse', () => {
    expect(isNotificationSettingsInputValid({ licenseExpiryWarningDays: 30 })).toBe(true);
    expect(isNotificationSettingsInputValid({ licenseExpiryWarningDays: 0 })).toBe(false);
  });
});
