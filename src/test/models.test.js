import { describe, it, expect } from 'vitest';

import {
  emptyModelInput,
  sanitizeModelInput,
  validateModelInput,
  isModelInputValid,
  ModelIdConflictError,
  ModelInUseError,
} from '@/domain/models.js';

describe('models — emptyModelInput', () => {
  it('returns blank fields and active=true', () => {
    expect(emptyModelInput()).toEqual({ brandId: '', name: '', isActive: true });
  });
});

describe('models — sanitizeModelInput', () => {
  it('trims fields and coerces isActive', () => {
    expect(
      sanitizeModelInput({ brandId: '  hp  ', name: '  EliteBook  ', isActive: 0 })
    ).toEqual({ brandId: 'hp', name: 'EliteBook', isActive: false });
  });

  it('defaults isActive to true when undefined', () => {
    expect(sanitizeModelInput({ brandId: 'hp', name: 'X' })).toEqual({
      brandId: 'hp',
      name: 'X',
      isActive: true,
    });
  });

  it('caps name length at 200', () => {
    const long = 'X'.repeat(250);
    expect(sanitizeModelInput({ brandId: 'hp', name: long }).name.length).toBe(200);
  });
});

describe('models — validateModelInput', () => {
  it('reports errorRequired when brandId is blank', () => {
    expect(validateModelInput({ brandId: '', name: 'X' })).toEqual({
      brandId: 'errorRequired',
    });
  });

  it('reports errorRequired when name is blank', () => {
    expect(validateModelInput({ brandId: 'hp', name: '' })).toEqual({
      name: 'errorRequired',
    });
  });

  it('reports both when both are blank', () => {
    expect(validateModelInput({ brandId: '', name: '' })).toEqual({
      brandId: 'errorRequired',
      name: 'errorRequired',
    });
  });

  it('returns no errors for a valid input', () => {
    expect(validateModelInput({ brandId: 'hp', name: 'EliteBook' })).toEqual({});
  });

  it('isModelInputValid is the inverse', () => {
    expect(isModelInputValid({ brandId: 'hp', name: 'X' })).toBe(true);
    expect(isModelInputValid({ brandId: '', name: 'X' })).toBe(false);
  });
});

describe('models — error classes', () => {
  it('ModelIdConflictError carries the id', () => {
    const err = new ModelIdConflictError('elitebook');
    expect(err.name).toBe('ModelIdConflictError');
    expect(err.id).toBe('elitebook');
  });

  it('ModelInUseError carries the count', () => {
    const err = new ModelInUseError('elitebook', { assetCount: 4 });
    expect(err.name).toBe('ModelInUseError');
    expect(err.assetCount).toBe(4);
  });
});
