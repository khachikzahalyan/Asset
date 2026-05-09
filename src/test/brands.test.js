import { describe, it, expect } from 'vitest';

import {
  emptyBrandInput,
  sanitizeBrandInput,
  validateBrandInput,
  isBrandInputValid,
  BrandIdConflictError,
  BrandInUseError,
} from '@/domain/brands.js';

describe('brands — emptyBrandInput', () => {
  it('returns blank name and active=true', () => {
    expect(emptyBrandInput()).toEqual({ name: '', isActive: true });
  });
});

describe('brands — sanitizeBrandInput', () => {
  it('trims name and coerces isActive', () => {
    expect(sanitizeBrandInput({ name: '  HP  ', isActive: 0 })).toEqual({
      name: 'HP',
      isActive: false,
    });
  });

  it('defaults isActive to true when undefined', () => {
    expect(sanitizeBrandInput({ name: 'Apple' })).toEqual({
      name: 'Apple',
      isActive: true,
    });
  });

  it('returns empty string for missing name', () => {
    expect(sanitizeBrandInput({})).toEqual({ name: '', isActive: true });
  });

  it('caps name length at 200', () => {
    const long = 'X'.repeat(250);
    expect(sanitizeBrandInput({ name: long }).name.length).toBe(200);
  });
});

describe('brands — validateBrandInput', () => {
  it('reports errorRequired when name is blank', () => {
    expect(validateBrandInput({ name: '   ' })).toEqual({ name: 'errorRequired' });
  });

  it('reports no errors for a valid input', () => {
    expect(validateBrandInput({ name: 'HP', isActive: true })).toEqual({});
  });

  it('isBrandInputValid is the inverse of having errors', () => {
    expect(isBrandInputValid({ name: 'HP' })).toBe(true);
    expect(isBrandInputValid({ name: '' })).toBe(false);
  });
});

describe('brands — error classes', () => {
  it('BrandIdConflictError carries the id and name', () => {
    const err = new BrandIdConflictError('HP');
    expect(err.name).toBe('BrandIdConflictError');
    expect(err.id).toBe('HP');
  });

  it('BrandInUseError carries the count', () => {
    const err = new BrandInUseError('HP', { modelCount: 3, assetCount: 7 });
    expect(err.name).toBe('BrandInUseError');
    expect(err.modelCount).toBe(3);
    expect(err.assetCount).toBe(7);
  });
});
