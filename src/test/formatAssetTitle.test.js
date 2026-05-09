import { describe, it, expect } from 'vitest';

import { formatAssetTitle } from '@/lib/asset/formatAssetTitle.js';

describe('formatAssetTitle', () => {
  it('joins subtype, brand, model with " · " for non-multilang categories', () => {
    expect(
      formatAssetTitle(
        { name: null, categoryId: 'device' },
        {
          subtype: { name: { ru: 'Ноутбук', en: 'Laptop', hy: 'Նոթբուք' } },
          brand: { name: 'HP' },
          model: { name: 'EliteBook 840 G6' },
        },
        'ru'
      )
    ).toBe('Ноутбук · HP · EliteBook 840 G6');
  });

  it('skips missing brand/model parts', () => {
    expect(
      formatAssetTitle(
        { name: null, categoryId: 'device' },
        {
          subtype: { name: { ru: 'Ноутбук', en: 'Laptop', hy: 'Նոթբուք' } },
          brand: null,
          model: null,
        },
        'ru'
      )
    ).toBe('Ноутбук');
  });

  it('returns localized name for multi-lang categories (Furniture)', () => {
    expect(
      formatAssetTitle(
        { name: { ru: 'Стол офисный', en: 'Office desk', hy: 'Գրասենյակային սեղան' }, categoryId: 'furniture' },
        { subtype: null, brand: null, model: null },
        'ru'
      )
    ).toBe('Стол офисный');
  });

  it('falls back to en when ru is empty', () => {
    expect(
      formatAssetTitle(
        { name: { ru: '', en: 'Office desk', hy: '' }, categoryId: 'furniture' },
        { subtype: null, brand: null, model: null },
        'ru'
      )
    ).toBe('Office desk');
  });

  it('returns empty string for null asset', () => {
    expect(formatAssetTitle(null, {}, 'ru')).toBe('');
  });

  it('handles empty parts gracefully', () => {
    expect(
      formatAssetTitle(
        { name: null, categoryId: 'device' },
        { subtype: null, brand: null, model: null },
        'ru'
      )
    ).toBe('');
  });

  it('handles plain-string subtype name', () => {
    expect(
      formatAssetTitle(
        { name: null, categoryId: 'device' },
        { subtype: { name: 'Laptop' }, brand: { name: 'HP' }, model: null },
        'ru'
      )
    ).toBe('Laptop · HP');
  });
});
