// src/domain/userInvitations.js
/**
 * UserInvitations domain module.
 *
 * Pure JavaScript: no Firestore, no React, no I/O. Exports the entity shape,
 * type/status constants, and validation helpers used by both the infra
 * repository and the form layer.
 */

/**
 * @typedef {'super_admin' | 'asset_admin' | 'tech_admin'} InviteRole
 * @typedef {'pending' | 'accepted' | 'revoked'} InviteStatus
 *
 * @typedef {Object} UserInvitation
 * @property {string} email                  // canonical lowercased, mirrors doc id
 * @property {InviteRole} role
 * @property {string|null} branchId
 * @property {string|null} departmentId
 * @property {string} invitedBy              // uid
 * @property {import('firebase/firestore').Timestamp} invitedAt
 * @property {InviteStatus} status
 * @property {import('firebase/firestore').Timestamp|null} acceptedAt
 * @property {string|null} acceptedUid
 * @property {import('firebase/firestore').Timestamp|null} revokedAt
 * @property {string|null} revokedBy
 *
 * @typedef {Object} InviteInput
 * @property {string} email
 * @property {InviteRole} role
 */

export const INVITE_ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  ASSET_ADMIN: 'asset_admin',
  TECH_ADMIN: 'tech_admin',
});

export const INVITE_ROLE_LIST = Object.freeze(Object.values(INVITE_ROLES));

export const INVITE_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REVOKED: 'revoked',
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Trim + lowercase. Returns '' for nullish.
 * @param {string|null|undefined} email
 * @returns {string}
 */
export function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

/** @returns {InviteInput} */
export function emptyInviteInput() {
  return { email: '', role: INVITE_ROLES.TECH_ADMIN };
}

/**
 * @param {InviteInput} input
 * @returns {InviteInput}
 */
export function sanitizeInviteInput(input) {
  const raw = input ?? {};
  return {
    email: normalizeEmail(raw.email),
    role: INVITE_ROLE_LIST.includes(raw.role) ? raw.role : INVITE_ROLES.TECH_ADMIN,
  };
}

/**
 * @param {InviteInput} input
 * @returns {Record<string, string>}  // empty = valid
 */
export function validateInviteInput(input) {
  const sanitized = sanitizeInviteInput(input);
  const errors = {};
  if (!sanitized.email) {
    errors.email = 'errEmailRequired';
  } else if (!EMAIL_RE.test(sanitized.email)) {
    errors.email = 'errEmailInvalid';
  }
  if (!INVITE_ROLE_LIST.includes(sanitized.role)) {
    errors.role = 'errRoleRequired';
  }
  return errors;
}

export function isInviteInputValid(input) {
  return Object.keys(validateInviteInput(input)).length === 0;
}
