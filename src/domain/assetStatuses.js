/**
 * Asset-statuses domain module.
 *
 * Pure JavaScript: no Firestore, no React, no I/O. Exports the entity
 * typedefs, base-status code constants, and validation/sanitization
 * helpers used by both the infra repository and the form layer.
 *
 * The status doc id is the stable code identifier (`warehouse`,
 * `assigned`, etc). This makes asset.statusId references readable in the
 * database AND lets the seed remain idempotent (same id on re-run).
 *
 * `isFinal` (irreversible) and `isAssignable` (can hold an active
 * assignment to a person/department) are the two boolean flags that the
 * lifecycle engine reads when deciding which transitions are legal. Color
 * is a Tier-4 hex string used by <StatusBadge>.
 */

import { SUPPORTED_LOCALES } from '@/i18n/namespaces.js';

/**
 * @typedef {Object} AssetStatusName
 * @property {string} ru
 * @property {string} en
 * @property {string} hy
 */

/**
 * @typedef {Object} AssetStatus
 * @property {string} statusId                 // doc id, e.g. 'warehouse'
 * @property {AssetStatusName} name
 * @property {string} color                    // ^#[0-9a-f]{6}$, Tier 4
 * @property {boolean} isFinal
 * @property {boolean} isAssignable
 * @property {number} sortOrder                // smaller renders first
 * @property {boolean} isActive
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */

/**
 * @typedef {Object} AssetStatusInput
 * @property {AssetStatusName} name
 * @property {string} [color]
 * @property {boolean} [isFinal]
 * @property {boolean} [isAssignable]
 * @property {number} [sortOrder]
 * @property {boolean} [isActive]
 */

/**
 * Stable code identifiers for the five base statuses seeded at install
 * time. Doc ids in `asset_statuses/{id}` use these codes verbatim so the
 * seed remains idempotent across re-runs.
 */
export const ASSET_STATUS_CODES = Object.freeze({
  WAREHOUSE: 'warehouse',
  ASSIGNED: 'assigned',
  IN_REPAIR: 'in_repair',
  WRITTEN_OFF: 'written_off',
  DISPOSED: 'disposed',
});

export const ASSET_STATUS_CODE_LIST = Object.freeze(
  Object.values(ASSET_STATUS_CODES)
);

/**
 * Default status code for newly created assets. Surfaced as a constant
 * so the asset-create flow (Step 2) and the Settings UI agree on which
 * row in the dropdown is preselected.
 */
export const DEFAULT_ASSET_STATUS_CODE = ASSET_STATUS_CODES.WAREHOUSE;

/**
 * Color hex shape. Matches a 7-character lowercase #rrggbb string.
 * Uppercase hex is normalized to lowercase by `sanitizeAssetStatusInput`
 * so storage stays canonical and the regex stays simple.
 */
export const COLOR_HEX_REGEX = /^#[0-9a-f]{6}$/;

/**
 * Build an empty name map with one entry per supported locale.
 * @returns {AssetStatusName}
 */
export function emptyAssetStatusName() {
  return SUPPORTED_LOCALES.reduce((acc, l) => ({ ...acc, [l]: '' }), {});
}

/**
 * Build a fresh form-state object for a brand-new status.
 * @returns {AssetStatusInput}
 */
export function emptyAssetStatusInput() {
  return {
    name: emptyAssetStatusName(),
    color: '#64748b',
    isFinal: false,
    isAssignable: false,
    sortOrder: 0,
    isActive: true,
  };
}

function isPlainString(value) {
  return typeof value === 'string';
}

function trimOrEmpty(value) {
  return isPlainString(value) ? value.trim() : '';
}

/**
 * Trim every string field, normalize null/undefined, and coerce booleans.
 * Does NOT validate — call validateAssetStatusInput() for that.
 *
 * Color is lowercased here so the form can accept uppercase typing but
 * storage stays canonical (the regex is lowercase-only by design).
 *
 * @param {AssetStatusInput} input
 * @returns {AssetStatusInput}
 */
export function sanitizeAssetStatusInput(input) {
  const raw = input ?? {};
  const rawName = raw.name ?? {};
  const name = SUPPORTED_LOCALES.reduce(
    (acc, l) => ({ ...acc, [l]: trimOrEmpty(rawName[l]) }),
    {}
  );

  const color = isPlainString(raw.color) ? raw.color.trim().toLowerCase() : '';

  let sortOrder = 0;
  if (typeof raw.sortOrder === 'number' && Number.isFinite(raw.sortOrder)) {
    sortOrder = Math.trunc(raw.sortOrder);
  } else if (isPlainString(raw.sortOrder) && raw.sortOrder.trim().length > 0) {
    const parsed = Number.parseInt(raw.sortOrder.trim(), 10);
    if (Number.isFinite(parsed)) sortOrder = parsed;
  }

  return {
    name,
    color,
    isFinal: raw.isFinal === undefined ? false : Boolean(raw.isFinal),
    isAssignable: raw.isAssignable === undefined ? false : Boolean(raw.isAssignable),
    sortOrder,
    isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
  };
}

/**
 * Validate a sanitized AssetStatusInput. Returns a record of `{ field: errorKey }`.
 * Empty object means "valid".
 *
 * Error keys are i18n keys in the `statuses` namespace.
 *
 * @param {AssetStatusInput} input
 * @returns {Record<string, string>}
 */
export function validateAssetStatusInput(input) {
  const errors = {};
  const sanitized = sanitizeAssetStatusInput(input);

  const missingLocales = SUPPORTED_LOCALES.filter(
    (l) => !sanitized.name[l] || sanitized.name[l].length === 0
  );
  if (missingLocales.length === SUPPORTED_LOCALES.length) {
    errors.name = 'errorRequired';
  } else if (missingLocales.length > 0) {
    errors.name = 'errorNameAllLocales';
  }

  if (!sanitized.color || sanitized.color.length === 0) {
    errors.color = 'errorRequired';
  } else if (!COLOR_HEX_REGEX.test(sanitized.color)) {
    errors.color = 'errorColorFormat';
  }

  return errors;
}

/**
 * True if the input has no validation errors.
 * @param {AssetStatusInput} input
 */
export function isAssetStatusInputValid(input) {
  return Object.keys(validateAssetStatusInput(input)).length === 0;
}
