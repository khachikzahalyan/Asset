import { describe, it, expect } from 'vitest';

import { isoDateUTC } from '@/lib/format/dateUtc.js';

describe('isoDateUTC', () => {
  it('returns empty string for null/undefined', () => {
    expect(isoDateUTC(null)).toBe('');
    expect(isoDateUTC(undefined)).toBe('');
  });

  it('formats a native Date as yyyy-mm-dd in UTC', () => {
    const d = new Date(Date.UTC(2026, 4, 7, 23, 30, 0)); // 2026-05-07 23:30 UTC
    expect(isoDateUTC(d)).toBe('2026-05-07');
  });

  it('uses UTC, not local time', () => {
    // 2026-05-07T01:00 UTC is still 2026-05-07 in UTC even if local
    // time zone is e.g. UTC-04:00 (where it would render as 2026-05-06).
    const d = new Date(Date.UTC(2026, 4, 7, 1, 0, 0));
    expect(isoDateUTC(d)).toBe('2026-05-07');
  });

  it('formats a Firestore Timestamp-like via toDate()', () => {
    const ts = { toDate: () => new Date(Date.UTC(2026, 0, 1)) };
    expect(isoDateUTC(ts)).toBe('2026-01-01');
  });

  it('parses an ISO string', () => {
    expect(isoDateUTC('2026-05-07T12:34:56Z')).toBe('2026-05-07');
  });

  it('parses an epoch number', () => {
    expect(isoDateUTC(Date.UTC(2026, 4, 7))).toBe('2026-05-07');
  });

  it('returns empty string for an invalid Date', () => {
    expect(isoDateUTC(new Date('not a date'))).toBe('');
  });

  it('returns empty string for an unparseable string', () => {
    expect(isoDateUTC('not a date')).toBe('');
  });

  it('zero-pads single-digit month and day', () => {
    expect(isoDateUTC(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01-05');
  });
});
