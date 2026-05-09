/**
 * Assets domain module.
 *
 * Pure JavaScript: no Firestore, no React, no I/O. Exports the asset
 * entity typedefs, the `AssignedTo` discriminated union, the
 * sanitize/validate helpers, and the custom error class used by the
 * repository adapter and the form layer.
 *
 * Storage model decisions (Wave 1, Step 2):
 *   - `inventoryCode` is `${prefix}/${number}` with NO zero-padding,
 *     uppercase prefix, integer number. Immutable post-create. Allocated
 *     atomically by the repository via `category_counters/{categoryId}`.
 *   - `name` is Tier 3 free text. When the asset's category has
 *     `requiresMultilang === true` the form renders <MultiLangInput> and
 *     storage holds a `{ ru, en, hy }` map; otherwise the form renders a
 *     single <Input> and storage holds a plain string. The rules block
 *     accepts either shape (`isValidAssetName`).
 *   - `brand`, `model`, `serialNumber` are Tier 4 ASCII single strings,
 *     all optional. ASCII-only is enforced both in the form (via
 *     `errorAsciiOnly`) and in firestore.rules (`isAsciiOrNull`).
 *   - `assignedTo` is a discriminated union: warehouse | employee | branch
 *     | department. Warehouse has `id: null`; the other three have a
 *     non-empty `id`. The form's "Куда" radio drives this union.
 *   - `branchId` is the *location* of the asset. Required when the asset
 *     is in warehouse mode (which warehouse?) or branch mode (which
 *     branch is it parked at?). Cleared to null in employee or department
 *     modes (the asset is "with a person").
 *   - `statusId` is an FK to `asset_statuses` and defaults to
 *     `'warehouse'` on create. Status changes go through a dedicated
 *     `setStatus` repository method (audit `action: 'status_change'`).
 *   - `isActive` is a soft-archive flag, true at create. Hard-delete is
 *     forbidden by rules. Final statuses (Written Off, Disposed) are how
 *     assets exit the active inventory; this flag is reserved for future
 *     "hide from default views" work.
 *
 * Wave 2+ (NOT in this module):
 *   - Per-category dynamic attributes (RAM, CPU, etc) — separate
 *     `category_attributes` + `asset_attribute_values` collections.
 *   - Status-change history subcollection — see
 *     `/asset_status_log/{assetId}` TODO in the repository layer.
 *   - Photo / scan uploads.
 *   - Repairs and component upgrades.
 */

import { SUPPORTED_LOCALES } from '@/i18n/namespaces.js';
import { DEFAULT_ASSET_STATUS_CODE } from '@/domain/assetStatuses.js';
import { localize } from '@/lib/localize.js';

// ---------------------------------------------------------------------------
// Discriminated union for the holder of an asset.
// ---------------------------------------------------------------------------

export const ASSIGNMENT_KINDS = Object.freeze({
  WAREHOUSE: 'warehouse',
  EMPLOYEE: 'employee',
  BRANCH: 'branch',
  DEPARTMENT: 'department',
  ASSET: 'asset',
});

export const ASSIGNMENT_KIND_LIST = Object.freeze(
  Object.values(ASSIGNMENT_KINDS)
);

/**
 * @typedef {{ kind: 'warehouse', id: null }
 *           | { kind: 'employee', id: string }
 *           | { kind: 'branch', id: string }
 *           | { kind: 'department', id: string }
 *           | { kind: 'asset', id: string }} AssignedTo
 */

/**
 * @typedef {Object} AssetName
 * @property {string} ru
 * @property {string} en
 * @property {string} hy
 */

/**
 * @typedef {Object} Asset
 * @property {string} assetId                                // mirrors doc id
 * @property {string|null} inventoryCode                     // ^[A-Z0-9]+/[0-9]+$ OR null when category.assignsInventoryCode === false. Immutable post-create.
 * @property {string} categoryId                             // FK -> categories, immutable
 * @property {string} subtypeId                              // FK -> asset_subtypes
 * @property {string} statusId                               // FK -> asset_statuses
 * @property {AssetName | string | null} name                // Tier 3 multi-lang map | string | null when category.requiresMultilang === false
 * @property {string|null} brandId                           // FK -> brands. null for Furniture.
 * @property {string|null} modelId                           // FK -> models. null when brandId is null. If non-null, model.brandId must equal asset.brandId.
 * @property {string|null} serialNumber                      // Tier 4, ASCII, optional
 * @property {string|null} branchId                          // Location FK
 * @property {AssignedTo} assignedTo
 * @property {string|null} notes                             // Tier 3, optional
 * @property {import('firebase/firestore').Timestamp|null} purchaseDate
 * @property {number|null} purchasePrice
 * @property {('new'|'used')} condition
 * @property {import('firebase/firestore').Timestamp|null} warrantyStart
 * @property {import('firebase/firestore').Timestamp|null} warrantyEnd
 * @property {('personal'|'business'|'enterprise'|null)} licenseType   // license categories only
 * @property {import('firebase/firestore').Timestamp|null} subscribedAt  // license categories only
 * @property {import('firebase/firestore').Timestamp|null} expiresAt    // license categories only
 * @property {boolean} isActive
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */

/**
 * @typedef {Object} AssetInput
 * @property {string} categoryId
 * @property {string} [subtypeId]
 * @property {AssetName | string | null} [name]
 * @property {string|null} [brandId]
 * @property {string|null} [modelId]
 * @property {string|null} [serialNumber]
 * @property {string} [statusId]
 * @property {AssignedTo} [assignedTo]
 * @property {string|null} [branchId]
 * @property {string|null} [notes]
 * @property {Date|null} [purchaseDate]
 * @property {number|null} [purchasePrice]
 * @property {('new'|'used')} [condition]
 * @property {Date|null} [warrantyStart]
 * @property {Date|null} [warrantyEnd]
 * @property {('personal'|'business'|'enterprise'|null)} [licenseType]
 * @property {Date|null} [subscribedAt]
 * @property {Date|null} [expiresAt]
 * @property {boolean} [isActive]
 */

// ---------------------------------------------------------------------------
// Validation regular expressions
// ---------------------------------------------------------------------------

/** Inventory code shape: `PREFIX/NUMBER`. */
export const INVENTORY_CODE_REGEX = /^[A-Z0-9]+\/[0-9]+$/;

/** Quick screen for any non-ASCII codepoint. */
const NON_ASCII_REGEX = /[^\x00-\x7F]/;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isPlainString(value) {
  return typeof value === 'string';
}

function trimOrEmpty(value) {
  return isPlainString(value) ? value.trim() : '';
}

function trimOrNull(value) {
  if (!isPlainString(value)) return null;
  const t = value.trim();
  return t.length === 0 ? null : t;
}

/**
 * Build an empty multi-locale name map.
 * @returns {AssetName}
 */
export function emptyAssetName() {
  return SUPPORTED_LOCALES.reduce((acc, l) => ({ ...acc, [l]: '' }), {});
}

/**
 * Build a fresh form-state object for a brand-new asset.
 *
 * Defaults: warehouse mode (no holder), default status, empty name, all
 * optional fields null. The form will overlay the right `name` shape
 * once a category is picked.
 *
 * @returns {AssetInput}
 */
export function emptyAssetInput() {
  return {
    categoryId: '',
    subtypeId: '',
    name: '',
    brandId: null,
    modelId: null,
    serialNumber: null,
    statusId: DEFAULT_ASSET_STATUS_CODE,
    assignedTo: { kind: ASSIGNMENT_KINDS.WAREHOUSE, id: null },
    branchId: null,
    notes: null,
    purchaseDate: null,
    purchasePrice: null,
    condition: 'new',
    warrantyStart: null,
    warrantyEnd: null,
    licenseType: null,
    subscribedAt: null,
    expiresAt: null,
    isActive: true,
  };
}

/**
 * Trim every string field, normalize null/undefined, and coerce booleans.
 * Reshapes `name` based on whether the category demands a multi-locale
 * map. Coerces `assignedTo` into a valid discriminated-union shape.
 * Forces `branchId` to null in employee / department modes.
 *
 * Does NOT validate — call validateAssetInput() for that.
 *
 * @param {AssetInput} input
 * @param {{ category?: { requiresMultilang: boolean } | null }} [opts]
 * @returns {AssetInput}
 */
export function sanitizeAssetInput(input, opts = {}) {
  const raw = input ?? {};
  const category = opts.category ?? null;
  const wantsMultilang = Boolean(category?.requiresMultilang);
  const isLicense = (raw.categoryId ?? '').trim() === 'license';

  // ---- name ----
  let name;
  if (category && category.requiresMultilang === false) {
    name = null;
  } else if (wantsMultilang) {
    const rawName = raw.name && typeof raw.name === 'object' ? raw.name : {};
    name = SUPPORTED_LOCALES.reduce(
      (acc, l) => ({ ...acc, [l]: trimOrEmpty(rawName[l]) }),
      {}
    );
  } else {
    if (raw.name && typeof raw.name === 'object') {
      const m = raw.name;
      name = trimOrEmpty(m.ru) || trimOrEmpty(m.en) || trimOrEmpty(m.hy) || '';
    } else {
      name = trimOrEmpty(raw.name);
    }
  }

  // ---- assignedTo ----
  const rawAt = raw.assignedTo && typeof raw.assignedTo === 'object'
    ? raw.assignedTo
    : { kind: ASSIGNMENT_KINDS.WAREHOUSE, id: null };
  let kind = ASSIGNMENT_KIND_LIST.includes(rawAt.kind)
    ? rawAt.kind
    : ASSIGNMENT_KINDS.WAREHOUSE;
  let id = trimOrNull(rawAt.id);
  if (kind === ASSIGNMENT_KINDS.WAREHOUSE) id = null;
  const assignedTo = { kind, id };

  // ---- branchId ----
  let branchId = trimOrNull(raw.branchId);
  if (
    kind === ASSIGNMENT_KINDS.EMPLOYEE ||
    kind === ASSIGNMENT_KINDS.DEPARTMENT ||
    kind === ASSIGNMENT_KINDS.ASSET
  ) {
    branchId = null;
  }

  // ---- numbers ----
  let purchasePrice = null;
  if (typeof raw.purchasePrice === 'number' && Number.isFinite(raw.purchasePrice)) {
    purchasePrice = raw.purchasePrice;
  } else if (isPlainString(raw.purchasePrice) && raw.purchasePrice.trim().length > 0) {
    const parsed = Number.parseFloat(raw.purchasePrice.trim());
    if (Number.isFinite(parsed)) purchasePrice = parsed;
  }

  // ---- dates ----
  function parseDate(v) {
    if (v instanceof Date && !Number.isNaN(v.valueOf())) return v;
    if (isPlainString(v) && v.trim().length > 0) {
      const parsed = new Date(v.trim());
      if (!Number.isNaN(parsed.valueOf())) return parsed;
    }
    return null;
  }
  const purchaseDate = parseDate(raw.purchaseDate);

  // ---- condition + warranty ----
  const condition = raw.condition === 'used' ? 'used' : 'new';
  let warrantyStart = parseDate(raw.warrantyStart);
  let warrantyEnd = parseDate(raw.warrantyEnd);
  if (condition === 'used') {
    warrantyStart = null;
    warrantyEnd = null;
  }

  // ---- license ----
  const licenseType =
    raw.licenseType === 'personal' ||
    raw.licenseType === 'business' ||
    raw.licenseType === 'enterprise'
      ? raw.licenseType
      : null;
  const subscribedAt = parseDate(raw.subscribedAt);
  const expiresAt = parseDate(raw.expiresAt);

  return {
    categoryId: trimOrEmpty(raw.categoryId),
    subtypeId: trimOrEmpty(raw.subtypeId),
    name,
    brandId: trimOrNull(raw.brandId),
    modelId: trimOrNull(raw.modelId),
    serialNumber: trimOrNull(raw.serialNumber),
    statusId: trimOrEmpty(raw.statusId) || DEFAULT_ASSET_STATUS_CODE,
    assignedTo,
    branchId,
    notes: trimOrNull(raw.notes),
    purchaseDate,
    purchasePrice,
    condition,
    warrantyStart,
    warrantyEnd,
    licenseType: isLicense ? licenseType : null,
    subscribedAt: isLicense ? subscribedAt : null,
    expiresAt: isLicense ? expiresAt : null,
    isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
  };
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Returns midnight of today in UTC as milliseconds.
 * Used by validateAssetInput to gate warrantyStart on create.
 * Exported so callers (and tests) can stub it.
 * @returns {number}
 */
export function startOfTodayUTC() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * Validate a sanitized AssetInput. Returns a record of `{ field: errorKey }`.
 * Empty object means "valid".
 *
 * Error keys are i18n keys in the `assets` namespace.
 *
 * @param {AssetInput} input
 * @param {{
 *   category?: { requiresMultilang: boolean } | null,
 *   subtype?: { attachableTo: string[] } | null,
 *   isEdit?: boolean,
 * }} [opts]
 * @returns {Record<string, string>}
 */
export function validateAssetInput(input, opts = {}) {
  const errors = {};
  const category = opts.category ?? null;
  const subtype = opts.subtype ?? null;
  const isEdit = Boolean(opts.isEdit);
  const wantsMultilang = Boolean(category?.requiresMultilang);
  const s = sanitizeAssetInput(input, opts);
  const isLicense = s.categoryId === 'license';

  // categoryId required.
  if (!s.categoryId) errors.categoryId = 'errorRequired';

  // subtypeId required.
  if (!s.subtypeId) errors.subtypeId = 'errorRequired';

  // name validation. Only meaningful when a category is picked.
  if (s.categoryId) {
    if (wantsMultilang) {
      const map = /** @type {AssetName} */ (s.name);
      if (!map || typeof map !== 'object') {
        errors.name = 'errorRequired';
      } else {
        const filled = SUPPORTED_LOCALES.filter(
          (l) => map[l] && map[l].length > 0
        );
        if (filled.length === 0) errors.name = 'errorRequired';
        else if (filled.length < SUPPORTED_LOCALES.length)
          errors.name = 'errorNameAllLocales';
      }
    } else if (category && category.requiresMultilang === false) {
      // Name MUST be null for non-multilang categories.
      if (s.name !== null) errors.name = 'errorNameMustBeNull';
    } else {
      if (!s.name || (typeof s.name === 'string' && s.name.length === 0)) {
        errors.name = 'errorRequired';
      }
    }
  }

  // brandId / modelId pair: if modelId is set, brandId must be set.
  if (s.modelId && !s.brandId) errors.brandId = 'errorRequired';

  // serialNumber must be ASCII when present.
  if (s.serialNumber && NON_ASCII_REGEX.test(s.serialNumber)) {
    errors.serialNumber = 'errorAsciiOnly';
  }

  // assignedTo validation.
  const at = s.assignedTo;
  if (!ASSIGNMENT_KIND_LIST.includes(at?.kind)) {
    errors.assignedTo = 'errorRequired';
  } else if (at.kind !== ASSIGNMENT_KINDS.WAREHOUSE && !at.id) {
    errors.assignedTo = 'errorRequired';
  } else if (
    subtype?.attachableTo &&
    Array.isArray(subtype.attachableTo) &&
    subtype.attachableTo.length > 0 &&
    !subtype.attachableTo.includes(at.kind)
  ) {
    errors.assignedTo = 'errorAssignedKindNotAllowed';
  }

  // branchId required for warehouse / branch modes.
  if (
    at?.kind === ASSIGNMENT_KINDS.WAREHOUSE ||
    at?.kind === ASSIGNMENT_KINDS.BRANCH
  ) {
    if (!s.branchId) errors.branchId = 'errorRequired';
  }

  if (!s.statusId) errors.statusId = 'errorRequired';

  // Fix 1: purchasePrice must be >= 0 (null is allowed — means "not recorded").
  if (s.purchasePrice != null && s.purchasePrice < 0) {
    errors.purchasePrice = 'errorNegativePrice';
  }

  if (s.condition !== 'new' && s.condition !== 'used') {
    errors.condition = 'errorRequired';
  }

  if (s.condition === 'new' && s.warrantyStart && s.warrantyEnd) {
    if (s.warrantyEnd.valueOf() < s.warrantyStart.valueOf()) {
      errors.warrantyEnd = 'errorWarrantyEndBeforeStart';
    }
  }

  // Fix 2: warrantyStart cannot be in the past on CREATE.
  // On edit, the calendar is restricted client-side but existing past dates stay valid.
  if (!isEdit && s.warrantyStart instanceof Date) {
    if (s.warrantyStart.valueOf() < startOfTodayUTC()) {
      errors.warrantyStart = 'errorWarrantyStartPast';
    }
  }

  // License-specific holder constraint.
  // A license may only be assigned to a device (asset) or an employee.
  // Assigning it to a warehouse, branch, or department is a domain error.
  // Only fires when no prior assignedTo error was set (e.g. errorRequired).
  if (isLicense && !errors.assignedTo) {
    const at = s.assignedTo;
    if (
      at?.kind !== undefined &&
      !['asset', 'employee'].includes(at.kind)
    ) {
      errors.assignedTo = 'errorLicenseInvalidHolder';
    }
  }

  // License-specific fields.
  if (isLicense) {
    if (!s.licenseType) errors.licenseType = 'errorRequired';
    if (!s.subscribedAt) errors.subscribedAt = 'errorRequired';
    if (!s.expiresAt) errors.expiresAt = 'errorRequired';
    if (
      s.subscribedAt &&
      s.expiresAt &&
      s.expiresAt.valueOf() <= s.subscribedAt.valueOf()
    ) {
      errors.expiresAt = 'errorExpiresBeforeSubscribed';
    }
  } else {
    // Non-license: license fields must be null. Sanitizer already enforces;
    // this is a defensive guard for callers that bypass the sanitizer.
    if (s.licenseType || s.subscribedAt || s.expiresAt) {
      errors.licenseType = 'errorLicenseFieldsOnLicenseOnly';
    }
  }

  return errors;
}

/**
 * True if the input has no validation errors.
 * @param {AssetInput} input
 * @param {{ category?: { requiresMultilang: boolean } | null }} [opts]
 */
export function isAssetInputValid(input, opts) {
  return Object.keys(validateAssetInput(input, opts)).length === 0;
}

/**
 * Format the rendered inventory code from prefix + raw integer number.
 * No zero-padding (the user picked the cleaner of the two examples in
 * AMS_Plan_v3.md §4).
 *
 * @param {string} prefix
 * @param {number} number
 * @returns {string}
 */
export function formatInventoryCode(prefix, number) {
  const p = String(prefix ?? '').trim().toUpperCase();
  const n = Number.isFinite(number) ? Math.trunc(number) : 0;
  return `${p}/${n}`;
}

/**
 * Render the asset's display name in the requested locale.
 * Single-string names render verbatim; locale maps go through `localize()`.
 *
 * @param {Pick<Asset, 'name'> | null | undefined} asset
 * @param {string} [locale]
 * @returns {string}
 */
export function nameForDisplay(asset, locale) {
  if (!asset) return '';
  const v = asset.name;
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return localize(v, locale);
  return '';
}

// ---------------------------------------------------------------------------
// Custom error classes
// ---------------------------------------------------------------------------

export class AssetInventoryCodeTakenError extends Error {
  constructor(code) {
    super(`Inventory code already in use: ${code}`);
    this.name = 'AssetInventoryCodeTakenError';
    this.code = 'asset/inventory-code-taken';
  }
}

export class AssetCounterMissingError extends Error {
  constructor(categoryId) {
    super(`Category counter missing for ${categoryId} — re-run bootstrap`);
    this.name = 'AssetCounterMissingError';
    this.code = 'asset/counter-missing';
    this.categoryId = categoryId;
  }
}

export class AssetCategoryInactiveError extends Error {
  constructor(categoryId) {
    super(`Category ${categoryId} is inactive or missing`);
    this.name = 'AssetCategoryInactiveError';
    this.code = 'asset/category-inactive';
    this.categoryId = categoryId;
  }
}

export class AssetStatusFinalError extends Error {
  constructor(statusId) {
    super(`Asset status '${statusId}' is final — mutation rejected (errorStatusFinal)`);
    this.name = 'AssetStatusFinalError';
    this.code = 'asset/status-final';
    this.i18nKey = 'errorStatusFinal';
    this.statusId = statusId;
  }
}

export class AssignmentCycleError extends Error {
  constructor(hostAssetId, targetAssetId) {
    super(`Assignment cycle detected: ${hostAssetId} -> ... -> ${targetAssetId} (errorAssignmentCycle)`);
    this.name = 'AssignmentCycleError';
    this.code = 'asset/assignment-cycle';
    this.i18nKey = 'errorAssignmentCycle';
    this.hostAssetId = hostAssetId;
    this.targetAssetId = targetAssetId;
  }
}

export class AssignmentSelfError extends Error {
  constructor(assetId) {
    super(`Asset cannot be assigned to itself: ${assetId} (errorAssignmentSelf)`);
    this.name = 'AssignmentSelfError';
    this.code = 'asset/assignment-self';
    this.i18nKey = 'errorAssignmentSelf';
    this.assetId = assetId;
  }
}

export class LicenseKeyOnNonLicenseError extends Error {
  constructor(assetId, categoryId) {
    super(`Asset ${assetId} is not a license asset (categoryId='${categoryId}') — errorLicenseKeyOnNonLicense`);
    this.name = 'LicenseKeyOnNonLicenseError';
    this.code = 'asset/license-key-on-non-license';
    this.i18nKey = 'errorLicenseKeyOnNonLicense';
    this.assetId = assetId;
    this.categoryId = categoryId;
  }
}

export class LicenseKeyMissingError extends Error {
  constructor(assetId) {
    super(`No license key found on asset ${assetId}`);
    this.name = 'LicenseKeyMissingError';
    this.code = 'asset/license-key-missing';
    this.assetId = assetId;
  }
}

export class LicenseKeyTargetOccupiedError extends Error {
  constructor(assetId) {
    super(`Target asset ${assetId} already has a license key — errorLicenseKeyTargetOccupied`);
    this.name = 'LicenseKeyTargetOccupiedError';
    this.code = 'asset/license-key-target-occupied';
    this.i18nKey = 'errorLicenseKeyTargetOccupied';
    this.assetId = assetId;
  }
}

// ---------------------------------------------------------------------------
// Fix 4 — Assignment cycle detection
// ---------------------------------------------------------------------------

/**
 * Walk the "assignedTo → asset" chain starting from targetAssetId and
 * ensure it never circles back to hostAssetId.
 *
 * Throws `AssignmentSelfError` immediately when `hostAssetId === targetAssetId`.
 * Throws `AssignmentCycleError` when a revisit is detected or when the walk
 * exceeds `maxHops` hops (treats runaway chains as potential cycles).
 *
 * @param {{
 *   hostAssetId: string,
 *   targetAssetId: string,
 *   lookup: (assetId: string) => Promise<{ assignedTo?: { kind: string, id: string | null } } | null>,
 *   maxHops?: number,
 * }} params
 * @returns {Promise<void>}
 */
export async function assertNoAssignmentCycle({ hostAssetId, targetAssetId, lookup, maxHops = 16 }) {
  if (hostAssetId === targetAssetId) {
    throw new AssignmentSelfError(hostAssetId);
  }

  const visited = new Set([hostAssetId]);
  let current = targetAssetId;
  let hops = 0;

  while (current != null && hops < maxHops) {
    if (visited.has(current)) {
      throw new AssignmentCycleError(hostAssetId, current);
    }
    visited.add(current);
    hops += 1;

    const asset = await lookup(current);
    if (!asset) break;

    const at = asset.assignedTo;
    if (!at || at.kind !== 'asset' || !at.id) break;

    current = at.id;
  }

  // If we reached the maxHops limit and there is still a next node, treat it
  // as a cycle to prevent runaway traversal.
  if (hops >= maxHops && current != null) {
    const asset = await lookup(current);
    if (asset?.assignedTo?.kind === 'asset' && asset.assignedTo.id) {
      throw new AssignmentCycleError(hostAssetId, current);
    }
  }
}
