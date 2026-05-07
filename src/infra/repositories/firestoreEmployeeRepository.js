/**
 * Firestore adapter implementing the EmployeeRepository port.
 *
 * Boundary: this is the ONLY module in the React app that imports
 * `firebase/firestore` for the employees + email_index collections.
 * Components and hooks compose this adapter through the hooks layer.
 *
 * Atomicity: every write goes through `runTransaction()` so the entity doc,
 * the `email_index/{emailKey}` sentinel, and the `audit_logs/{logId}`
 * companion either all succeed or all roll back.
 *
 * @module infra/repositories/firestoreEmployeeRepository
 */

import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';
import {
  sanitizeEmployeeInput,
  emailKey,
  EmployeeEmailTakenError,
  EmployeeHasActiveAssignmentsError,
} from '@/domain/employees.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';

// ---------------------------------------------------------------------------
// Audit blob shaping
//
// The audit log stores JSON-clean snapshots — no FieldValue sentinels, no
// Firestore Timestamps. We convert Timestamps to millis so the blob round-
// trips cleanly.
// ---------------------------------------------------------------------------

/**
 * Convert a value that may be a Firestore Timestamp into millis or null.
 * @param {unknown} value
 * @returns {number | null}
 */
function timestampToMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  return null;
}

function auditSnapshot(obj) {
  if (!obj) return null;
  return {
    firstName: obj.firstName ?? null,
    lastName: obj.lastName ?? null,
    email: obj.email ?? null,
    phone: obj.phone ?? null,
    branchId: obj.branchId ?? null,
    departmentId: obj.departmentId ?? null,
    department: obj.department ?? null,
    isActive: obj.isActive ?? null,
    terminatedAt: timestampToMillis(obj.terminatedAt),
  };
}

// ---------------------------------------------------------------------------
// Collection / doc refs
// ---------------------------------------------------------------------------

const EMPLOYEES = 'employees';
const EMAIL_INDEX = 'email_index';

function employeesCollection() {
  return collection(db, EMPLOYEES);
}

function employeeDoc(id) {
  return doc(db, EMPLOYEES, id);
}

function emailIndexDoc(key) {
  return doc(db, EMAIL_INDEX, key);
}

function snapshotToEmployee(snap) {
  if (!snap.exists()) return null;
  return { employeeId: snap.id, ...snap.data() };
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/**
 * Subscribe to all employees ordered by `lastName ASC`.
 * @param {(items: import('@/domain/employees.js').Employee[]) => void} onData
 * @param {(error: Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeEmployees(onData, onError) {
  const q = query(employeesCollection(), orderBy('lastName', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ employeeId: d.id, ...d.data() }));
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

/**
 * Subscribe to a single employee document.
 * @param {string} id
 * @param {(employee: import('@/domain/employees.js').Employee | null) => void} onData
 * @param {(error: Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeEmployee(id, onData, onError) {
  return onSnapshot(
    employeeDoc(id),
    (snap) => onData(snapshotToEmployee(snap)),
    (err) => {
      if (onError) onError(err);
    }
  );
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Atomically create an employee, the email_index sentinel, and an
 * audit_logs entry. Rejects with EmployeeEmailTakenError if the email is
 * already indexed.
 *
 * @param {import('@/domain/employees.js').EmployeeInput} input
 * @param {{ uid: string, role: string }} actor
 * @returns {Promise<string>} new employeeId
 */
export async function createEmployee(input, actor) {
  if (!actor?.uid) throw new Error('createEmployee: actor.uid required');
  const sanitized = sanitizeEmployeeInput(input);
  const key = emailKey(sanitized.email);
  if (!key) throw new Error('createEmployee: email required');

  const empRef = doc(employeesCollection());
  const idxRef = emailIndexDoc(key);
  const auditRef = newAuditLogRef();

  await runTransaction(db, async (tx) => {
    const idxSnap = await tx.get(idxRef);
    if (idxSnap.exists()) {
      throw new EmployeeEmailTakenError(sanitized.email);
    }

    const after = {
      employeeId: empRef.id,
      firstName: sanitized.firstName,
      lastName: sanitized.lastName,
      email: sanitized.email,
      phone: sanitized.phone,
      branchId: sanitized.branchId,
      departmentId: sanitized.departmentId,
      department: sanitized.department,
      isActive: sanitized.isActive,
      terminatedAt: null,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };

    tx.set(empRef, after);
    tx.set(idxRef, {
      employeeId: empRef.id,
      createdAt: serverTimestamp(),
    });
    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'employee',
        entityId: empRef.id,
        action: 'create',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: null,
        after: auditSnapshot(sanitized),
        relatedEmployeeId: empRef.id,
      })
    );
  });

  return empRef.id;
}

/**
 * Atomically update an employee + audit row. If email changed, also moves
 * the email_index sentinel inside the same transaction (collision-checked).
 *
 * @param {string} id
 * @param {import('@/domain/employees.js').EmployeeInput} input
 * @param {import('@/domain/employees.js').Employee} before
 * @param {{ uid: string, role: string }} actor
 */
export async function updateEmployee(id, input, before, actor) {
  if (!actor?.uid) throw new Error('updateEmployee: actor.uid required');
  if (!before) throw new Error('updateEmployee: before snapshot required for audit diff');
  const sanitized = sanitizeEmployeeInput(input);
  const newKey = emailKey(sanitized.email);
  if (!newKey) throw new Error('updateEmployee: email required');

  const oldKey = emailKey(before.email ?? '');
  const empRef = employeeDoc(id);
  const auditRef = newAuditLogRef();
  const newIdxRef = newKey !== oldKey ? emailIndexDoc(newKey) : null;
  const oldIdxRef = newKey !== oldKey && oldKey ? emailIndexDoc(oldKey) : null;

  await runTransaction(db, async (tx) => {
    if (newIdxRef) {
      const idxSnap = await tx.get(newIdxRef);
      if (idxSnap.exists() && idxSnap.data()?.employeeId !== id) {
        throw new EmployeeEmailTakenError(sanitized.email);
      }
    }

    const after = {
      firstName: sanitized.firstName,
      lastName: sanitized.lastName,
      email: sanitized.email,
      phone: sanitized.phone,
      branchId: sanitized.branchId,
      departmentId: sanitized.departmentId,
      department: sanitized.department,
      isActive: sanitized.isActive,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.update(empRef, after);

    if (newIdxRef) {
      if (oldIdxRef) tx.delete(oldIdxRef);
      tx.set(newIdxRef, {
        employeeId: id,
        createdAt: serverTimestamp(),
      });
    }

    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'employee',
        entityId: id,
        action: 'update',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: auditSnapshot(before),
        after: auditSnapshot(sanitized),
        relatedEmployeeId: id,
      })
    );
  });
}

/**
 * Atomically toggle isActive and write a `deactivate` | `activate` |
 * `reactivate` audit row. Refuses to deactivate if active assignments exist.
 *
 * - `activate`   : isActive flipped from false -> true on a never-terminated row.
 * - `reactivate` : isActive flipped from false -> true on a previously terminated row.
 * - `deactivate` : isActive flipped from true -> false. Sets terminatedAt to now.
 *
 * @param {string} id
 * @param {boolean} isActive
 * @param {import('@/domain/employees.js').Employee} before
 * @param {{ uid: string, role: string }} actor
 * @param {{ activeAssignmentCount?: number }} [opts]
 */
export async function setEmployeeActive(id, isActive, before, actor, opts = {}) {
  if (!actor?.uid) throw new Error('setEmployeeActive: actor.uid required');
  if (!before) throw new Error('setEmployeeActive: before snapshot required for audit diff');

  const count = opts.activeAssignmentCount ?? 0;
  if (!isActive && count > 0) {
    throw new EmployeeHasActiveAssignmentsError(count);
  }

  const ref = employeeDoc(id);
  const auditRef = newAuditLogRef();

  let action;
  if (!isActive) {
    action = 'deactivate';
  } else if (before.terminatedAt != null) {
    action = 'reactivate';
  } else {
    action = 'activate';
  }

  await runTransaction(db, async (tx) => {
    const after = {
      isActive,
      // Set terminatedAt on deactivate; clear it on (re)activate.
      terminatedAt: isActive ? null : serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.update(ref, after);

    // The audit blob stays JSON-clean: server timestamps cannot be
    // serialized inside the log row. On deactivate the audit `after` blob
    // therefore mirrors the snapshot of `before` with `isActive: false` and
    // `terminatedAt: null` — readers should rely on `audit_logs.at` (the
    // server timestamp on the row itself) when they need the wall-clock
    // moment of termination, not the entity's `terminatedAt` field.
    const auditAfter = {
      ...auditSnapshot(before),
      isActive,
      terminatedAt: null,
    };

    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'employee',
        entityId: id,
        action,
        actorUid: actor.uid,
        actorRole: actor.role,
        before: auditSnapshot(before),
        after: auditAfter,
        relatedEmployeeId: id,
      })
    );
  });
}

/**
 * Adapter object matching the `EmployeeRepository` port shape.
 * Components should depend on this object, not the named exports above,
 * so it stays drop-in replaceable for tests.
 */
export const firestoreEmployeeRepository = Object.freeze({
  list: subscribeEmployees,
  get: subscribeEmployee,
  create: createEmployee,
  update: updateEmployee,
  setActive: setEmployeeActive,
});
