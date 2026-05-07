/**
 * Domain tests for `src/domain/assets.js`. Pure JavaScript — no Firestore,
 * no React. Mirrors the structure of `src/test/employees.test.js` and
 * `src/test/categories.test.js`.
 */

import { describe, it, expect } from 'vitest';

import {
  ASSIGNMENT_KINDS,
  emptyAssetInput,
  sanitizeAssetInput,
  validateAssetInput,
  isAssetInputValid,
  formatInventoryCode,
  nameForDisplay,
  AssetInventoryCodeTakenError,
  AssetCounterMissingError,
  AssetCategoryInactiveError,
} from '@/domain/assets.js';
import { DEFAULT_ASSET_STATUS_CODE } from '@/domain/assetStatuses.js';

const SINGLE_LANG_CATEGORY = { requiresMultilang: false };
const MULTI_LANG_CATEGORY = { requiresMultilang: true };

describe('emptyAssetInput', () => {
  it('returns warehouse default with empty plain-string name', () => {
    const e = emptyAssetInput();
    expect(e.categoryId).toBe('');
    expect(e.name).toBe('');
    expect(e.statusId).toBe(DEFAULT_ASSET_STATUS_CODE);
    expect(e.assignedTo).toEqual({ kind: ASSIGNMENT_KINDS.WAREHOUSE, id: null });
    expect(e.branchId).toBeNull();
    expect(e.brand).toBeNull();
    expect(e.model).toBeNull();
    expect(e.serialNumber).toBeNull();
    expect(e.notes).toBeNull();
    expect(e.purchaseDate).toBeNull();
    expect(e.purchasePrice).toBeNull();
    expect(e.isActive).toBe(true);
  });
});

describe('sanitizeAssetInput', () => {
  it('keeps name as plain trimmed string for single-lang category', () => {
    const out = sanitizeAssetInput(
      {
        categoryId: 'device',
        name: '  ASUS X550  ',
      },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(out.name).toBe('ASUS X550');
  });

  it('reshapes name into a 3-locale map for multi-lang category', () => {
    const out = sanitizeAssetInput(
      {
        categoryId: 'furniture',
        name: { ru: '  Стол  ', en: 'Table', hy: 'Սեղան' },
      },
      { category: MULTI_LANG_CATEGORY }
    );
    expect(out.name).toEqual({ ru: 'Стол', en: 'Table', hy: 'Սեղան' });
  });

  it('picks first non-empty locale value when single-lang category receives a map', () => {
    const out = sanitizeAssetInput(
      {
        categoryId: 'device',
        name: { ru: '', en: 'Laptop', hy: '' },
      },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(out.name).toBe('Laptop');
  });

  it('trims brand/model/serialNumber and nulls when empty', () => {
    const out = sanitizeAssetInput(
      {
        categoryId: 'device',
        name: 'X',
        brand: '  Lenovo  ',
        model: '   ',
        serialNumber: '',
      },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(out.brand).toBe('Lenovo');
    expect(out.model).toBeNull();
    expect(out.serialNumber).toBeNull();
  });

  it('coerces an unknown assignedTo.kind to warehouse', () => {
    const out = sanitizeAssetInput(
      { categoryId: 'device', name: 'X', assignedTo: { kind: 'martian', id: 'x' } },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(out.assignedTo).toEqual({ kind: 'warehouse', id: null });
  });

  it('forces assignedTo.id to null when kind is warehouse', () => {
    const out = sanitizeAssetInput(
      {
        categoryId: 'device',
        name: 'X',
        assignedTo: { kind: ASSIGNMENT_KINDS.WAREHOUSE, id: 'leaked' },
      },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(out.assignedTo.id).toBeNull();
  });

  it('forces branchId to null when kind is employee', () => {
    const out = sanitizeAssetInput(
      {
        categoryId: 'device',
        name: 'X',
        branchId: 'b_main',
        assignedTo: { kind: ASSIGNMENT_KINDS.EMPLOYEE, id: 'e_1' },
      },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(out.branchId).toBeNull();
  });

  it('forces branchId to null when kind is department', () => {
    const out = sanitizeAssetInput(
      {
        categoryId: 'device',
        name: 'X',
        branchId: 'b_main',
        assignedTo: { kind: ASSIGNMENT_KINDS.DEPARTMENT, id: 'd_1' },
      },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(out.branchId).toBeNull();
  });

  it('keeps branchId for warehouse and branch modes', () => {
    const wh = sanitizeAssetInput(
      {
        categoryId: 'device',
        name: 'X',
        branchId: 'b_main',
        assignedTo: { kind: ASSIGNMENT_KINDS.WAREHOUSE, id: null },
      },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(wh.branchId).toBe('b_main');

    const br = sanitizeAssetInput(
      {
        categoryId: 'device',
        name: 'X',
        branchId: 'b_main',
        assignedTo: { kind: ASSIGNMENT_KINDS.BRANCH, id: 'b_main' },
      },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(br.branchId).toBe('b_main');
  });

  it('parses purchasePrice from string', () => {
    const out = sanitizeAssetInput(
      { categoryId: 'device', name: 'X', purchasePrice: '  1500.5  ' },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(out.purchasePrice).toBe(1500.5);
  });

  it('parses purchaseDate from string', () => {
    const out = sanitizeAssetInput(
      { categoryId: 'device', name: 'X', purchaseDate: '2026-01-15' },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(out.purchaseDate).toBeInstanceOf(Date);
    expect(out.purchaseDate.getUTCFullYear()).toBe(2026);
  });

  it('defaults statusId to warehouse when missing', () => {
    const out = sanitizeAssetInput(
      { categoryId: 'device', name: 'X' },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(out.statusId).toBe(DEFAULT_ASSET_STATUS_CODE);
  });
});

describe('validateAssetInput', () => {
  it('flags missing categoryId', () => {
    const errors = validateAssetInput(
      { name: 'X', assignedTo: { kind: 'warehouse', id: null }, branchId: 'b' },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(errors.categoryId).toBe('errorRequired');
  });

  it('flags missing single-lang name', () => {
    const errors = validateAssetInput(
      {
        categoryId: 'device',
        name: '   ',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b',
      },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(errors.name).toBe('errorRequired');
  });

  it('flags missing multi-lang name (all locales blank)', () => {
    const errors = validateAssetInput(
      {
        categoryId: 'furniture',
        name: { ru: '', en: '', hy: '' },
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b',
      },
      { category: MULTI_LANG_CATEGORY }
    );
    expect(errors.name).toBe('errorRequired');
  });

  it('flags partial multi-lang name with errorNameAllLocales', () => {
    const errors = validateAssetInput(
      {
        categoryId: 'furniture',
        name: { ru: 'Стол', en: '', hy: '' },
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b',
      },
      { category: MULTI_LANG_CATEGORY }
    );
    expect(errors.name).toBe('errorNameAllLocales');
  });

  it('flags non-ASCII brand', () => {
    const errors = validateAssetInput(
      {
        categoryId: 'device',
        name: 'X',
        brand: 'Леново',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b',
      },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(errors.brand).toBe('errorAsciiOnly');
  });

  it('flags non-ASCII model and serialNumber', () => {
    const errors = validateAssetInput(
      {
        categoryId: 'device',
        name: 'X',
        model: 'модель',
        serialNumber: 'абв',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b',
      },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(errors.model).toBe('errorAsciiOnly');
    expect(errors.serialNumber).toBe('errorAsciiOnly');
  });

  it('flags missing assignedTo.id when kind is employee', () => {
    const errors = validateAssetInput(
      {
        categoryId: 'device',
        name: 'X',
        assignedTo: { kind: 'employee', id: '' },
        branchId: null,
      },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(errors.assignedTo).toBe('errorRequired');
  });

  it('flags missing branchId when kind is warehouse', () => {
    const errors = validateAssetInput(
      {
        categoryId: 'device',
        name: 'X',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: null,
      },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(errors.branchId).toBe('errorRequired');
  });

  it('flags missing branchId when kind is branch', () => {
    const errors = validateAssetInput(
      {
        categoryId: 'device',
        name: 'X',
        assignedTo: { kind: 'branch', id: 'b_north' },
        branchId: null,
      },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(errors.branchId).toBe('errorRequired');
  });

  it('does not flag missing branchId for employee/department modes', () => {
    const emp = validateAssetInput(
      {
        categoryId: 'device',
        name: 'X',
        assignedTo: { kind: 'employee', id: 'e_1' },
        branchId: null,
      },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(emp.branchId).toBeUndefined();

    const dep = validateAssetInput(
      {
        categoryId: 'device',
        name: 'X',
        assignedTo: { kind: 'department', id: 'd_1' },
        branchId: null,
      },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(dep.branchId).toBeUndefined();
  });

  it('passes a fully-valid input', () => {
    const errors = validateAssetInput(
      {
        categoryId: 'device',
        name: 'ASUS X550',
        brand: 'ASUS',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b_main',
      },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(errors).toEqual({});
  });

  it('isAssetInputValid mirrors validateAssetInput', () => {
    const ok = isAssetInputValid(
      {
        categoryId: 'device',
        name: 'X',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b_main',
      },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(ok).toBe(true);

    const bad = isAssetInputValid(
      { categoryId: '', name: '' },
      { category: SINGLE_LANG_CATEGORY }
    );
    expect(bad).toBe(false);
  });
});

describe('formatInventoryCode', () => {
  it('does NOT zero-pad', () => {
    expect(formatInventoryCode('400', 7)).toBe('400/7');
  });

  it('uppercases the prefix', () => {
    expect(formatInventoryCode('lic', 12)).toBe('LIC/12');
  });

  it('truncates fractional numbers', () => {
    expect(formatInventoryCode('400', 3.9)).toBe('400/3');
  });

  it('handles missing prefix gracefully', () => {
    expect(formatInventoryCode(undefined, 1)).toBe('/1');
  });
});

describe('nameForDisplay', () => {
  it('returns plain string verbatim', () => {
    expect(nameForDisplay({ name: 'ASUS X550' }, 'ru')).toBe('ASUS X550');
  });

  it('returns localized value from a 3-locale map', () => {
    expect(
      nameForDisplay({ name: { ru: 'Стол', en: 'Table', hy: 'Սեղան' } }, 'en')
    ).toBe('Table');
  });

  it('falls back through ru → en → hy', () => {
    expect(
      nameForDisplay({ name: { ru: '', en: 'Table', hy: '' } }, 'hy')
    ).toBe('Table');
  });

  it('handles null asset', () => {
    expect(nameForDisplay(null, 'ru')).toBe('');
  });
});

describe('Custom error classes', () => {
  it('AssetInventoryCodeTakenError exposes code', () => {
    const e = new AssetInventoryCodeTakenError('400/7');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('asset/inventory-code-taken');
    expect(e.message).toMatch(/400\/7/);
  });

  it('AssetCounterMissingError exposes code + categoryId', () => {
    const e = new AssetCounterMissingError('device');
    expect(e.code).toBe('asset/counter-missing');
    expect(e.categoryId).toBe('device');
  });

  it('AssetCategoryInactiveError exposes code + categoryId', () => {
    const e = new AssetCategoryInactiveError('furniture');
    expect(e.code).toBe('asset/category-inactive');
    expect(e.categoryId).toBe('furniture');
  });
});
