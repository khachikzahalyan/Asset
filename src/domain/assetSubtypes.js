/**
 * Asset Sub-types domain module.
 *
 * Sub-types refine a category. Picking "Device" then "Laptop" is far
 * better UX than free-typing "Laptop" into the asset name field every
 * time. The catalog is admin-editable, lives at `/asset_subtypes/{id}`,
 * and is seeded once on first super_admin sign-in by
 * `StatusesAndCategoriesBootstrap`.
 *
 * Schema decisions:
 *   - `id` (doc id) is stable: `${categoryId}_${slug}` (e.g. `device_laptop`).
 *   - `name` is Tier 2 multi-lang `{ ru, en, hy }`. For categories where
 *     `requiresMultilang === false` (Device, License) the sanitizer
 *     mirrors the single string into all three locales — same convention
 *     as `firestoreCategoryRepository.js`.
 *   - `attachableTo` is a string[] subset of ASSIGNMENT_KIND_LIST. It
 *     declares which holder kinds are valid for assets of this sub-type
 *     (Branch / Warehouse / Employee / Department / Asset). The Super Admin
 *     configures it in the sub-type form; sub-types may narrow the parent
 *     category's `attachableTo` but never widen it.
 *   - `isActive` is a soft-delete flag; hard-delete is forbidden by rules.
 *
 * Pure JavaScript: no Firestore, no React. Repository adapter and form
 * layer consume these helpers.
 */

import { SUPPORTED_LOCALES } from '@/i18n/namespaces.js';
import { ASSIGNMENT_KIND_LIST } from '@/domain/assets.js';

// ---------------------------------------------------------------------------
// Typedefs
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} AssetSubtypeName
 * @property {string} ru
 * @property {string} en
 * @property {string} hy
 */

/**
 * @typedef {Object} AssetSubtype
 * @property {string} subtypeId                    // mirrors doc id
 * @property {string} categoryId                   // FK -> categories
 * @property {AssetSubtypeName} name               // always stored as 3-locale map
 * @property {boolean} requiresMultilang           // mirrors category convention
 * @property {string[]} attachableTo               // subset of ASSIGNMENT_KIND_LIST
 * @property {number} sortOrder
 * @property {boolean} isActive
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */

/**
 * @typedef {Object} AssetSubtypeInput
 * @property {string} categoryId
 * @property {AssetSubtypeName | string} [name]
 * @property {boolean} [requiresMultilang]
 * @property {string[]} [attachableTo]
 * @property {number} [sortOrder]
 * @property {boolean} [isActive]
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trimOrEmpty(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function emptyName() {
  return SUPPORTED_LOCALES.reduce((acc, l) => ({ ...acc, [l]: '' }), {});
}

/**
 * Form-state seed.
 * @returns {AssetSubtypeInput}
 */
export function emptyAssetSubtypeInput() {
  return {
    categoryId: '',
    name: emptyName(),
    requiresMultilang: false,
    attachableTo: [],
    sortOrder: 0,
    isActive: true,
  };
}

/**
 * Trim, normalize, and reshape into the canonical persistence form. Does
 * not validate.
 *
 * @param {AssetSubtypeInput} input
 * @returns {AssetSubtypeInput}
 */
export function sanitizeAssetSubtypeInput(input) {
  const raw = input ?? {};
  const requiresMultilang = Boolean(raw.requiresMultilang);

  // ---- name ----
  let name;
  if (requiresMultilang) {
    const m = raw.name && typeof raw.name === 'object' ? raw.name : {};
    name = SUPPORTED_LOCALES.reduce(
      (acc, l) => ({ ...acc, [l]: trimOrEmpty(m[l]) }),
      {}
    );
  } else {
    let single;
    if (raw.name && typeof raw.name === 'object') {
      const m = raw.name;
      single = trimOrEmpty(m.ru) || trimOrEmpty(m.en) || trimOrEmpty(m.hy) || '';
    } else {
      single = trimOrEmpty(raw.name);
    }
    name = SUPPORTED_LOCALES.reduce(
      (acc, l) => ({ ...acc, [l]: single }),
      {}
    );
  }

  // ---- attachableTo ----
  const attachableTo = Array.isArray(raw.attachableTo)
    ? Array.from(
        new Set(
          raw.attachableTo.filter(
            (k) => typeof k === 'string' && ASSIGNMENT_KIND_LIST.includes(k)
          )
        )
      )
    : [];

  // ---- sortOrder ----
  let sortOrder = 0;
  if (typeof raw.sortOrder === 'number' && Number.isFinite(raw.sortOrder)) {
    sortOrder = Math.trunc(raw.sortOrder);
  } else if (typeof raw.sortOrder === 'string') {
    const parsed = Number.parseInt(raw.sortOrder.trim(), 10);
    if (Number.isFinite(parsed)) sortOrder = parsed;
  }

  return {
    categoryId: trimOrEmpty(raw.categoryId),
    name,
    requiresMultilang,
    attachableTo,
    sortOrder,
    isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
  };
}

/**
 * Validate sanitized input. Returns `{ field: errorKey }`.
 *
 * Error keys are i18n keys in the `assets` namespace.
 *
 * @param {AssetSubtypeInput} input
 * @param {{ category?: { attachableTo?: string[] } | null }} [opts]
 *   Optional parent-category context. When provided, the sub-type's
 *   `attachableTo` must be a subset of `opts.category.attachableTo`.
 * @returns {Record<string, string>}
 */
export function validateAssetSubtypeInput(input, opts = {}) {
  const errors = {};
  const s = sanitizeAssetSubtypeInput(input);

  if (!s.categoryId) {
    errors.categoryId = 'errorRequired';
  }

  // name
  const map = s.name;
  if (s.requiresMultilang) {
    const filled = SUPPORTED_LOCALES.filter((l) => map[l] && map[l].length > 0);
    if (filled.length === 0) {
      errors.name = 'errorRequired';
    } else if (filled.length < SUPPORTED_LOCALES.length) {
      errors.name = 'errorNameAllLocales';
    }
  } else {
    const anyFilled = SUPPORTED_LOCALES.some(
      (l) => map[l] && map[l].length > 0
    );
    if (!anyFilled) errors.name = 'errorRequired';
  }

  // attachableTo: must be non-empty; if a parent-category is supplied, must
  // be a subset of the parent's allowed kinds (sub-types narrow, never widen).
  if (!s.attachableTo || s.attachableTo.length === 0) {
    errors.attachableTo = 'errorAttachableEmpty';
  } else if (
    opts.category?.attachableTo &&
    Array.isArray(opts.category.attachableTo)
  ) {
    const allowed = new Set(opts.category.attachableTo);
    const widens = s.attachableTo.some((k) => !allowed.has(k));
    if (widens) errors.attachableTo = 'errorAttachableNotInCategory';
  }

  return errors;
}

export function isAssetSubtypeInputValid(input, opts = {}) {
  return Object.keys(validateAssetSubtypeInput(input, opts)).length === 0;
}

// ---------------------------------------------------------------------------
// Custom error classes
// ---------------------------------------------------------------------------

export class AssetSubtypeIdConflictError extends Error {
  constructor(id) {
    super(`Asset subtype id already in use: ${id}`);
    this.name = 'AssetSubtypeIdConflictError';
    this.code = 'asset_subtype/id-conflict';
    this.id = id;
  }
}

export class AssetSubtypeInactiveError extends Error {
  constructor(id) {
    super(`Asset subtype ${id} is inactive or missing`);
    this.name = 'AssetSubtypeInactiveError';
    this.code = 'asset_subtype/inactive';
    this.id = id;
  }
}

/**
 * Thrown by the asset-subtype repository when a hard-delete is attempted
 * on a subtype that is still referenced by at least one asset. The UI
 * surfaces the count via the `errorSubtypeReferenced` translation so
 * the operator knows what to clean up before deleting.
 *
 * Same race-window note as CategoryReferencedError applies: pre-flight
 * stops the common case; the rare race is recoverable from audit history.
 */
export class AssetSubtypeReferencedError extends Error {
  /**
   * @param {string} id
   * @param {{ assetCount: number }} counts
   */
  constructor(id, counts) {
    super(
      `Asset subtype ${id} is referenced by ${counts.assetCount} assets`
    );
    this.name = 'AssetSubtypeReferencedError';
    this.code = 'asset_subtype/referenced';
    this.id = id;
    this.assetCount = counts.assetCount;
  }
}
