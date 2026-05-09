/**
 * Models domain module.
 *
 * Pure JavaScript: no Firestore, no React, no I/O. A model belongs to
 * exactly one brand. Soft-delete only.
 */

/**
 * @typedef {Object} Model
 * @property {string} modelId
 * @property {string} brandId
 * @property {string} name
 * @property {boolean} isActive
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */

/**
 * @typedef {Object} ModelInput
 * @property {string} brandId
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
 * @returns {ModelInput}
 */
export function emptyModelInput() {
  return { brandId: '', name: '', isActive: true };
}

/**
 * @param {ModelInput} input
 * @returns {ModelInput}
 */
export function sanitizeModelInput(input) {
  const raw = input ?? {};
  const name = trimOrEmpty(raw.name).slice(0, NAME_MAX_LENGTH);
  return {
    brandId: trimOrEmpty(raw.brandId),
    name,
    isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
  };
}

/**
 * @param {ModelInput} input
 * @returns {Record<string, string>}
 */
export function validateModelInput(input) {
  const errors = {};
  const s = sanitizeModelInput(input);
  if (!s.brandId) errors.brandId = 'errorRequired';
  if (!s.name) errors.name = 'errorRequired';
  return errors;
}

/**
 * @param {ModelInput} input
 */
export function isModelInputValid(input) {
  return Object.keys(validateModelInput(input)).length === 0;
}

export class ModelIdConflictError extends Error {
  constructor(id) {
    super(`Model id already exists: ${id}`);
    this.name = 'ModelIdConflictError';
    this.id = id;
  }
}

export class ModelInUseError extends Error {
  /**
   * @param {string} id
   * @param {{ assetCount: number }} counts
   */
  constructor(id, counts) {
    super(`Model ${id} is referenced by ${counts.assetCount} assets`);
    this.name = 'ModelInUseError';
    this.code = 'model/in-use';
    this.id = id;
    this.assetCount = counts.assetCount;
  }
}
