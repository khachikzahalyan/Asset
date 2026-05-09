import { describe, it, expect } from 'vitest';

import { sanitizeLicenseKeyDiff } from '@/lib/audit/sanitizeLicenseKeyDiff.js';

describe('sanitizeLicenseKeyDiff', () => {
  it('passes through a plain object without licenseKey', () => {
    const input = { name: 'X', isActive: true };
    expect(sanitizeLicenseKeyDiff(input)).toEqual(input);
    // Returns a new object (does not mutate).
    expect(sanitizeLicenseKeyDiff(input)).not.toBe(input);
  });

  it('strips top-level licenseKey', () => {
    expect(sanitizeLicenseKeyDiff({ licenseKey: 'SECRET', name: 'X' })).toEqual({
      name: 'X',
    });
  });

  it('strips nested secrets.key', () => {
    expect(
      sanitizeLicenseKeyDiff({ name: 'X', secrets: { key: 'SECRET', other: 'safe' } })
    ).toEqual({ name: 'X', secrets: { other: 'safe' } });
  });

  it('preserves keys whose name CONTAINS but does NOT equal licenseKey', () => {
    expect(
      sanitizeLicenseKeyDiff({ licenseKeySet: true, licenseType: 'business' })
    ).toEqual({ licenseKeySet: true, licenseType: 'business' });
  });

  it('returns null for null', () => {
    expect(sanitizeLicenseKeyDiff(null)).toBeNull();
  });

  it('returns undefined for undefined', () => {
    expect(sanitizeLicenseKeyDiff(undefined)).toBeUndefined();
  });

  it('handles arrays without recursing into them', () => {
    expect(sanitizeLicenseKeyDiff({ list: [{ licenseKey: 'X' }, 'Y'] })).toEqual({
      list: [{ licenseKey: 'X' }, 'Y'],
    });
    // Arrays are out of scope per the spec — license key is a top-level
    // or secrets.key field, never a list element. We document the policy
    // by keeping arrays untouched.
  });
});
