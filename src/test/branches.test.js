import { describe, it, expect } from 'vitest';

import {
  BRANCH_TYPES,
  BRANCH_TYPE_LIST,
  emptyBranchInput,
  emptyBranchName,
  sanitizeBranchInput,
  validateBranchInput,
  isBranchInputValid,
} from '@/domain/branches.js';

describe('branches domain', () => {
  it('exposes the two branch types', () => {
    expect(BRANCH_TYPES.BRANCH).toBe('branch');
    expect(BRANCH_TYPES.WAREHOUSE).toBe('warehouse');
    expect(BRANCH_TYPE_LIST).toEqual(['branch', 'warehouse']);
    expect(Object.isFrozen(BRANCH_TYPES)).toBe(true);
  });

  it('emptyBranchName has a key per supported locale', () => {
    expect(emptyBranchName()).toEqual({ ru: '', en: '', hy: '' });
  });

  it('emptyBranchInput defaults to active branch with empty name', () => {
    const input = emptyBranchInput();
    expect(input).toEqual({
      name: { ru: '', en: '', hy: '' },
      type: 'branch',
      address: '',
      phone: null,
      responsibleEmployeeId: null,
      isActive: true,
      isPrimary: false,
    });
  });

  describe('sanitizeBranchInput', () => {
    it('trims every string and coerces missing fields to defaults', () => {
      const out = sanitizeBranchInput({
        name: { ru: '  Главный  ', en: ' HQ ', hy: ' Գլխավոր ' },
        type: 'warehouse',
        address: '  Yerevan  ',
        responsibleEmployeeId: ' emp_1 ',
      });
      expect(out).toEqual({
        name: { ru: 'Главный', en: 'HQ', hy: 'Գլխավոր' },
        type: 'warehouse',
        address: 'Yerevan',
        phone: null,
        responsibleEmployeeId: 'emp_1',
        isActive: true,
        isPrimary: false,
      });
    });

    it('trims a non-empty phone and keeps it as a string', () => {
      expect(sanitizeBranchInput({ phone: '  +374 11 22 33 44  ' }).phone).toBe(
        '+374 11 22 33 44'
      );
    });

    it('coerces empty / whitespace-only / missing phone to null', () => {
      expect(sanitizeBranchInput({ phone: '' }).phone).toBeNull();
      expect(sanitizeBranchInput({ phone: '   ' }).phone).toBeNull();
      expect(sanitizeBranchInput({ phone: null }).phone).toBeNull();
      expect(sanitizeBranchInput({}).phone).toBeNull();
    });

    it('coerces isPrimary to a boolean (defaults to false when missing)', () => {
      expect(sanitizeBranchInput({}).isPrimary).toBe(false);
      expect(sanitizeBranchInput({ isPrimary: undefined }).isPrimary).toBe(false);
      expect(sanitizeBranchInput({ isPrimary: true }).isPrimary).toBe(true);
      expect(sanitizeBranchInput({ isPrimary: 'yes' }).isPrimary).toBe(true);
      expect(sanitizeBranchInput({ isPrimary: 0 }).isPrimary).toBe(false);
    });

    it('coerces unknown type to "branch"', () => {
      const out = sanitizeBranchInput({ type: 'depot' });
      expect(out.type).toBe('branch');
    });

    it('coerces empty / whitespace-only responsibleEmployeeId to null', () => {
      expect(sanitizeBranchInput({ responsibleEmployeeId: '' }).responsibleEmployeeId).toBeNull();
      expect(sanitizeBranchInput({ responsibleEmployeeId: '   ' }).responsibleEmployeeId).toBeNull();
      expect(sanitizeBranchInput({ responsibleEmployeeId: null }).responsibleEmployeeId).toBeNull();
      expect(sanitizeBranchInput({}).responsibleEmployeeId).toBeNull();
    });

    it('respects an explicit isActive=false', () => {
      expect(sanitizeBranchInput({ isActive: false }).isActive).toBe(false);
    });

    it('handles nullish input', () => {
      const out = sanitizeBranchInput(undefined);
      expect(out.type).toBe('branch');
      expect(out.name).toEqual({ ru: '', en: '', hy: '' });
    });
  });

  describe('validateBranchInput', () => {
    it('flags fully-empty name as required', () => {
      const errors = validateBranchInput(emptyBranchInput());
      expect(errors.name).toBe('errorRequired');
    });

    it('flags partially-empty name as needs-all-locales', () => {
      const errors = validateBranchInput({
        ...emptyBranchInput(),
        name: { ru: 'Главный', en: '', hy: '' },
      });
      expect(errors.name).toBe('errorNameAllLocales');
    });

    it('passes when every locale is filled', () => {
      const errors = validateBranchInput({
        ...emptyBranchInput(),
        name: { ru: 'Главный', en: 'HQ', hy: 'Գլխավոր' },
      });
      expect(errors).toEqual({});
    });

    it('isBranchInputValid mirrors validateBranchInput', () => {
      expect(isBranchInputValid(emptyBranchInput())).toBe(false);
      expect(
        isBranchInputValid({
          ...emptyBranchInput(),
          name: { ru: 'a', en: 'b', hy: 'c' },
        })
      ).toBe(true);
    });
  });
});
