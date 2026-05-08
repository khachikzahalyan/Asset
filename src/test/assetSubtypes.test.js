/**
 * Domain tests for `src/domain/assetSubtypes.js`. Pure JavaScript — no
 * Firestore, no React. Mirrors the structure of categories/employees tests.
 */

import { describe, it, expect } from 'vitest';

import {
  emptyAssetSubtypeInput,
  sanitizeAssetSubtypeInput,
  validateAssetSubtypeInput,
  isAssetSubtypeInputValid,
  AssetSubtypeIdConflictError,
  AssetSubtypeInactiveError,
} from '@/domain/assetSubtypes.js';

describe('assetSubtypes — emptyAssetSubtypeInput', () => {
  it('returns multilang map, active flag, empty attachableTo array', () => {
    const v = emptyAssetSubtypeInput();
    expect(v.categoryId).toBe('');
    expect(v.name).toEqual({ ru: '', en: '', hy: '' });
    expect(v.requiresMultilang).toBe(false);
    expect(v.attachableTo).toEqual([]);
    expect(v.sortOrder).toBe(0);
    expect(v.isActive).toBe(true);
  });
});

describe('assetSubtypes — sanitizeAssetSubtypeInput', () => {
  it('mirrors single-string name into all three locales when requiresMultilang is false', () => {
    const r = sanitizeAssetSubtypeInput({
      categoryId: 'device',
      name: '  Laptop  ',
      requiresMultilang: false,
    });
    expect(r.name).toEqual({ ru: 'Laptop', en: 'Laptop', hy: 'Laptop' });
  });

  it('keeps per-locale strings when requiresMultilang is true', () => {
    const r = sanitizeAssetSubtypeInput({
      categoryId: 'furniture',
      name: { ru: '  Стол  ', en: 'Desk', hy: 'Սեղան' },
      requiresMultilang: true,
    });
    expect(r.name).toEqual({ ru: 'Стол', en: 'Desk', hy: 'Սեղան' });
  });

  it('keeps only known kinds and dedupes', () => {
    const r = sanitizeAssetSubtypeInput({
      categoryId: 'device',
      name: 'Laptop',
      attachableTo: ['employee', 'employee', 'foo', 'branch'],
    });
    expect(r.attachableTo).toEqual(['employee', 'branch']);
  });

  it('coerces missing/non-array attachableTo to []', () => {
    expect(
      sanitizeAssetSubtypeInput({ categoryId: 'device', name: 'Laptop' }).attachableTo
    ).toEqual([]);
    expect(
      sanitizeAssetSubtypeInput({
        categoryId: 'device',
        name: 'Laptop',
        attachableTo: 'employee',
      }).attachableTo
    ).toEqual([]);
  });

  it('coerces sortOrder to integer', () => {
    expect(sanitizeAssetSubtypeInput({ sortOrder: '7' }).sortOrder).toBe(7);
    expect(sanitizeAssetSubtypeInput({ sortOrder: 3.7 }).sortOrder).toBe(3);
    expect(sanitizeAssetSubtypeInput({ sortOrder: 'NaN' }).sortOrder).toBe(0);
  });

  it('trims categoryId', () => {
    const r = sanitizeAssetSubtypeInput({ categoryId: '  device  ' });
    expect(r.categoryId).toBe('device');
  });
});

describe('assetSubtypes — validateAssetSubtypeInput', () => {
  it('requires categoryId', () => {
    const errors = validateAssetSubtypeInput({});
    expect(errors.categoryId).toBe('errorRequired');
  });

  it('requires at least one filled locale when requiresMultilang is false', () => {
    const errors = validateAssetSubtypeInput({
      categoryId: 'device',
      name: { ru: '', en: '', hy: '' },
      requiresMultilang: false,
      attachableTo: ['employee'],
    });
    expect(errors.name).toBe('errorRequired');
  });

  it('requires all three locales when requiresMultilang is true', () => {
    const errors = validateAssetSubtypeInput({
      categoryId: 'furniture',
      name: { ru: 'Стол', en: '', hy: '' },
      requiresMultilang: true,
      attachableTo: ['branch'],
    });
    expect(errors.name).toBe('errorNameAllLocales');
  });

  it('passes for a valid device subtype with attachableTo array', () => {
    const errors = validateAssetSubtypeInput({
      categoryId: 'device',
      name: 'Laptop',
      requiresMultilang: false,
      attachableTo: ['employee', 'branch'],
    });
    expect(errors).toEqual({});
  });

  it('flags empty attachableTo with errorAttachableEmpty', () => {
    const errors = validateAssetSubtypeInput({
      categoryId: 'device',
      name: 'Laptop',
      requiresMultilang: false,
      attachableTo: [],
    });
    expect(errors.attachableTo).toBe('errorAttachableEmpty');
  });

  it('rejects superset of category attachableTo with errorAttachableNotInCategory', () => {
    const errors = validateAssetSubtypeInput(
      {
        categoryId: 'device',
        name: 'Laptop',
        requiresMultilang: false,
        attachableTo: ['employee', 'asset'],
      },
      { category: { attachableTo: ['employee'] } }
    );
    expect(errors.attachableTo).toBe('errorAttachableNotInCategory');
  });

  it('passes for a subset of category attachableTo', () => {
    const errors = validateAssetSubtypeInput(
      {
        categoryId: 'device',
        name: 'Laptop',
        requiresMultilang: false,
        attachableTo: ['employee'],
      },
      { category: { attachableTo: ['employee', 'branch'] } }
    );
    expect(errors.attachableTo).toBeUndefined();
  });

  it('isAssetSubtypeInputValid returns true on no errors', () => {
    expect(
      isAssetSubtypeInputValid({
        categoryId: 'license',
        name: 'Office 365',
        requiresMultilang: false,
        attachableTo: ['employee', 'asset'],
      })
    ).toBe(true);
  });
});

describe('assetSubtypes — error classes', () => {
  it('AssetSubtypeIdConflictError carries the id', () => {
    const e = new AssetSubtypeIdConflictError('device_laptop');
    expect(e.id).toBe('device_laptop');
    expect(e.code).toBe('asset_subtype/id-conflict');
    expect(e.name).toBe('AssetSubtypeIdConflictError');
  });

  it('AssetSubtypeInactiveError carries the id', () => {
    const e = new AssetSubtypeInactiveError('license_windows');
    expect(e.id).toBe('license_windows');
    expect(e.code).toBe('asset_subtype/inactive');
    expect(e.name).toBe('AssetSubtypeInactiveError');
  });
});
