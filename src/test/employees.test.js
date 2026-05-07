import { describe, it, expect } from 'vitest';

import {
  emptyEmployeeInput,
  sanitizeEmployeeInput,
  validateEmployeeInput,
  isEmployeeInputValid,
  formatEmployeeName,
  emailKey,
  EmployeeEmailTakenError,
  EmployeeHasActiveAssignmentsError,
} from '@/domain/employees.js';

describe('employees domain', () => {
  describe('emptyEmployeeInput', () => {
    it('returns a fresh form-state with sensible defaults', () => {
      expect(emptyEmployeeInput()).toEqual({
        firstName: '',
        lastName: '',
        email: '',
        phone: null,
        branchId: null,
        departmentId: null,
        department: null,
        isActive: true,
      });
    });
  });

  describe('sanitizeEmployeeInput', () => {
    it('trims every string and lower-cases the email', () => {
      const out = sanitizeEmployeeInput({
        firstName: '  Khach  ',
        lastName: ' Z ',
        email: '  Foo@BAR.com  ',
        phone: ' +374 11 22 33 44 ',
        branchId: '  b1 ',
        departmentId: '  d1 ',
        department: ' QA ',
      });
      expect(out).toEqual({
        firstName: 'Khach',
        lastName: 'Z',
        email: 'foo@bar.com',
        phone: '+374 11 22 33 44',
        branchId: 'b1',
        departmentId: 'd1',
        department: 'QA',
        isActive: true,
      });
    });

    it('coerces blank phone/branchId/departmentId/department to null', () => {
      const out = sanitizeEmployeeInput({
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        phone: '',
        branchId: '   ',
        departmentId: '   ',
        department: '',
      });
      expect(out.phone).toBeNull();
      expect(out.branchId).toBeNull();
      expect(out.departmentId).toBeNull();
      expect(out.department).toBeNull();
    });

    it('defaults isActive to true when undefined; respects explicit false', () => {
      expect(sanitizeEmployeeInput({}).isActive).toBe(true);
      expect(sanitizeEmployeeInput({ isActive: false }).isActive).toBe(false);
    });

    it('handles nullish input', () => {
      const out = sanitizeEmployeeInput(undefined);
      expect(out.firstName).toBe('');
      expect(out.lastName).toBe('');
      expect(out.email).toBe('');
      expect(out.isActive).toBe(true);
    });
  });

  describe('validateEmployeeInput', () => {
    const happy = {
      firstName: 'Khach',
      lastName: 'Z',
      email: 'khach@example.com',
      phone: null,
      branchId: 'b_main',
      departmentId: null,
      department: null,
      isActive: true,
    };

    it('accepts the happy-path object (branchId required in Wave 1.5)', () => {
      expect(validateEmployeeInput(happy)).toEqual({});
    });

    it('flags blank firstName as required', () => {
      expect(validateEmployeeInput({ ...happy, firstName: '   ' }).firstName).toBe(
        'errorRequired'
      );
    });

    it('flags blank lastName as required', () => {
      expect(validateEmployeeInput({ ...happy, lastName: '' }).lastName).toBe(
        'errorRequired'
      );
    });

    it('flags blank email as required', () => {
      expect(validateEmployeeInput({ ...happy, email: '' }).email).toBe(
        'errorRequired'
      );
    });

    it('flags malformed ASCII email as errorEmailInvalid', () => {
      expect(validateEmployeeInput({ ...happy, email: 'foo' }).email).toBe(
        'errorEmailInvalid'
      );
      expect(validateEmployeeInput({ ...happy, email: 'foo@bar' }).email).toBe(
        'errorEmailInvalid'
      );
    });

    it('flags non-ASCII email as errorEmailNonAscii', () => {
      // Cyrillic local-part triggers the non-ASCII screen first.
      expect(validateEmployeeInput({ ...happy, email: 'тест@example.com' }).email).toBe(
        'errorEmailNonAscii'
      );
    });

    it('flags missing branchId as errorBranchRequired (Wave 1.5)', () => {
      expect(validateEmployeeInput({ ...happy, branchId: null }).branchId).toBe(
        'errorBranchRequired'
      );
      expect(validateEmployeeInput({ ...happy, branchId: '' }).branchId).toBe(
        'errorBranchRequired'
      );
      expect(validateEmployeeInput({ ...happy, branchId: '   ' }).branchId).toBe(
        'errorBranchRequired'
      );
    });

    it('flags malformed phone but accepts a valid one', () => {
      expect(validateEmployeeInput({ ...happy, phone: 'abc' }).phone).toBe(
        'errorPhoneInvalid'
      );
      expect(
        validateEmployeeInput({ ...happy, phone: '+1 (212) 555-1234' }).phone
      ).toBeUndefined();
    });

    it('isEmployeeInputValid mirrors validateEmployeeInput', () => {
      expect(isEmployeeInputValid(emptyEmployeeInput())).toBe(false);
      expect(isEmployeeInputValid(happy)).toBe(true);
    });
  });

  describe('formatEmployeeName', () => {
    it('renders "Lastname Firstname"', () => {
      expect(formatEmployeeName({ firstName: 'Khach', lastName: 'Z' }, 'ru')).toBe(
        'Z Khach'
      );
    });

    it('returns empty string for null employee', () => {
      expect(formatEmployeeName(null, 'ru')).toBe('');
    });

    it('ignores any leftover middleName key on legacy records', () => {
      // formatEmployeeName no longer reads middleName even if a stale doc
      // happens to carry one.
      expect(
        formatEmployeeName(
          { firstName: 'Иван', lastName: 'Иванов', middleName: 'Иванович' },
          'ru'
        )
      ).toBe('Иванов Иван');
    });
  });

  describe('emailKey', () => {
    it('lowercases and trims the input', () => {
      expect(emailKey('  Foo@Bar.COM ')).toBe('foo@bar.com');
    });

    it('returns empty string for non-string input', () => {
      expect(emailKey(undefined)).toBe('');
      expect(emailKey(null)).toBe('');
      expect(emailKey(123)).toBe('');
    });
  });

  describe('error classes', () => {
    it('EmployeeEmailTakenError carries code and email message', () => {
      const e = new EmployeeEmailTakenError('foo@bar.com');
      expect(e).toBeInstanceOf(Error);
      expect(e.code).toBe('employee/email-taken');
      expect(e.message).toContain('foo@bar.com');
      expect(e.name).toBe('EmployeeEmailTakenError');
    });

    it('EmployeeHasActiveAssignmentsError carries the count', () => {
      const e = new EmployeeHasActiveAssignmentsError(3);
      expect(e).toBeInstanceOf(Error);
      expect(e.code).toBe('employee/has-active-assignments');
      expect(e.count).toBe(3);
      expect(e.name).toBe('EmployeeHasActiveAssignmentsError');
    });
  });
});
