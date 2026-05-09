/**
 * Wave-A Fix 1 & Fix 2 — domain validation tests.
 *
 * Fix 1: purchasePrice < 0 → errorNegativePrice.
 * Fix 2: warrantyStart in the past on CREATE → errorWarrantyStartPast.
 *        On EDIT (isEdit: true), existing past dates are kept without error.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateAssetInput, startOfTodayUTC } from '@/domain/assets.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal valid base input for single-lang category (no name needed). */
function baseInput(overrides = {}) {
  return {
    categoryId: 'device',
    subtypeId: 'device_laptop',
    condition: 'new',
    assignedTo: { kind: 'warehouse', id: null },
    branchId: 'b_main',
    ...overrides,
  };
}

const SINGLE_LANG = { requiresMultilang: false };

// ---------------------------------------------------------------------------
// Fix 1: negative purchasePrice
// ---------------------------------------------------------------------------

describe('validateAssetInput — Fix 1: negative purchasePrice', () => {
  it('rejects negative purchasePrice with errorNegativePrice', () => {
    const errs = validateAssetInput(baseInput({ purchasePrice: -1 }), {
      category: SINGLE_LANG,
    });
    expect(errs.purchasePrice).toBe('errorNegativePrice');
  });

  it('rejects a large negative price', () => {
    const errs = validateAssetInput(baseInput({ purchasePrice: -999999 }), {
      category: SINGLE_LANG,
    });
    expect(errs.purchasePrice).toBe('errorNegativePrice');
  });

  it('rejects -0.01', () => {
    const errs = validateAssetInput(baseInput({ purchasePrice: -0.01 }), {
      category: SINGLE_LANG,
    });
    expect(errs.purchasePrice).toBe('errorNegativePrice');
  });

  it('accepts zero (free items)', () => {
    const errs = validateAssetInput(baseInput({ purchasePrice: 0 }), {
      category: SINGLE_LANG,
    });
    expect(errs.purchasePrice).toBeUndefined();
  });

  it('accepts positive price', () => {
    const errs = validateAssetInput(baseInput({ purchasePrice: 1500.5 }), {
      category: SINGLE_LANG,
    });
    expect(errs.purchasePrice).toBeUndefined();
  });

  it('accepts null purchasePrice (price not recorded)', () => {
    const errs = validateAssetInput(baseInput({ purchasePrice: null }), {
      category: SINGLE_LANG,
    });
    expect(errs.purchasePrice).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fix 2: warrantyStart not in past on CREATE
// ---------------------------------------------------------------------------

describe('validateAssetInput — Fix 2: warrantyStart past guard (create)', () => {
  // We need a date that is in the future to pass and one in the past to fail.
  const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000); // tomorrow
  const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);   // yesterday

  it('rejects warrantyStart in the past on CREATE (default isEdit: false)', () => {
    const errs = validateAssetInput(
      baseInput({ condition: 'new', warrantyStart: PAST, warrantyEnd: FUTURE }),
      { category: SINGLE_LANG, isEdit: false },
    );
    expect(errs.warrantyStart).toBe('errorWarrantyStartPast');
  });

  it('accepts warrantyStart today or in the future on CREATE', () => {
    const errs = validateAssetInput(
      baseInput({ condition: 'new', warrantyStart: FUTURE }),
      { category: SINGLE_LANG, isEdit: false },
    );
    expect(errs.warrantyStart).toBeUndefined();
  });

  it('accepts warrantyStart exactly at startOfTodayUTC()', () => {
    const today = new Date(startOfTodayUTC());
    const errs = validateAssetInput(
      baseInput({ condition: 'new', warrantyStart: today }),
      { category: SINGLE_LANG, isEdit: false },
    );
    expect(errs.warrantyStart).toBeUndefined();
  });

  it('does NOT flag past warrantyStart on EDIT (isEdit: true)', () => {
    const errs = validateAssetInput(
      baseInput({ condition: 'new', warrantyStart: PAST, warrantyEnd: FUTURE }),
      { category: SINGLE_LANG, isEdit: true },
    );
    expect(errs.warrantyStart).toBeUndefined();
  });

  it('ignores warrantyStart when condition is used (sanitizer nulls it)', () => {
    const errs = validateAssetInput(
      baseInput({ condition: 'used', warrantyStart: PAST }),
      { category: SINGLE_LANG, isEdit: false },
    );
    // Sanitizer sets warrantyStart to null when condition='used', so no error.
    expect(errs.warrantyStart).toBeUndefined();
  });

  it('no error when warrantyStart is null (optional)', () => {
    const errs = validateAssetInput(
      baseInput({ condition: 'new', warrantyStart: null }),
      { category: SINGLE_LANG, isEdit: false },
    );
    expect(errs.warrantyStart).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// startOfTodayUTC helper sanity check
// ---------------------------------------------------------------------------

describe('startOfTodayUTC', () => {
  it('returns a number equal to midnight UTC today', () => {
    const ms = startOfTodayUTC();
    expect(typeof ms).toBe('number');
    const d = new Date(ms);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCMilliseconds()).toBe(0);
  });
});
