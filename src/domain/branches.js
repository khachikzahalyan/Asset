/**
 * Branches domain module.
 *
 * Pure JavaScript: no Firestore, no React, no I/O. Exports the entity shape,
 * type constants, and validation/sanitization helpers used by both the
 * infra repository and the form layer.
 */

import { SUPPORTED_LOCALES } from '@/i18n/namespaces.js';

/**
 * @typedef {Object} BranchName
 * @property {string} ru
 * @property {string} en
 * @property {string} hy
 */

/**
 * @typedef {Object} Branch
 * @property {string} branchId
 * @property {BranchName} name
 * @property {'branch'|'warehouse'} type
 * @property {string} address
 * @property {string|null} responsibleEmployeeId
 * @property {boolean} isActive
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */

/**
 * @typedef {Object} BranchInput
 * @property {BranchName} name
 * @property {'branch'|'warehouse'} type
 * @property {string} [address]
 * @property {string|null} [responsibleEmployeeId]
 * @property {boolean} [isActive]
 */

export const BRANCH_TYPES = Object.freeze({
  BRANCH: 'branch',
  WAREHOUSE: 'warehouse',
});

export const BRANCH_TYPE_LIST = Object.freeze(Object.values(BRANCH_TYPES));

/**
 * Build an empty BranchName object with one entry per supported locale.
 * @returns {BranchName}
 */
export function emptyBranchName() {
  return SUPPORTED_LOCALES.reduce((acc, l) => ({ ...acc, [l]: '' }), {});
}

/**
 * Build a fresh form-state object for a brand-new branch.
 * @returns {BranchInput}
 */
export function emptyBranchInput() {
  return {
    name: emptyBranchName(),
    type: BRANCH_TYPES.BRANCH,
    address: '',
    responsibleEmployeeId: null,
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
 * Does NOT validate — call validateBranchInput() for that.
 *
 * @param {BranchInput} input
 * @returns {BranchInput}
 */
export function sanitizeBranchInput(input) {
  const raw = input ?? {};
  const rawName = raw.name ?? {};
  const name = SUPPORTED_LOCALES.reduce(
    (acc, l) => ({ ...acc, [l]: trimOrEmpty(rawName[l]) }),
    {}
  );
  const responsible = raw.responsibleEmployeeId;
  return {
    name,
    type: BRANCH_TYPE_LIST.includes(raw.type) ? raw.type : BRANCH_TYPES.BRANCH,
    address: trimOrEmpty(raw.address),
    responsibleEmployeeId:
      isPlainString(responsible) && responsible.trim().length > 0
        ? responsible.trim()
        : null,
    isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
  };
}

/**
 * Validate a sanitized BranchInput. Returns a record of `{ field: errorKey }`.
 * Empty object means "valid".
 *
 * Error keys are i18n keys in the `branches` namespace.
 *
 * @param {BranchInput} input
 * @returns {Record<string, string>}
 */
export function validateBranchInput(input) {
  const errors = {};
  const sanitized = sanitizeBranchInput(input);

  const missingLocales = SUPPORTED_LOCALES.filter(
    (l) => !sanitized.name[l] || sanitized.name[l].length === 0
  );
  if (missingLocales.length === SUPPORTED_LOCALES.length) {
    errors.name = 'errorRequired';
  } else if (missingLocales.length > 0) {
    errors.name = 'errorNameAllLocales';
  }

  if (!BRANCH_TYPE_LIST.includes(sanitized.type)) {
    errors.type = 'errorRequired';
  }

  return errors;
}

/**
 * True if the input has no validation errors.
 * @param {BranchInput} input
 */
export function isBranchInputValid(input) {
  return Object.keys(validateBranchInput(input)).length === 0;
}
