/**
 * Categories domain module.
 *
 * Pure JavaScript: no Firestore, no React, no I/O. Exports the entity
 * typedefs, base-category code constants, and validation/sanitization
 * helpers used by both the infra repository and the form layer.
 *
 * Storage shape decision (2026-05-07): the `name` field is ALWAYS a
 * multi-locale `{ ru, en, hy }` map, even for single-language categories.
 * For categories whose `requiresMultilang` flag is false the seed writes
 * the same string into all three locale keys so downstream `localize()`
 * calls work uniformly. The flag drives the FORM rendering (single
 * <Input> vs <MultiLangInput>) but never the storage shape.
 *
 * Inventory-code prefix: validated as `^[A-Z0-9]+$` (uppercase letters
 * and/or digits, no slash, no lowercase). Editable later in the Settings
 * UI ONLY when no asset references the category — that gate lives in
 * the asset-create flow and the (Phase 1.5) Settings UI, not in this file.
 */

import { SUPPORTED_LOCALES } from '@/i18n/namespaces.js';

/**
 * @typedef {Object} CategoryName
 * @property {string} ru
 * @property {string} en
 * @property {string} hy
 */

/**
 * @typedef {Object} Category
 * @property {string} categoryId
 * @property {CategoryName} name
 * @property {string} inventoryCodePrefix     // ^[A-Z0-9]+$, Tier 4
 * @property {boolean} requiresMultilang
 *   When true the form renders a <MultiLangInput> for `name`; when false
 *   it renders a single <Input> and writes the same string into ru/en/hy.
 * @property {boolean} isActive
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */

/**
 * @typedef {Object} CategoryInput
 * @property {CategoryName} name
 * @property {string} [inventoryCodePrefix]
 * @property {boolean} [requiresMultilang]
 * @property {boolean} [isActive]
 */

/**
 * Stable code identifiers for the three base categories seeded at install
 * time. Doc ids in `categories/{id}` use these codes verbatim so the seed
 * remains idempotent across re-runs.
 */
export const CATEGORY_CODES = Object.freeze({
  DEVICE: 'device',
  FURNITURE: 'furniture',
  LICENSE: 'license',
});

export const CATEGORY_CODE_LIST = Object.freeze(Object.values(CATEGORY_CODES));

/**
 * Inventory-code prefix shape. Matches uppercase ASCII letters and/or
 * digits, length >=1, no slash, no lowercase. The slash is reserved as
 * the prefix/number separator in the rendered inventory code (e.g.
 * `400/000123`).
 */
export const INVENTORY_PREFIX_REGEX = /^[A-Z0-9]+$/;

/**
 * Build an empty CategoryName with one entry per supported locale.
 * @returns {CategoryName}
 */
export function emptyCategoryName() {
  return SUPPORTED_LOCALES.reduce((acc, l) => ({ ...acc, [l]: '' }), {});
}

/**
 * Build a fresh form-state object for a brand-new category. The form
 * defaults to multi-language entry; toggling the flag off in the form
 * collapses the three inputs into one and copies that single value
 * across the three locale keys at submit time.
 *
 * @returns {CategoryInput}
 */
export function emptyCategoryInput() {
  return {
    name: emptyCategoryName(),
    inventoryCodePrefix: '',
    requiresMultilang: true,
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
 * Does NOT validate — call validateCategoryInput() for that.
 *
 * Special handling: when `requiresMultilang` is false, the FIRST non-empty
 * locale value (priority ru -> en -> hy) is mirrored into the other two
 * locale keys so the storage shape stays uniform. If all three are empty
 * the result keeps three empty strings (validation will catch it).
 *
 * The prefix is uppercased here so the form can accept lowercase typing
 * but storage stays canonical.
 *
 * @param {CategoryInput} input
 * @returns {CategoryInput}
 */
export function sanitizeCategoryInput(input) {
  const raw = input ?? {};
  const rawName = raw.name ?? {};
  const trimmedName = SUPPORTED_LOCALES.reduce(
    (acc, l) => ({ ...acc, [l]: trimOrEmpty(rawName[l]) }),
    {}
  );
  const requiresMultilang =
    raw.requiresMultilang === undefined ? true : Boolean(raw.requiresMultilang);

  let name = trimmedName;
  if (!requiresMultilang) {
    // Mirror the first non-empty locale value across all three keys.
    const mirror =
      trimmedName.ru || trimmedName.en || trimmedName.hy || '';
    name = SUPPORTED_LOCALES.reduce((acc, l) => ({ ...acc, [l]: mirror }), {});
  }

  const prefixRaw = isPlainString(raw.inventoryCodePrefix)
    ? raw.inventoryCodePrefix.trim().toUpperCase()
    : '';

  return {
    name,
    inventoryCodePrefix: prefixRaw,
    requiresMultilang,
    isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
  };
}

/**
 * Validate a sanitized CategoryInput. Returns a record of `{ field: errorKey }`.
 * Empty object means "valid".
 *
 * Error keys are i18n keys in the `categories` namespace.
 *
 * @param {CategoryInput} input
 * @returns {Record<string, string>}
 */
export function validateCategoryInput(input) {
  const errors = {};
  const sanitized = sanitizeCategoryInput(input);

  if (sanitized.requiresMultilang) {
    const missingLocales = SUPPORTED_LOCALES.filter(
      (l) => !sanitized.name[l] || sanitized.name[l].length === 0
    );
    if (missingLocales.length === SUPPORTED_LOCALES.length) {
      errors.name = 'errorRequired';
    } else if (missingLocales.length > 0) {
      errors.name = 'errorNameAllLocales';
    }
  } else {
    // Single-language category: at least one locale must be filled.
    // Sanitize already mirrored the first non-empty value across all three,
    // so checking ru is sufficient.
    if (!sanitized.name.ru || sanitized.name.ru.length === 0) {
      errors.name = 'errorRequired';
    }
  }

  if (!sanitized.inventoryCodePrefix || sanitized.inventoryCodePrefix.length === 0) {
    errors.inventoryCodePrefix = 'errorRequired';
  } else if (!INVENTORY_PREFIX_REGEX.test(sanitized.inventoryCodePrefix)) {
    errors.inventoryCodePrefix = 'errorPrefixFormat';
  }

  return errors;
}

/**
 * True if the input has no validation errors.
 * @param {CategoryInput} input
 */
export function isCategoryInputValid(input) {
  return Object.keys(validateCategoryInput(input)).length === 0;
}
