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
import { ASSIGNMENT_KIND_LIST } from '@/domain/assets.js';

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
 * @property {string[]} attachableTo
 *   Subset of ASSIGNMENT_KIND_LIST. Default holder targets offered when a
 *   sub-type is created under this category. Sub-types may narrow this set
 *   but never widen it.
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
 * @property {string[]} [attachableTo]
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

/**
 * Thrown by the categories repository when the caller-supplied stable id
 * collides with an existing doc. The UI catches this and displays the
 * `errorIdConflict` translation, which prompts the operator to retry with
 * a different name (the slug-derivation will then yield a different id).
 *
 * The repository never auto-suffixes silently — that would leak the slug
 * collision into the stored id (`device_2`) without surfacing it to the
 * user. The Settings page handles auto-suffixing client-side and shows
 * the about-to-be-committed id live so the operator stays in control.
 */
export class CategoryIdConflictError extends Error {
  constructor(id) {
    super(`Category id already exists: ${id}`);
    this.name = 'CategoryIdConflictError';
    this.id = id;
  }
}

/**
 * Thrown by the categories repository when a hard-delete is attempted on a
 * category that is still referenced by at least one asset. Sub-types are
 * NOT a blocker: deleting a category cascades the delete to every subtype
 * under it (in the same transaction) — operators told us in 2026-05-08
 * that this is the natural mental model ("если удалить Категорию все
 * под категории удалятся, это логично"). Assets remain a blocker because
 * they carry real-world inventory data and silently orphaning their
 * `categoryId` field would corrupt history.
 *
 * Note on the race window: this is a pre-flight check; a concurrent
 * write could theoretically slip a new asset into the category after we
 * count and before we delete. That's accepted because (a) the
 * category-pick path enforces `isActive === true` on the category at
 * write time, and (b) deactivating before deletion is the recommended
 * operator workflow. The pre-flight stops the common case; the rare
 * race remains recoverable from audit history.
 */
export class CategoryReferencedError extends Error {
  /**
   * @param {string} id
   * @param {{ assetCount: number }} counts
   */
  constructor(id, counts) {
    super(`Category ${id} is referenced by ${counts.assetCount} assets`);
    this.name = 'CategoryReferencedError';
    this.code = 'category/referenced';
    this.id = id;
    this.assetCount = counts.assetCount;
  }
}

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
    attachableTo: [],
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

  const attachableTo = Array.isArray(raw.attachableTo)
    ? Array.from(
        new Set(
          raw.attachableTo.filter(
            (k) => typeof k === 'string' && ASSIGNMENT_KIND_LIST.includes(k)
          )
        )
      )
    : [];

  return {
    name,
    inventoryCodePrefix: prefixRaw,
    requiresMultilang,
    attachableTo,
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

  if (!sanitized.attachableTo || sanitized.attachableTo.length === 0) {
    errors.attachableTo = 'errorAttachableEmpty';
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
