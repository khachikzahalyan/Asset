import { describe, it, expect } from 'vitest';

import {
  ASSET_STATUS_CODES,
  ASSET_STATUS_CODE_LIST,
  DEFAULT_ASSET_STATUS_CODE,
  COLOR_HEX_REGEX,
  emptyAssetStatusName,
  emptyAssetStatusInput,
  sanitizeAssetStatusInput,
  validateAssetStatusInput,
  isAssetStatusInputValid,
} from '@/domain/assetStatuses.js';

describe('assetStatuses domain', () => {
  it('exposes the five base status codes as a frozen map', () => {
    expect(ASSET_STATUS_CODES.WAREHOUSE).toBe('warehouse');
    expect(ASSET_STATUS_CODES.ASSIGNED).toBe('assigned');
    expect(ASSET_STATUS_CODES.IN_REPAIR).toBe('in_repair');
    expect(ASSET_STATUS_CODES.WRITTEN_OFF).toBe('written_off');
    expect(ASSET_STATUS_CODES.DISPOSED).toBe('disposed');
    expect(ASSET_STATUS_CODE_LIST).toEqual([
      'warehouse',
      'assigned',
      'in_repair',
      'written_off',
      'disposed',
    ]);
    expect(Object.isFrozen(ASSET_STATUS_CODES)).toBe(true);
    expect(Object.isFrozen(ASSET_STATUS_CODE_LIST)).toBe(true);
  });

  it('default status for new assets is warehouse', () => {
    expect(DEFAULT_ASSET_STATUS_CODE).toBe('warehouse');
  });

  it('emptyAssetStatusName has a key per supported locale', () => {
    expect(emptyAssetStatusName()).toEqual({ ru: '', en: '', hy: '' });
  });

  it('emptyAssetStatusInput defaults to non-final, non-assignable, slate', () => {
    expect(emptyAssetStatusInput()).toEqual({
      name: { ru: '', en: '', hy: '' },
      color: '#64748b',
      isFinal: false,
      isAssignable: false,
      sortOrder: 0,
      isActive: true,
    });
  });

  describe('COLOR_HEX_REGEX', () => {
    it.each([
      ['#16a34a', true],
      ['#000000', true],
      ['#ffffff', true],
      ['#7f1d1d', true],
      ['#FFFFFF', false], // sanitize lowercases first; the regex itself is lowercase-only
      ['16a34a', false],
      ['#16a34', false],
      ['#16a34aa', false],
      ['#ggg111', false],
      ['', false],
    ])('matches %j -> %s', (input, expected) => {
      expect(COLOR_HEX_REGEX.test(input)).toBe(expected);
    });
  });

  describe('sanitizeAssetStatusInput', () => {
    it('trims every string and lowercases the color', () => {
      const out = sanitizeAssetStatusInput({
        name: {
          ru: '  Склад  ',
          en: '  Warehouse  ',
          hy: '  Պահեստ  ',
        },
        color: '  #16A34A  ',
        isFinal: false,
        isAssignable: false,
        sortOrder: 1,
        isActive: true,
      });
      expect(out).toEqual({
        name: { ru: 'Склад', en: 'Warehouse', hy: 'Պահեստ' },
        color: '#16a34a',
        isFinal: false,
        isAssignable: false,
        sortOrder: 1,
        isActive: true,
      });
    });

    it('coerces isFinal and isAssignable to booleans (default false)', () => {
      expect(sanitizeAssetStatusInput({}).isFinal).toBe(false);
      expect(sanitizeAssetStatusInput({}).isAssignable).toBe(false);
      expect(sanitizeAssetStatusInput({ isFinal: true }).isFinal).toBe(true);
      expect(sanitizeAssetStatusInput({ isAssignable: 1 }).isAssignable).toBe(true);
      expect(sanitizeAssetStatusInput({ isAssignable: 0 }).isAssignable).toBe(false);
    });

    it('coerces sortOrder to an integer (truncates floats, parses strings)', () => {
      expect(sanitizeAssetStatusInput({ sortOrder: 3 }).sortOrder).toBe(3);
      expect(sanitizeAssetStatusInput({ sortOrder: 2.7 }).sortOrder).toBe(2);
      expect(sanitizeAssetStatusInput({ sortOrder: '5' }).sortOrder).toBe(5);
      expect(sanitizeAssetStatusInput({ sortOrder: '   ' }).sortOrder).toBe(0);
      expect(sanitizeAssetStatusInput({ sortOrder: 'oops' }).sortOrder).toBe(0);
      expect(sanitizeAssetStatusInput({}).sortOrder).toBe(0);
      expect(sanitizeAssetStatusInput({ sortOrder: NaN }).sortOrder).toBe(0);
      expect(sanitizeAssetStatusInput({ sortOrder: Infinity }).sortOrder).toBe(0);
    });

    it('coerces non-string color to empty string', () => {
      expect(sanitizeAssetStatusInput({ color: 12345 }).color).toBe('');
      expect(sanitizeAssetStatusInput({ color: null }).color).toBe('');
    });

    it('handles nullish input with safe defaults', () => {
      const out = sanitizeAssetStatusInput(undefined);
      expect(out).toEqual({
        name: { ru: '', en: '', hy: '' },
        color: '',
        isFinal: false,
        isAssignable: false,
        sortOrder: 0,
        isActive: true,
      });
    });
  });

  describe('validateAssetStatusInput', () => {
    it('flags fully-empty name as required', () => {
      const errors = validateAssetStatusInput({
        name: { ru: '', en: '', hy: '' },
        color: '#16a34a',
      });
      expect(errors.name).toBe('errorRequired');
    });

    it('flags partial name as needs-all-locales', () => {
      const errors = validateAssetStatusInput({
        name: { ru: 'Склад', en: '', hy: '' },
        color: '#16a34a',
      });
      expect(errors.name).toBe('errorNameAllLocales');
    });

    it('flags missing color as required', () => {
      const errors = validateAssetStatusInput({
        name: { ru: 'a', en: 'b', hy: 'c' },
        color: '',
      });
      expect(errors.color).toBe('errorRequired');
    });

    it('flags malformed color', () => {
      const errors = validateAssetStatusInput({
        name: { ru: 'a', en: 'b', hy: 'c' },
        color: '#zzz',
      });
      expect(errors.color).toBe('errorColorFormat');
    });

    it('accepts an uppercase color in the input (sanitizer lowercases)', () => {
      const errors = validateAssetStatusInput({
        name: { ru: 'a', en: 'b', hy: 'c' },
        color: '#16A34A',
      });
      expect(errors).toEqual({});
    });

    it('passes when name and color are both valid', () => {
      const errors = validateAssetStatusInput({
        name: { ru: 'Склад', en: 'Warehouse', hy: 'Պահեստ' },
        color: '#64748b',
      });
      expect(errors).toEqual({});
    });

    it('isAssetStatusInputValid mirrors validateAssetStatusInput', () => {
      expect(isAssetStatusInputValid(emptyAssetStatusInput())).toBe(false);
      expect(
        isAssetStatusInputValid({
          ...emptyAssetStatusInput(),
          name: { ru: 'a', en: 'b', hy: 'c' },
          color: '#16a34a',
        })
      ).toBe(true);
    });
  });
});
