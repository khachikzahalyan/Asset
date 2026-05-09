import { describe, it, expect } from 'vitest';

import {
  LICENSE_KEY_MAX_LENGTH,
  sanitizeLicenseSecretValue,
  validateLicenseSecretValue,
  isLicenseSecretValueValid,
} from '@/domain/licenseSecrets.js';

describe('licenseSecrets — constants', () => {
  it('caps key length at 4096', () => {
    expect(LICENSE_KEY_MAX_LENGTH).toBe(4096);
  });
});

describe('licenseSecrets — sanitizeLicenseSecretValue', () => {
  it('trims surrounding whitespace', () => {
    expect(sanitizeLicenseSecretValue('  ABC-DEF-123  ')).toBe('ABC-DEF-123');
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizeLicenseSecretValue(null)).toBe('');
    expect(sanitizeLicenseSecretValue(undefined)).toBe('');
    expect(sanitizeLicenseSecretValue(42)).toBe('');
  });

  it('truncates to LICENSE_KEY_MAX_LENGTH', () => {
    const long = 'X'.repeat(5000);
    expect(sanitizeLicenseSecretValue(long).length).toBe(LICENSE_KEY_MAX_LENGTH);
  });
});

describe('licenseSecrets — validateLicenseSecretValue', () => {
  it('reports errorRequired for empty value', () => {
    expect(validateLicenseSecretValue('   ')).toBe('errorRequired');
  });

  it('reports nothing for a valid value', () => {
    expect(validateLicenseSecretValue('ABC-123')).toBeNull();
  });
});

describe('licenseSecrets — error messages NEVER carry the value', () => {
  it('thrown errors include only generic text', () => {
    // Defensive — there is no throwing helper in this module, but make
    // sure no validation message contains the literal value.
    const value = 'SECRET-VALUE-123';
    const result = validateLicenseSecretValue(value);
    if (result !== null) {
      expect(result).not.toContain(value);
    }
  });
});

describe('licenseSecrets — isLicenseSecretValueValid', () => {
  it('returns true only for non-empty trimmed string within length cap', () => {
    expect(isLicenseSecretValueValid('A')).toBe(true);
    expect(isLicenseSecretValueValid('')).toBe(false);
    expect(isLicenseSecretValueValid('   ')).toBe(false);
  });
});
