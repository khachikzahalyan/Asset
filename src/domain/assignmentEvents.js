/**
 * Assignment-events domain module (Wave-1 Step 4).
 *
 * Pure JavaScript: no Firestore, no React, no I/O. Defines the
 * AssignmentEvent typedef, the sanitize/validate helpers, the
 * `deriveEventType` matrix, and the custom `AssignmentConflictError`
 * raised by the repository when the asset's current `assignedTo` has
 * drifted between the user opening the dialog and submitting it.
 *
 * Design contract:
 *
 *   - `assignment_events` is an APPEND-ONLY collection. Each row is a
 *     single transition of one asset's holder. The asset doc's
 *     `assignedTo` field is the source of truth for the *current*
 *     holder; the event log is the historical record.
 *
 *   - Three event types — derived from (from, to), not user-selected:
 *       * 'issue'    — warehouse → non-warehouse (employee | branch | department)
 *       * 'return'   — non-warehouse → warehouse
 *       * 'transfer' — non-warehouse → non-warehouse, OR warehouse → warehouse with a different id
 *
 *     The transfer-between-warehouses case is a relocation between two
 *     central-warehouse / branch-warehouse rows. Same-kind same-id
 *     "moves" are not events at all (the repository rejects them).
 *
 *   - `actUploadPath` is the Cloud Storage path of the signed paper act.
 *     Wave-1 leaves it `null` (no upload UI yet); the validation locks
 *     the regex shape now so when Wave-2 ships the upload widget, we
 *     don't have to rewrite rules.
 *
 *   - Optimistic concurrency: every event input carries a
 *     `fromAssignment` snapshot. The repository's transaction reads the
 *     live asset doc, compares its `assignedTo` to `fromAssignment`,
 *     and aborts with `AssignmentConflictError` if they differ. This
 *     is the standard "expected version" pattern Firestore allows
 *     without an explicit version field.
 */

import { ASSIGNMENT_KINDS, ASSIGNMENT_KIND_LIST } from '@/domain/assets.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EVENT_TYPES = Object.freeze({
  ISSUE: 'issue',
  RETURN: 'return',
  TRANSFER: 'transfer',
});

export const EVENT_TYPE_LIST = Object.freeze(Object.values(EVENT_TYPES));

/**
 * Storage-path regex for the act-of-acceptance scan. The `assets/` root
 * mirrors the spec; the leaf extension list (pdf|jpg|jpeg|png) is
 * deliberately the same set the Storage rules will police later.
 */
export const ACT_UPLOAD_PATH_REGEX =
  /^assets\/[^/]+\/acts\/[^/]+\.(pdf|jpg|jpeg|png)$/;

/** Hard cap on free-text notes per event. Mirrored in firestore.rules. */
export const MAX_NOTES_LENGTH = 1000;

// ---------------------------------------------------------------------------
// Typedefs
// ---------------------------------------------------------------------------

/**
 * @typedef {import('@/domain/assets.js').AssignedTo} AssignedTo
 */

/**
 * @typedef {Object} AssignmentEvent
 * @property {string} eventId                                // mirrors doc id
 * @property {string} assetId
 * @property {AssignedTo | null} fromAssignment              // null only on the very first issue when no prior history exists
 * @property {AssignedTo} toAssignment                       // never null — return = move to warehouse
 * @property {'issue' | 'return' | 'transfer'} eventType
 * @property {import('firebase/firestore').Timestamp} occurredAt
 * @property {string} notes                                  // empty string allowed; null coerced to ''
 * @property {string | null} actUploadPath                   // Cloud Storage path; null in Wave-1 (no upload UI yet)
 * @property {string} actorUid
 * @property {string} actorRole
 * @property {import('firebase/firestore').Timestamp} createdAt
 */

/**
 * @typedef {Object} AssignmentEventInput
 * @property {string} assetId
 * @property {AssignedTo | null} [fromAssignment]
 * @property {AssignedTo} toAssignment
 * @property {Date | null} [occurredAt]                       // defaults to now
 * @property {string | null} [notes]
 * @property {string | null} [actUploadPath]
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainString(v) {
  return typeof v === 'string';
}

function trimOrEmpty(v) {
  return isPlainString(v) ? v.trim() : '';
}

function trimOrNull(v) {
  if (!isPlainString(v)) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function isValidAssignedToShape(a) {
  if (!a || typeof a !== 'object') return false;
  const keys = Object.keys(a);
  if (keys.some((k) => k !== 'kind' && k !== 'id')) return false;
  if (!ASSIGNMENT_KIND_LIST.includes(a.kind)) return false;
  if (a.kind === ASSIGNMENT_KINDS.WAREHOUSE) {
    return a.id === null;
  }
  return typeof a.id === 'string' && a.id.length > 0;
}

function assignedToEqual(a, b) {
  if (a == null || b == null) return a === b;
  return a.kind === b.kind && (a.id ?? null) === (b.id ?? null);
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Derive the event type from a (from, to) pair. Pure: does NOT validate.
 *
 * Matrix:
 *   warehouse → warehouse           : 'transfer' (same kind, different id) — caller validates id-difference upstream
 *   warehouse → non-warehouse       : 'issue'
 *   non-warehouse → warehouse       : 'return'
 *   non-warehouse → non-warehouse   : 'transfer'
 *   null → non-warehouse            : 'issue'  (first-ever issue with no prior history)
 *   null → warehouse                : 'transfer' (defensive — null→warehouse is a no-op the repo rejects)
 *
 * Returns `null` if either arg has an unrecognized kind.
 *
 * @param {AssignedTo | null} from
 * @param {AssignedTo} to
 * @returns {'issue' | 'return' | 'transfer' | null}
 */
export function deriveEventType(from, to) {
  if (!isValidAssignedToShape(to)) return null;
  if (from != null && !isValidAssignedToShape(from)) return null;
  const fromKind = from?.kind ?? null;
  const toKind = to.kind;
  const fromIsWh = fromKind === ASSIGNMENT_KINDS.WAREHOUSE;
  const toIsWh = toKind === ASSIGNMENT_KINDS.WAREHOUSE;

  // First-ever assignment (no prior history).
  if (fromKind === null) {
    return toIsWh ? EVENT_TYPES.TRANSFER : EVENT_TYPES.ISSUE;
  }
  if (fromIsWh && !toIsWh) return EVENT_TYPES.ISSUE;
  if (!fromIsWh && toIsWh) return EVENT_TYPES.RETURN;
  return EVENT_TYPES.TRANSFER;
}

/**
 * Build an empty form-state for a new event keyed off the asset's
 * current holder. The form pre-fills `fromAssignment` from the asset
 * doc and leaves `toAssignment` for the user to fill via the dialog.
 *
 * @param {{ assetId: string, assignedTo: AssignedTo }} asset
 * @returns {AssignmentEventInput}
 */
export function emptyAssignmentEventInput(asset) {
  return {
    assetId: asset?.assetId ?? '',
    fromAssignment: asset?.assignedTo ?? null,
    toAssignment: { kind: ASSIGNMENT_KINDS.WAREHOUSE, id: null },
    occurredAt: new Date(),
    notes: null,
    actUploadPath: null,
  };
}

/**
 * Trim strings, coerce nulls, and normalize the discriminated unions.
 * Does NOT validate — call validateAssignmentEventInput afterwards.
 *
 * @param {AssignmentEventInput} input
 * @returns {AssignmentEventInput}
 */
export function sanitizeAssignmentEventInput(input) {
  const raw = input ?? {};

  // ---- assetId ----
  const assetId = trimOrEmpty(raw.assetId);

  // ---- fromAssignment ----
  let fromAssignment = null;
  if (raw.fromAssignment != null) {
    if (typeof raw.fromAssignment === 'object') {
      const k = raw.fromAssignment.kind;
      let id = trimOrNull(raw.fromAssignment.id);
      if (k === ASSIGNMENT_KINDS.WAREHOUSE) id = null;
      fromAssignment = { kind: k, id };
    }
  }

  // ---- toAssignment ----
  const rawTo =
    raw.toAssignment && typeof raw.toAssignment === 'object'
      ? raw.toAssignment
      : { kind: ASSIGNMENT_KINDS.WAREHOUSE, id: null };
  let toKind = ASSIGNMENT_KIND_LIST.includes(rawTo.kind)
    ? rawTo.kind
    : ASSIGNMENT_KINDS.WAREHOUSE;
  let toId = trimOrNull(rawTo.id);
  if (toKind === ASSIGNMENT_KINDS.WAREHOUSE) toId = null;
  const toAssignment = { kind: toKind, id: toId };

  // ---- occurredAt ----
  let occurredAt = null;
  if (raw.occurredAt instanceof Date && !Number.isNaN(raw.occurredAt.valueOf())) {
    occurredAt = raw.occurredAt;
  } else if (isPlainString(raw.occurredAt) && raw.occurredAt.trim().length > 0) {
    const parsed = new Date(raw.occurredAt.trim());
    if (!Number.isNaN(parsed.valueOf())) occurredAt = parsed;
  } else if (raw.occurredAt == null) {
    occurredAt = new Date();
  }

  // ---- notes ----
  const notes = trimOrNull(raw.notes);

  // ---- actUploadPath ----
  const actUploadPath = trimOrNull(raw.actUploadPath);

  return {
    assetId,
    fromAssignment,
    toAssignment,
    occurredAt,
    notes,
    actUploadPath,
  };
}

/**
 * Validate a sanitized AssignmentEventInput. Returns `{ field: errorKey }`.
 * Empty object means valid.
 *
 * Error keys are i18n keys in the `assets` namespace (Step 4 reuses the
 * `assets` namespace rather than introducing a new `assignments`
 * namespace — fewer files to load, same audience).
 *
 * Invariants enforced:
 *   - assetId required.
 *   - toAssignment shape valid; non-warehouse kinds need a non-empty id.
 *   - issue requires from.kind === 'warehouse' AND to.kind !== 'warehouse'.
 *   - return requires from.kind !== 'warehouse' AND to.kind === 'warehouse'.
 *   - transfer requires (from, to) both non-warehouse OR both warehouse with
 *     different ids.
 *   - occurredAt must be a valid Date.
 *   - notes ≤ MAX_NOTES_LENGTH chars when present.
 *   - actUploadPath null OR matches ACT_UPLOAD_PATH_REGEX.
 *   - "no-op" moves (from === to identity) are rejected.
 *
 * @param {AssignmentEventInput} input
 * @returns {Record<string, string>}
 */
export function validateAssignmentEventInput(input) {
  const errors = {};
  const s = sanitizeAssignmentEventInput(input);

  if (!s.assetId) errors.assetId = 'errorRequired';

  // toAssignment must always be present and valid.
  if (!isValidAssignedToShape(s.toAssignment)) {
    errors.toAssignment = 'errorRequired';
  }

  // fromAssignment is allowed to be null (very first event), but if
  // present it must be valid.
  if (s.fromAssignment != null && !isValidAssignedToShape(s.fromAssignment)) {
    errors.fromAssignment = 'errorRequired';
  }

  // No-op move: same kind, same id (and from is non-null). Always wrong.
  if (
    !errors.toAssignment &&
    s.fromAssignment != null &&
    isValidAssignedToShape(s.fromAssignment) &&
    assignedToEqual(s.fromAssignment, s.toAssignment)
  ) {
    errors.toAssignment = 'errorAssignmentNoOp';
  }

  // Event type matrix.
  if (!errors.toAssignment && !errors.fromAssignment) {
    const eventType = deriveEventType(s.fromAssignment, s.toAssignment);
    if (!eventType) {
      errors.toAssignment = 'errorRequired';
    } else if (eventType === EVENT_TYPES.ISSUE) {
      // Issue: from must be warehouse OR null; to must be non-warehouse.
      const fromOk =
        s.fromAssignment === null ||
        s.fromAssignment.kind === ASSIGNMENT_KINDS.WAREHOUSE;
      const toOk = s.toAssignment.kind !== ASSIGNMENT_KINDS.WAREHOUSE;
      if (!fromOk || !toOk) errors.toAssignment = 'errorAssignmentInvariant';
    } else if (eventType === EVENT_TYPES.RETURN) {
      const fromOk =
        s.fromAssignment != null &&
        s.fromAssignment.kind !== ASSIGNMENT_KINDS.WAREHOUSE;
      const toOk = s.toAssignment.kind === ASSIGNMENT_KINDS.WAREHOUSE;
      if (!fromOk || !toOk) errors.toAssignment = 'errorAssignmentInvariant';
    } else if (eventType === EVENT_TYPES.TRANSFER) {
      // Both non-warehouse, OR both warehouse with different ids.
      const bothNonWh =
        s.fromAssignment != null &&
        s.fromAssignment.kind !== ASSIGNMENT_KINDS.WAREHOUSE &&
        s.toAssignment.kind !== ASSIGNMENT_KINDS.WAREHOUSE;
      const bothWh =
        s.fromAssignment != null &&
        s.fromAssignment.kind === ASSIGNMENT_KINDS.WAREHOUSE &&
        s.toAssignment.kind === ASSIGNMENT_KINDS.WAREHOUSE &&
        (s.fromAssignment.id ?? null) !== (s.toAssignment.id ?? null);
      if (!(bothNonWh || bothWh)) {
        errors.toAssignment = 'errorAssignmentInvariant';
      }
    }
  }

  if (!(s.occurredAt instanceof Date) || Number.isNaN(s.occurredAt?.valueOf?.())) {
    errors.occurredAt = 'errorRequired';
  }

  if (s.notes != null && s.notes.length > MAX_NOTES_LENGTH) {
    errors.notes = 'errorNotesTooLong';
  }

  if (s.actUploadPath != null && !ACT_UPLOAD_PATH_REGEX.test(s.actUploadPath)) {
    errors.actUploadPath = 'errorActPathShape';
  }

  return errors;
}

/**
 * @param {AssignmentEventInput} input
 * @returns {boolean}
 */
export function isAssignmentEventInputValid(input) {
  return Object.keys(validateAssignmentEventInput(input)).length === 0;
}

// ---------------------------------------------------------------------------
// Status transition matrix
//
// When the repository writes an event it also nudges the asset's
// `statusId`. This module exports the pure mapping so both the
// repository and the tests reference the same source of truth.
// ---------------------------------------------------------------------------

export const STATUS_AFTER_EVENT = Object.freeze({
  issue: 'assigned',
  return: 'warehouse',
  // transfer keeps the asset assigned/in-place — see deriveStatusAfterEvent.
});

/**
 * Map (eventType, before-statusId) → after-statusId. Returns null when the
 * caller should NOT touch statusId (transfer between two non-warehouse
 * holders preserves the existing assigned/remote/borrowed state; only
 * issue and return have a deterministic target).
 *
 * @param {'issue'|'return'|'transfer'} eventType
 * @param {string|null} beforeStatusId
 * @returns {string|null}
 */
export function deriveStatusAfterEvent(eventType, beforeStatusId) {
  if (eventType === EVENT_TYPES.ISSUE) return STATUS_AFTER_EVENT.issue;
  if (eventType === EVENT_TYPES.RETURN) return STATUS_AFTER_EVENT.return;
  // transfer: leave statusId unchanged.
  return beforeStatusId ?? null;
}

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

export class AssignmentConflictError extends Error {
  /**
   * @param {AssignedTo|null} expected
   * @param {AssignedTo|null} actual
   */
  constructor(expected, actual) {
    super('Assignment changed in another window — refresh and try again');
    this.name = 'AssignmentConflictError';
    this.code = 'assignment/conflict';
    this.expected = expected;
    this.actual = actual;
  }
}
