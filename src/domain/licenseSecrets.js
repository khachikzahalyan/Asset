/**
 * License secrets domain module.
 *
 * Pure JavaScript: no Firestore, no React, no I/O. Provides the sanitiser
 * and the length cap. The actual value is NEVER mentioned in any error
 * message produced by this module — error returns are i18n keys only.
 */

/**
 * @typedef {Object} LicenseSecret
 * @property {string} value
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */

export const LICENSE_KEY_MAX_LENGTH = 4096;

/**
 * Trim surrounding whitespace, coerce to string, truncate to the length cap.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeLicenseSecretValue(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length > LICENSE_KEY_MAX_LENGTH) {
    return trimmed.slice(0, LICENSE_KEY_MAX_LENGTH);
  }
  return trimmed;
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
export function validateLicenseSecretValue(value) {
  const v = sanitizeLicenseSecretValue(value);
  if (!v) return 'errorRequired';
  return null;
}

/**
 * @param {unknown} value
 */
export function isLicenseSecretValueValid(value) {
  return validateLicenseSecretValue(value) === null;
}
