/**
 * Employees domain module.
 *
 * Pure JavaScript: no Firestore, no React, no I/O. Exports the entity shape,
 * validation/sanitization helpers, the email-uniqueness sentinel-key helper,
 * and the custom error classes used by the repository adapter and the form
 * layer.
 *
 * Mirrors the structure of `src/domain/branches.js` so the two slices stay
 * recognizable as the same pattern.
 *
 * Wave-1 user-driven simplification (2026-05-07):
 *   - Removed `middleName` (user request — Wave 1 dropped patronymic).
 *   - Removed `hiredAt`               (user request — not modeled in Wave 1).
 *   - Replaced `position` with `department` (free-text in Wave 1; aligns
 *     with `AMS_Plan_v3.md` §14: "Сотрудники: имя, email, отдел, филиал,
 *     статус"). The dedicated `departments` collection lands in a later
 *     wave; until then `department` is a plain string.
 *
 * Wave 1.5 (2026-05-07, user decision 3A):
 *   - `branchId` is REQUIRED again. Rationale: AMS_Plan_v3.md §14 lists
 *     "филиал" as a mandatory employee field. The Wave 1 deferral was
 *     premature. Existing employees written without a branch must be
 *     dozapolneniy-completed via the EmployeeDetailPage CTA — see the
 *     migration note in plan §2C.
 *   - Rules still permit pre-existing `branchId == null` rows on READ so the
 *     UI can surface them with a "fill me" CTA. New WRITES must include a
 *     non-empty `branchId`.
 */

/**
 * @typedef {Object} Employee
 * @property {string} employeeId            // mirrors doc id
 * @property {string} firstName             // Tier 3, free text, required
 * @property {string} lastName              // Tier 3, required
 * @property {string} email                 // Tier 4, ASCII, required, unique
 * @property {string|null} phone            // Tier 3, optional
 * @property {string|null} branchId         // FK -> branches; NULLABLE in Wave 1
 * @property {string|null} departmentId     // wire-shaped, null in Wave 1
 * @property {string|null} department       // Tier 3, free text, optional
 * @property {boolean} isActive             // soft-deactivation flag
 * @property {import('firebase/firestore').Timestamp|null} terminatedAt
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */

/**
 * @typedef {Object} EmployeeInput
 * @property {string} firstName
 * @property {string} lastName
 * @property {string} email
 * @property {string|null} [phone]
 * @property {string|null} [branchId]
 * @property {string|null} [departmentId]
 * @property {string|null} [department]
 * @property {boolean} [isActive]            // defaults to true on create
 */

// ---------------------------------------------------------------------------
// Validation regular expressions
// ---------------------------------------------------------------------------

// Tier 4: email must be ASCII printable, with at least one '@' and one dot.
// Hex range 0x21..0x7E excludes whitespace and control chars.
const EMAIL_ASCII_REGEX = /^[\x21-\x7E]+@[\x21-\x7E]+\.[\x21-\x7E]+$/;

// Quick screen for any non-ASCII codepoint anywhere in the string.
const NON_ASCII_REGEX = /[^\x00-\x7F]/;

// Optional phone: leading + sign, digits, spaces, parens, dashes; length 6..32.
const PHONE_REGEX = /^\+?[0-9 ()\-]{6,32}$/;

// ---------------------------------------------------------------------------
// Helpers — pure, no I/O
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
 * Build a fresh form-state object for a brand-new employee.
 * @returns {EmployeeInput}
 */
export function emptyEmployeeInput() {
  return {
    firstName: '',
    lastName: '',
    email: '',
    phone: null,
    branchId: null,
    departmentId: null,
    department: null,
    isActive: true,
  };
}

/**
 * Trim every string field, lower-case email, normalize null/undefined,
 * and coerce booleans. Does NOT validate — call validateEmployeeInput().
 *
 * @param {EmployeeInput} input
 * @returns {EmployeeInput}
 */
export function sanitizeEmployeeInput(input) {
  const raw = input ?? {};
  return {
    firstName: trimOrEmpty(raw.firstName),
    lastName: trimOrEmpty(raw.lastName),
    email: trimOrEmpty(raw.email).toLowerCase(),
    phone: trimOrNull(raw.phone),
    branchId: trimOrNull(raw.branchId),
    departmentId: trimOrNull(raw.departmentId),
    department: trimOrNull(raw.department),
    isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
  };
}

/**
 * Validate a sanitized EmployeeInput. Returns a record of `{ field: errorKey }`.
 * Empty object means "valid".
 *
 * Error keys are i18n keys in the `employees` namespace.
 *
 * @param {EmployeeInput} input
 * @returns {Record<string, string>}
 */
export function validateEmployeeInput(input) {
  const errors = {};
  const s = sanitizeEmployeeInput(input);

  if (!s.firstName) errors.firstName = 'errorRequired';
  if (!s.lastName) errors.lastName = 'errorRequired';

  if (!s.email) {
    errors.email = 'errorRequired';
  } else if (NON_ASCII_REGEX.test(s.email)) {
    errors.email = 'errorEmailNonAscii';
  } else if (!EMAIL_ASCII_REGEX.test(s.email)) {
    errors.email = 'errorEmailInvalid';
  }

  if (s.phone && !PHONE_REGEX.test(s.phone)) {
    errors.phone = 'errorPhoneInvalid';
  }

  // Wave 1.5: branchId is required (§14 of AMS_Plan_v3.md).
  if (!s.branchId) {
    errors.branchId = 'errorBranchRequired';
  }

  return errors;
}

/**
 * True if the input has no validation errors.
 * @param {EmployeeInput} input
 */
export function isEmployeeInputValid(input) {
  return Object.keys(validateEmployeeInput(input)).length === 0;
}

/**
 * Render the canonical full-name string. Wave 1 dropped patronymic
 * (`middleName`); the result is `lastName firstName`. The `_locale`
 * parameter is reserved for future locale-aware ordering.
 *
 * @param {{firstName: string, lastName: string}} employee
 * @param {string} [_locale]   reserved
 * @returns {string}
 */
export function formatEmployeeName(employee, _locale) {
  if (!employee) return '';
  const parts = [employee.lastName, employee.firstName];
  return parts.filter(Boolean).join(' ').trim();
}

/**
 * Lookup key for the `email_index/{key}` uniqueness sentinel.
 *
 * Returns the trimmed lower-cased email. Naming is "key" not "hash" — this
 * is a deterministic mapping from the email to its sentinel doc id, not a
 * cryptographic hash. The email itself is the primary identifier; hashing
 * it would buy no privacy because the same email lives in `/employees`.
 *
 * @param {string} email
 * @returns {string}
 */
export function emailKey(email) {
  if (!isPlainString(email)) return '';
  return email.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Custom error classes
//
// The dialog layer catches `code` and renders the matching i18n key. Repos
// throw these from createEmployee / updateEmployee / setEmployeeActive.
// ---------------------------------------------------------------------------

export class EmployeeEmailTakenError extends Error {
  constructor(email) {
    super(`Email already in use: ${email}`);
    this.name = 'EmployeeEmailTakenError';
    this.code = 'employee/email-taken';
  }
}

export class EmployeeHasActiveAssignmentsError extends Error {
  constructor(count) {
    super(`Cannot deactivate: ${count} active assignments`);
    this.name = 'EmployeeHasActiveAssignmentsError';
    this.code = 'employee/has-active-assignments';
    this.count = count;
  }
}
