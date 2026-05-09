/**
 * Brands domain module.
 *
 * Pure JavaScript: no Firestore, no React, no I/O. Brands are a Tier-4
 * catalog managed by Super Admin only. They are referenced by `models`
 * (FK) and by `assets.brandId`. Soft-delete only — hard delete blocked
 * by rules.
 */

/**
 * @typedef {Object} Brand
 * @property {string} brandId
 * @property {string} name
 * @property {boolean} isActive
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */

/**
 * @typedef {Object} BrandInput
 * @property {string} name
 * @property {boolean} [isActive]
 */

const NAME_MAX_LENGTH = 200;

function isPlainString(value) {
  return typeof value === 'string';
}

function trimOrEmpty(value) {
  return isPlainString(value) ? value.trim() : '';
}

/**
 * @returns {BrandInput}
 */
export function emptyBrandInput() {
  return { name: '', isActive: true };
}

/**
 * @param {BrandInput} input
 * @returns {BrandInput}
 */
export function sanitizeBrandInput(input) {
  const raw = input ?? {};
  const trimmed = trimOrEmpty(raw.name);
  return {
    name: trimmed.slice(0, NAME_MAX_LENGTH),
    isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
  };
}

/**
 * @param {BrandInput} input
 * @returns {Record<string, string>}
 */
export function validateBrandInput(input) {
  const errors = {};
  const s = sanitizeBrandInput(input);
  if (!s.name) errors.name = 'errorRequired';
  return errors;
}

/**
 * @param {BrandInput} input
 */
export function isBrandInputValid(input) {
  return Object.keys(validateBrandInput(input)).length === 0;
}

export class BrandIdConflictError extends Error {
  constructor(id) {
    super(`Brand id already exists: ${id}`);
    this.name = 'BrandIdConflictError';
    this.id = id;
  }
}

export class BrandInUseError extends Error {
  /**
   * @param {string} id
   * @param {{ modelCount: number, assetCount: number }} counts
   */
  constructor(id, counts) {
    super(
      `Brand ${id} is referenced by ${counts.modelCount} models and ${counts.assetCount} assets`
    );
    this.name = 'BrandInUseError';
    this.code = 'brand/in-use';
    this.id = id;
    this.modelCount = counts.modelCount;
    this.assetCount = counts.assetCount;
  }
}
