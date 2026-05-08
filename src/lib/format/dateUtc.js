/**
 * Shared date-formatting helpers used across the app for displaying or
 * exporting dates in a stable, locale-agnostic form.
 *
 * Pure functions: no Firestore, no React, no I/O. Safe to import from any
 * layer (domain, infra, lib/excel, components).
 *
 * @module lib/format/dateUtc
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Format any date-ish value (Firestore Timestamp, plain Date, ISO string,
 * number, null) as `yyyy-mm-dd` in UTC. Returns '' for nullish or invalid
 * inputs.
 *
 * Why UTC: list-view dates and Excel exports must round-trip identically
 * regardless of the viewer's local time zone. Showing one user "2026-05-07"
 * and another "2026-05-06" for the same Firestore write would be a defect.
 *
 * Accepted shapes:
 *   - Firestore Timestamp (`{ toDate(): Date }`)
 *   - native Date
 *   - ISO 8601 string parseable by `new Date(...)`
 *   - epoch number (ms)
 *   - null / undefined → ''
 *
 * @param {unknown} input
 * @returns {string} `yyyy-mm-dd` in UTC, or '' if input is invalid/missing.
 */
export function isoDateUTC(input) {
  if (input == null) return '';
  let d = input;
  if (typeof d === 'object' && typeof d.toDate === 'function') {
    d = d.toDate();
  } else if (typeof d === 'string' || typeof d === 'number') {
    d = new Date(d);
  }
  if (!(d instanceof Date) || Number.isNaN(d.valueOf())) return '';
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
