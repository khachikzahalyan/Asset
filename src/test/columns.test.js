import { describe, it, expect } from 'vitest';
import { COLUMN_KEYS, INFO_ONLY_HEADERS } from '@/lib/excel/columns.js';

describe('excel columns', () => {
  it('exports a frozen ordered key list of length 18', () => {
    expect(Object.isFrozen(COLUMN_KEYS)).toBe(true);
    expect(COLUMN_KEYS).toHaveLength(18);
    expect(COLUMN_KEYS[0]).toBe('inventoryCode');
    expect(COLUMN_KEYS[COLUMN_KEYS.length - 1]).toBe('createdAt');
  });

  it('includes the three name-locale columns in order', () => {
    const idx = (k) => COLUMN_KEYS.indexOf(k);
    expect(idx('nameRu')).toBeGreaterThan(-1);
    expect(idx('nameEn')).toBe(idx('nameRu') + 1);
    expect(idx('nameHy')).toBe(idx('nameRu') + 2);
  });

  it('declares info-only headers that are also in COLUMN_KEYS', () => {
    for (const h of INFO_ONLY_HEADERS) {
      expect(COLUMN_KEYS).toContain(h);
    }
    expect(INFO_ONLY_HEADERS).toContain('inventoryCode');
    expect(INFO_ONLY_HEADERS).toContain('holderName');
    expect(INFO_ONLY_HEADERS).toContain('createdAt');
  });
});
