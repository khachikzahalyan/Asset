/**
 * Notification settings domain module.
 *
 * Singleton-style document at /settings/notifications. In Phase 1 only
 * `licenseExpiryWarningDays` is in scope.
 */

/**
 * @typedef {Object} NotificationSettings
 * @property {number} licenseExpiryWarningDays
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */

/**
 * @typedef {Object} NotificationSettingsInput
 * @property {number} licenseExpiryWarningDays
 */

export const DEFAULT_LICENSE_EXPIRY_WARNING_DAYS = 30;
export const LICENSE_EXPIRY_WARNING_DAYS_MIN = 1;
export const LICENSE_EXPIRY_WARNING_DAYS_MAX = 365;

/**
 * @returns {NotificationSettingsInput}
 */
export function emptyNotificationSettingsInput() {
  return { licenseExpiryWarningDays: DEFAULT_LICENSE_EXPIRY_WARNING_DAYS };
}

/**
 * @param {NotificationSettingsInput} input
 * @returns {NotificationSettingsInput}
 */
export function sanitizeNotificationSettingsInput(input) {
  const raw = input ?? {};
  let n = DEFAULT_LICENSE_EXPIRY_WARNING_DAYS;
  if (typeof raw.licenseExpiryWarningDays === 'number') {
    n = Math.trunc(raw.licenseExpiryWarningDays);
  } else if (typeof raw.licenseExpiryWarningDays === 'string') {
    const parsed = Number.parseInt(raw.licenseExpiryWarningDays.trim(), 10);
    if (Number.isFinite(parsed)) n = parsed;
  }
  return { licenseExpiryWarningDays: n };
}

/**
 * @param {NotificationSettingsInput} input
 * @returns {Record<string, string>}
 */
export function validateNotificationSettingsInput(input) {
  const errors = {};
  const s = sanitizeNotificationSettingsInput(input);
  if (
    !Number.isInteger(s.licenseExpiryWarningDays) ||
    s.licenseExpiryWarningDays < LICENSE_EXPIRY_WARNING_DAYS_MIN ||
    s.licenseExpiryWarningDays > LICENSE_EXPIRY_WARNING_DAYS_MAX
  ) {
    errors.licenseExpiryWarningDays = 'errorRange';
  }
  return errors;
}

/**
 * @param {NotificationSettingsInput} input
 */
export function isNotificationSettingsInputValid(input) {
  return Object.keys(validateNotificationSettingsInput(input)).length === 0;
}
