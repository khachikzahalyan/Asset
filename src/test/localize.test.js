import { describe, it, expect } from 'vitest';
import { localize } from '@/lib/localize.js';

describe('localize()', () => {
  it('returns the requested locale when present', () => {
    expect(localize({ ru: 'Привет', en: 'Hello', hy: 'Բարև' }, 'en')).toBe('Hello');
  });

  it('falls back ru → en → hy when requested locale empty', () => {
    expect(localize({ ru: '', en: 'Hello', hy: 'Բարև' }, 'ru')).toBe('Hello');
  });

  it('falls back to first-truthy when ru/en/hy all empty but other key has value', () => {
    expect(localize({ ru: '', en: '', hy: '', extra: 'X' }, 'ru')).toBe('X');
  });

  it('returns the value as-is when string', () => {
    expect(localize('plain', 'ru')).toBe('plain');
  });

  it('returns empty string for null / undefined', () => {
    expect(localize(null, 'ru')).toBe('');
    expect(localize(undefined, 'ru')).toBe('');
  });

  it('returns empty string when all values empty', () => {
    expect(localize({ ru: '', en: '', hy: '' }, 'ru')).toBe('');
  });
});
