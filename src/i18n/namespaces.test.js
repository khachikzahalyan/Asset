// src/i18n/namespaces.test.js
import { describe, it, expect } from 'vitest';
import { NAMESPACES, NAMESPACE_LIST } from './namespaces.js';

describe('namespaces', () => {
  it('declares brands, models, licenses', () => {
    expect(NAMESPACES.BRANDS).toBe('brands');
    expect(NAMESPACES.MODELS).toBe('models');
    expect(NAMESPACES.LICENSES).toBe('licenses');
  });

  it('NAMESPACE_LIST contains the new ones', () => {
    expect(NAMESPACE_LIST).toContain('brands');
    expect(NAMESPACE_LIST).toContain('models');
    expect(NAMESPACE_LIST).toContain('licenses');
  });
});
