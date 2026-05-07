/**
 * Firestore adapter for the AssignmentEventRepository port (Wave-1 Step 4).
 *
 * Boundary: this module is the ONLY place in the React app that imports
 * `firebase/firestore` for the `assignment_events` collection. UI
 * surfaces consume it via the `useAssignmentEvents` hook plus the
 * `firestoreAssignmentEventRepository.create` adapter call.
 *
 * Atomicity contract (`create`):
 *   1. Read the asset doc.
 *   2. Compare `asset.assignedTo` to `input.fromAssignment` — bail with
 *      `AssignmentConflictError` if they differ. This is the optimistic
 *      concurrency check; without it two admins could each click "Issue"
 *      from a stale dialog and produce inconsistent history.
 *   3. Update `assets/{assetId}.assignedTo` (and `statusId` per the
 *      transition matrix in `domain/assignmentEvents.js`).
 *   4. Append `assignment_events/{eventId}`.
 *   5. Append `audit_logs/{auditId}` via `buildAuditLog`. Action token
 *      mirrors `eventType` (`'issue' | 'return' | 'transfer'`) — note
 *      these are NOT the `assign / unassign / transfer` legacy strings
 *      Step-2 logged. The new strings line up with the AMS plan §6
 *      vocabulary; legacy `assign / unassign` rows are still valid in
 *      the audit feed (forward-compat per `audit.actionLabelKey`).
 *
 * No update / delete methods — events are immutable by design and
 * Firestore rules enforce that at the database edge.
 *
 * @module infra/repositories/firestoreAssignmentEventRepository
 */

import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';
import {
  sanitizeAssignmentEventInput,
  validateAssignmentEventInput,
  deriveEventType,
  deriveStatusAfterEvent,
  AssignmentConflictError,
  EVENT_TYPES,
} from '@/domain/assignmentEvents.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';

// ---------------------------------------------------------------------------
// Refs
// ---------------------------------------------------------------------------

const ASSETS = 'assets';
const ASSIGNMENT_EVENTS = 'assignment_events';

function eventsCollection() {
  return collection(db, ASSIGNMENT_EVENTS);
}

function assetDoc(id) {
  return doc(db, ASSETS, id);
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/**
 * Subscribe to assignment events for one asset, newest first.
 *
 * @param {string} assetId
 * @param {(events: import('@/domain/assignmentEvents.js').AssignmentEvent[]) => void} onData
 * @param {(error: Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeAssignmentEventsByAsset(assetId, onData, onError) {
  const q = query(
    eventsCollection(),
    where('assetId', '==', assetId),
    orderBy('occurredAt', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ eventId: d.id, ...d.data() }));
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function comparableAssigned(a) {
  // Normalize for equality: warehouse always { kind:'warehouse', id:null }.
  if (!a || typeof a !== 'object') return null;
  const id = a.kind === 'warehouse' ? null : (a.id ?? null);
  return { kind: a.kind, id };
}

function assignedEqual(a, b) {
  const x = comparableAssigned(a);
  const y = comparableAssigned(b);
  if (x == null || y == null) return x === y;
  return x.kind === y.kind && x.id === y.id;
}

/**
 * Atomically:
 *   1. verify the asset's `assignedTo` still matches `input.fromAssignment`
 *      (`AssignmentConflictError` on mismatch),
 *   2. update the asset (assignedTo + status per transition matrix),
 *   3. append the event,
 *   4. append the audit-logs row.
 *
 * @param {import('@/domain/assignmentEvents.js').AssignmentEventInput} input
 * @param {{ uid: string, role: string }} actor
 * @returns {Promise<string>} new eventId
 */
export async function createAssignmentEvent(input, actor) {
  if (!actor?.uid) throw new Error('createAssignmentEvent: actor.uid required');

  const sanitized = sanitizeAssignmentEventInput(input);
  const errors = validateAssignmentEventInput(sanitized);
  if (Object.keys(errors).length > 0) {
    const err = new Error(
      `createAssignmentEvent: invalid input: ${Object.keys(errors).join(', ')}`
    );
    err.code = 'assignment/invalid-input';
    err.fieldErrors = errors;
    throw err;
  }

  const eventType = deriveEventType(sanitized.fromAssignment, sanitized.toAssignment);
  if (!eventType) {
    throw new Error('createAssignmentEvent: could not derive eventType');
  }

  const eventRef = doc(eventsCollection());
  const auditRef = newAuditLogRef();
  const aRef = assetDoc(sanitized.assetId);

  const occurredAtTs = Timestamp.fromDate(sanitized.occurredAt);

  return runTransaction(db, async (tx) => {
    const aSnap = await tx.get(aRef);
    if (!aSnap.exists()) {
      const err = new Error('createAssignmentEvent: asset not found');
      err.code = 'assignment/asset-not-found';
      throw err;
    }
    const before = aSnap.data();
    const liveAssigned = before.assignedTo ?? null;

    if (!assignedEqual(liveAssigned, sanitized.fromAssignment)) {
      throw new AssignmentConflictError(sanitized.fromAssignment, liveAssigned);
    }

    const nextStatusId = deriveStatusAfterEvent(eventType, before.statusId ?? null);
    const assetPatch = {
      assignedTo: sanitized.toAssignment,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    if (nextStatusId && nextStatusId !== before.statusId) {
      assetPatch.statusId = nextStatusId;
    }
    // When the new holder is an employee/branch, the asset's location
    // (branchId) is not auto-derived — Step 2 keeps branchId as a
    // free-form location field set during create/edit. We leave it
    // alone here; if the customer wants a stronger invariant later,
    // it lands in Wave-2 alongside the act-upload UI.
    if (
      sanitized.toAssignment.kind === 'employee' ||
      sanitized.toAssignment.kind === 'department'
    ) {
      // Per Step 2 sanitizer rules, branchId is null in employee or
      // department modes. Mirror that here so detail rows stay
      // consistent with the form-side normalization.
      assetPatch.branchId = null;
    }

    tx.update(aRef, assetPatch);

    const eventDoc = {
      eventId: eventRef.id,
      assetId: sanitized.assetId,
      fromAssignment: sanitized.fromAssignment,
      toAssignment: sanitized.toAssignment,
      eventType,
      occurredAt: occurredAtTs,
      notes: sanitized.notes ?? null,
      actUploadPath: sanitized.actUploadPath ?? null,
      actorUid: actor.uid,
      actorRole: actor.role ?? 'system',
      createdAt: serverTimestamp(),
    };
    tx.set(eventRef, eventDoc);

    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'assignment',
        entityId: eventRef.id,
        action: eventType,
        actorUid: actor.uid,
        actorRole: actor.role,
        before: { assignedTo: sanitized.fromAssignment, statusId: before.statusId ?? null },
        after: {
          assignedTo: sanitized.toAssignment,
          statusId: assetPatch.statusId ?? before.statusId ?? null,
        },
        meta: {
          eventType,
          notes: sanitized.notes ?? null,
          actUploadPath: sanitized.actUploadPath ?? null,
        },
        relatedAssetId: sanitized.assetId,
        relatedEmployeeId:
          sanitized.toAssignment?.kind === 'employee'
            ? sanitized.toAssignment.id
            : sanitized.fromAssignment?.kind === 'employee'
              ? sanitized.fromAssignment.id
              : null,
      })
    );

    return eventRef.id;
  });
}

// ---------------------------------------------------------------------------
// Adapter object — port shape
// ---------------------------------------------------------------------------

export const firestoreAssignmentEventRepository = Object.freeze({
  listByAsset: subscribeAssignmentEventsByAsset,
  create: createAssignmentEvent,
});

// Re-export the conflict error so consumers don't need a second import path.
export { AssignmentConflictError, EVENT_TYPES };
