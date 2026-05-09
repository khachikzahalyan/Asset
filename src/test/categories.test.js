import { describe, it, expect } from 'vitest';

import {
  CATEGORY_CODES,
  CATEGORY_CODE_LIST,
  INVENTORY_PREFIX_REGEX,
  emptyCategoryName,
  emptyCategoryInput,
  sanitizeCategoryInput,
  validateCategoryInput,
  isCategoryInputValid,
} from '@/domain/categories.js';

describe('categories domain', () => {
  it('exposes the three base category codes as a frozen map', () => {
    expect(CATEGORY_CODES.DEVICE).toBe('device');
    expect(CATEGORY_CODES.FURNITURE).toBe('furniture');
    expect(CATEGORY_CODES.LICENSE).toBe('license');
    expect(CATEGORY_CODE_LIST).toEqual(['device', 'furniture', 'license']);
    expect(Object.isFrozen(CATEGORY_CODES)).toBe(true);
    expect(Object.isFrozen(CATEGORY_CODE_LIST)).toBe(true);
  });

  it('emptyCategoryName has a key per supported locale', () => {
    expect(emptyCategoryName()).toEqual({ ru: '', en: '', hy: '' });
  });

  it('emptyCategoryInput defaults to multilang+active with empty name, prefix, attachableTo', () => {
    expect(emptyCategoryInput()).toEqual({
      name: { ru: '', en: '', hy: '' },
      inventoryCodePrefix: '',
      requiresMultilang: true,
      attachableTo: [],
      assignsInventoryCode: true,
      canHostLicense: false,
      isActive: true,
    });
  });

  describe('INVENTORY_PREFIX_REGEX', () => {
    it.each([
      ['400', true],
      ['LIC', true],
      ['LAP1', true],
      ['ABC123', true],
      ['', false],
      ['400/', false],
      ['lic', false],
      ['lap', false],
      ['LAP-1', false],
      ['LAP 1', false],
      ['400/000', false],
    ])('matches %j -> %s', (input, expected) => {
      expect(INVENTORY_PREFIX_REGEX.test(input)).toBe(expected);
    });
  });

  describe('sanitizeCategoryInput', () => {
    it('trims every string and uppercases the prefix', () => {
      const out = sanitizeCategoryInput({
        name: { ru: '  Устройство  ', en: '  Device  ', hy: '  Սարք  ' },
        inventoryCodePrefix: '  lic  ',
        requiresMultilang: true,
        isActive: true,
      });
      expect(out).toEqual({
        name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
        inventoryCodePrefix: 'LIC',
        requiresMultilang: true,
        attachableTo: [],
        assignsInventoryCode: true,
        canHostLicense: false,
        isActive: true,
      });
    });

    it('mirrors the first non-empty locale across all three when requiresMultilang is false', () => {
      const out = sanitizeCategoryInput({
        name: { ru: 'Устройство', en: '', hy: '' },
        inventoryCodePrefix: '400',
        requiresMultilang: false,
      });
      expect(out.name).toEqual({
        ru: 'Устройство',
        en: 'Устройство',
        hy: 'Устройство',
      });
    });

    it('keeps the multilang shape uniform when requiresMultilang is true', () => {
      const out = sanitizeCategoryInput({
        name: { ru: 'Мебель', en: 'Furniture', hy: 'Կահույք' },
        inventoryCodePrefix: '500',
        requiresMultilang: true,
      });
      expect(out.name).toEqual({ ru: 'Мебель', en: 'Furniture', hy: 'Կահույք' });
    });

    it('falls back to en/hy when ru is empty under requiresMultilang=false', () => {
      const out = sanitizeCategoryInput({
        name: { ru: '', en: 'Device', hy: '' },
        inventoryCodePrefix: '400',
        requiresMultilang: false,
      });
      expect(out.name).toEqual({ ru: 'Device', en: 'Device', hy: 'Device' });
    });

    it('keeps three empty strings when all locales are empty', () => {
      const out = sanitizeCategoryInput({
        name: { ru: '', en: '', hy: '' },
        inventoryCodePrefix: '400',
        requiresMultilang: false,
      });
      expect(out.name).toEqual({ ru: '', en: '', hy: '' });
    });

    it('coerces requiresMultilang to a boolean (defaults to true)', () => {
      expect(sanitizeCategoryInput({}).requiresMultilang).toBe(true);
      expect(sanitizeCategoryInput({ requiresMultilang: undefined }).requiresMultilang).toBe(true);
      expect(sanitizeCategoryInput({ requiresMultilang: false }).requiresMultilang).toBe(false);
      expect(sanitizeCategoryInput({ requiresMultilang: 0 }).requiresMultilang).toBe(false);
      expect(sanitizeCategoryInput({ requiresMultilang: 'yes' }).requiresMultilang).toBe(true);
    });

    it('coerces isActive to a boolean (defaults to true)', () => {
      expect(sanitizeCategoryInput({}).isActive).toBe(true);
      expect(sanitizeCategoryInput({ isActive: false }).isActive).toBe(false);
      expect(sanitizeCategoryInput({ isActive: 0 }).isActive).toBe(false);
    });

    it('handles nullish input', () => {
      const out = sanitizeCategoryInput(undefined);
      expect(out).toEqual({
        name: { ru: '', en: '', hy: '' },
        inventoryCodePrefix: '',
        requiresMultilang: true,
        attachableTo: [],
        assignsInventoryCode: true,
        canHostLicense: false,
        isActive: true,
      });
    });

    it('coerces non-string prefix to empty string', () => {
      expect(sanitizeCategoryInput({ inventoryCodePrefix: 400 }).inventoryCodePrefix).toBe('');
      expect(sanitizeCategoryInput({ inventoryCodePrefix: null }).inventoryCodePrefix).toBe('');
    });
  });

  describe('validateCategoryInput', () => {
    it('flags fully-empty multilang name as required', () => {
      const errors = validateCategoryInput({
        name: { ru: '', en: '', hy: '' },
        inventoryCodePrefix: '400',
        requiresMultilang: true,
      });
      expect(errors.name).toBe('errorRequired');
    });

    it('flags partial multilang name as needs-all-locales', () => {
      const errors = validateCategoryInput({
        name: { ru: 'Устройство', en: '', hy: '' },
        inventoryCodePrefix: '400',
        requiresMultilang: true,
      });
      expect(errors.name).toBe('errorNameAllLocales');
    });

    it('passes a fully filled multilang name', () => {
      const errors = validateCategoryInput({
        name: { ru: 'Мебель', en: 'Furniture', hy: 'Կահույք' },
        inventoryCodePrefix: '500',
        requiresMultilang: true,
        attachableTo: ['branch'],
      });
      expect(errors).toEqual({});
    });

    it('passes a single-language category with name in only one locale', () => {
      const errors = validateCategoryInput({
        name: { ru: 'Устройство', en: '', hy: '' },
        inventoryCodePrefix: '400',
        requiresMultilang: false,
        attachableTo: ['branch'],
      });
      expect(errors).toEqual({});
    });

    it('flags a single-language category with no name as required', () => {
      const errors = validateCategoryInput({
        name: { ru: '', en: '', hy: '' },
        inventoryCodePrefix: '400',
        requiresMultilang: false,
      });
      expect(errors.name).toBe('errorRequired');
    });

    it('flags missing prefix as required', () => {
      const errors = validateCategoryInput({
        name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
        inventoryCodePrefix: '',
        requiresMultilang: true,
      });
      expect(errors.inventoryCodePrefix).toBe('errorRequired');
    });

    it('flags malformed prefix as errorPrefixFormat', () => {
      const errors = validateCategoryInput({
        name: { ru: 'a', en: 'b', hy: 'c' },
        inventoryCodePrefix: 'lap-1',
        requiresMultilang: true,
      });
      // 'lap-1' becomes 'LAP-1' after sanitize, fails the regex.
      expect(errors.inventoryCodePrefix).toBe('errorPrefixFormat');
    });

    it('accepts uppercase, alphanumeric prefixes', () => {
      const errors = validateCategoryInput({
        name: { ru: 'a', en: 'b', hy: 'c' },
        inventoryCodePrefix: 'LIC',
        requiresMultilang: true,
        attachableTo: ['branch'],
      });
      expect(errors).toEqual({});
    });

    it('isCategoryInputValid mirrors validateCategoryInput', () => {
      expect(
        isCategoryInputValid({
          name: { ru: '', en: '', hy: '' },
          inventoryCodePrefix: '',
          requiresMultilang: true,
          attachableTo: ['employee'],
        })
      ).toBe(false);
      expect(
        isCategoryInputValid({
          name: { ru: 'a', en: 'b', hy: 'c' },
          inventoryCodePrefix: 'LIC',
          requiresMultilang: true,
          attachableTo: ['employee'],
        })
      ).toBe(true);
    });
  });

  describe('Category attachableTo', () => {
    it('sanitizer dedupes and drops unknown kinds', () => {
      const out = sanitizeCategoryInput({
        name: { ru: 'X', en: 'X', hy: 'X' },
        inventoryCodePrefix: 'A1',
        attachableTo: ['employee', 'employee', 'unknown', 'branch'],
      });
      expect(out.attachableTo).toEqual(['employee', 'branch']);
    });

    it('sanitizer coerces missing/non-array to []', () => {
      expect(
        sanitizeCategoryInput({
          name: { ru: 'X', en: 'X', hy: 'X' },
          inventoryCodePrefix: 'A1',
        }).attachableTo
      ).toEqual([]);
      expect(
        sanitizeCategoryInput({
          name: { ru: 'X', en: 'X', hy: 'X' },
          inventoryCodePrefix: 'A1',
          attachableTo: 'employee',
        }).attachableTo
      ).toEqual([]);
    });

    it('validator flags empty array with errorAttachableEmpty', () => {
      const errs = validateCategoryInput({
        name: { ru: 'X', en: 'X', hy: 'X' },
        inventoryCodePrefix: 'A1',
        attachableTo: [],
      });
      expect(errs.attachableTo).toBe('errorAttachableEmpty');
    });

    it('validator passes when at least one kind is present', () => {
      const errs = validateCategoryInput({
        name: { ru: 'X', en: 'X', hy: 'X' },
        inventoryCodePrefix: 'A1',
        attachableTo: ['employee'],
      });
      expect(errs.attachableTo).toBeUndefined();
    });
  });
});

describe('categories — canHostLicense', () => {
  it('emptyCategoryInput defaults canHostLicense to false', () => {
    expect(emptyCategoryInput().canHostLicense).toBe(false);
  });

  it('sanitizeCategoryInput defaults canHostLicense to false when missing', () => {
    const out = sanitizeCategoryInput({
      name: { ru: 'X', en: 'X', hy: 'X' },
      inventoryCodePrefix: 'A1',
      attachableTo: ['warehouse'],
    });
    expect(out.canHostLicense).toBe(false);
  });

  it('sanitizeCategoryInput preserves canHostLicense: true', () => {
    const out = sanitizeCategoryInput({
      name: { ru: 'Device', en: 'Device', hy: 'Device' },
      inventoryCodePrefix: '400',
      attachableTo: ['warehouse'],
      canHostLicense: true,
    });
    expect(out.canHostLicense).toBe(true);
  });

  it('sanitizeCategoryInput coerces truthy/falsy values to boolean', () => {
    expect(sanitizeCategoryInput({ canHostLicense: 1 }).canHostLicense).toBe(true);
    expect(sanitizeCategoryInput({ canHostLicense: 0 }).canHostLicense).toBe(false);
    expect(sanitizeCategoryInput({ canHostLicense: false }).canHostLicense).toBe(false);
  });
});

describe('categories — assignsInventoryCode', () => {
  it('emptyCategoryInput defaults assignsInventoryCode to true', () => {
    expect(emptyCategoryInput().assignsInventoryCode).toBe(true);
  });

  it('sanitizeCategoryInput coerces missing flag to true', () => {
    const sanitized = sanitizeCategoryInput({
      name: { ru: 'X', en: 'X', hy: 'X' },
      inventoryCodePrefix: 'X1',
      attachableTo: ['warehouse'],
    });
    expect(sanitized.assignsInventoryCode).toBe(true);
  });

  it('sanitizeCategoryInput preserves false', () => {
    const sanitized = sanitizeCategoryInput({
      name: { ru: 'License', en: 'License', hy: 'License' },
      inventoryCodePrefix: 'LIC',
      attachableTo: ['warehouse', 'employee'],
      requiresMultilang: false,
      assignsInventoryCode: false,
    });
    expect(sanitized.assignsInventoryCode).toBe(false);
  });

  it('sanitizeCategoryInput coerces truthy/falsy values to boolean', () => {
    expect(
      sanitizeCategoryInput({
        name: { ru: 'X', en: 'X', hy: 'X' },
        inventoryCodePrefix: 'X1',
        attachableTo: ['warehouse'],
        assignsInventoryCode: 0,
      }).assignsInventoryCode
    ).toBe(false);
    expect(
      sanitizeCategoryInput({
        name: { ru: 'X', en: 'X', hy: 'X' },
        inventoryCodePrefix: 'X1',
        attachableTo: ['warehouse'],
        assignsInventoryCode: 1,
      }).assignsInventoryCode
    ).toBe(true);
  });
});
