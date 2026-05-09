/**
 * Wave-A Fix 1 & Fix 2 — rules-mirror tests.
 *
 * Mirrors the purchasePrice >= 0 and warrantyStart >= request.time
 * constraints added to firestore.rules in the /assets create block.
 *
 * Pattern: same as assets.rulesMirror.test.js — JS predicates that
 * mirror the Firestore rule conditions exactly.
 */

import { describe, it, expect } from 'vitest';

// Mirror of the rules predicate for purchasePrice (Fix 1).
function isPurchasePriceValid(v) {
  if (v === null || v === undefined) return true;
  return typeof v === 'number' && v >= 0;
}

// Mirror of the rules predicate for warrantyStart on CREATE (Fix 2).
// In the real rules: warrantyStart >= request.time (server time).
// In the mirror: warrantyStart >= requestTime.
function isWarrantyStartValidForCreate(warrantyStart, requestTime) {
  if (warrantyStart === null || warrantyStart === undefined) return true;
  // Must be a timestamp (Date or TIMESTAMP_ sentinel) AND >= requestTime.
  if (typeof warrantyStart === 'string' && warrantyStart.startsWith('TIMESTAMP_')) {
    // Extract the embedded ISO string and compare.
    const ts = new Date(warrantyStart.replace('TIMESTAMP_', '')).valueOf();
    const rt = requestTime instanceof Date ? requestTime.valueOf() : requestTime;
    return ts >= rt;
  }
  if (warrantyStart instanceof Date) {
    const rt = requestTime instanceof Date ? requestTime.valueOf() : requestTime;
    return warrantyStart.valueOf() >= rt;
  }
  return false; // not a valid timestamp shape
}

function mockTimestamp(d) {
  return `TIMESTAMP_${d.toISOString()}`;
}

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);
const PAST   = new Date(Date.now() - 24 * 60 * 60 * 1000);
const TODAY  = new Date(
  (() => {
    const n = new Date();
    return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  })()
);
const REQUEST_TIME = TODAY; // pretend request arrives at start of today UTC

// ---------------------------------------------------------------------------
// Fix 1: purchasePrice >= 0
// ---------------------------------------------------------------------------

describe('rules mirror — Fix 1: purchasePrice >= 0', () => {
  it('accepts null (price not recorded)', () => {
    expect(isPurchasePriceValid(null)).toBe(true);
  });

  it('accepts 0 (free items)', () => {
    expect(isPurchasePriceValid(0)).toBe(true);
  });

  it('accepts positive number', () => {
    expect(isPurchasePriceValid(1500.5)).toBe(true);
  });

  it('rejects negative number', () => {
    expect(isPurchasePriceValid(-1)).toBe(false);
  });

  it('rejects -0.01', () => {
    expect(isPurchasePriceValid(-0.01)).toBe(false);
  });

  it('rejects string (not a number)', () => {
    // Rules: purchasePrice is number → string is not a number
    // JS mirror: typeof '100' === 'string', not number → false
    expect(isPurchasePriceValid('100')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fix 2: warrantyStart >= request.time on CREATE
// ---------------------------------------------------------------------------

describe('rules mirror — Fix 2: warrantyStart >= requestTime on CREATE', () => {
  it('accepts null (no warranty)', () => {
    expect(isWarrantyStartValidForCreate(null, REQUEST_TIME)).toBe(true);
  });

  it('accepts future timestamp', () => {
    expect(isWarrantyStartValidForCreate(mockTimestamp(FUTURE), REQUEST_TIME)).toBe(true);
  });

  it('accepts today (== requestTime)', () => {
    expect(isWarrantyStartValidForCreate(mockTimestamp(TODAY), REQUEST_TIME)).toBe(true);
  });

  it('rejects past timestamp', () => {
    expect(isWarrantyStartValidForCreate(mockTimestamp(PAST), REQUEST_TIME)).toBe(false);
  });

  it('rejects non-timestamp string', () => {
    // Not a valid timestamp shape → false
    expect(isWarrantyStartValidForCreate('not-a-date', REQUEST_TIME)).toBe(false);
  });

  it('accepts Date object in the future', () => {
    expect(isWarrantyStartValidForCreate(FUTURE, REQUEST_TIME)).toBe(true);
  });

  it('rejects Date object in the past', () => {
    expect(isWarrantyStartValidForCreate(PAST, REQUEST_TIME)).toBe(false);
  });
});
