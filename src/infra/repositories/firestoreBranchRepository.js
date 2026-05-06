/**
 * Firestore adapter implementing the BranchRepository port.
 *
 * Boundary: this is the ONLY module in the React app that imports
 * `firebase/firestore` for the branches collection. Components and hooks
 * compose this adapter through the hooks layer.
 *
 * Atomicity: every write goes through `runTransaction()` so the branch
 * doc and its `audit_logs/{logId}` companion either both succeed or
 * both roll back.
 *
 * @module infra/repositories/firestoreBranchRepository
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
import { sanitizeBranchInput } from '@/domain/branches.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';

/**
 * Pluck only the audit-friendly fields from a branch-shaped object so the
 * audit log's `before` / `after` blobs stay JSON-clean: no FieldValue
 * sentinels, no Firestore Timestamps, no PII beyond what's already in the
 * doc.
 *
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, unknown> | null}
 */
function auditSnapshot(obj) {
  if (!obj) return null;
  return {
    name: obj.name ?? null,
    type: obj.type ?? null,
    address: obj.address ?? null,
    responsibleEmployeeId: obj.responsibleEmployeeId ?? null,
    isActive: obj.isActive ?? null,
  };
}

const COLLECTION = 'branches';

function branchesCollection() {
  return collection(db, COLLECTION);
}

function branchDoc(id) {
  return doc(db, COLLECTION, id);
}

function snapshotToBranch(snap) {
  if (!snap.exists()) return null;
  const data = snap.data();
  return { branchId: snap.id, ...data };
}

/**
 * Subscribe to all branches ordered by `name.ru ASC`.
 * @param {(branches: import('@/domain/branches.js').Branch[]) => void} onData
 * @param {(error: Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeBranches(onData, onError) {
  const q = query(branchesCollection(), orderBy('name.ru', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ branchId: d.id, ...d.data() }));
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

/**
 * Subscribe to a single branch document.
 * @param {string} id
 * @param {(branch: import('@/domain/branches.js').Branch | null) => void} onData
 * @param {(error: Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeBranch(id, onData, onError) {
  return onSnapshot(
    branchDoc(id),
    (snap) => onData(snapshotToBranch(snap)),
    (err) => {
      if (onError) onError(err);
    }
  );
}

/**
 * Atomically create a branch and an audit_logs entry.
 * @param {import('@/domain/branches.js').BranchInput} input
 * @param {{ uid: string, role: string }} actor
 * @returns {Promise<string>} new branchId
 */
export async function createBranch(input, actor) {
  if (!actor?.uid) throw new Error('createBranch: actor.uid required');
  const sanitized = sanitizeBranchInput(input);
  const branchRef = doc(branchesCollection());
  const auditRef = newAuditLogRef();

  await runTransaction(db, async (tx) => {
    const after = {
      branchId: branchRef.id,
      name: sanitized.name,
      type: sanitized.type,
      address: sanitized.address,
      responsibleEmployeeId: sanitized.responsibleEmployeeId,
      isActive: sanitized.isActive,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.set(branchRef, after);
    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'branch',
        entityId: branchRef.id,
        action: 'create',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: null,
        after: auditSnapshot(sanitized),
      })
    );
  });

  return branchRef.id;
}

/**
 * Atomically update a branch and an audit_logs entry.
 * @param {string} id
 * @param {import('@/domain/branches.js').BranchInput} input
 * @param {import('@/domain/branches.js').Branch} before
 * @param {{ uid: string, role: string }} actor
 */
export async function updateBranch(id, input, before, actor) {
  if (!actor?.uid) throw new Error('updateBranch: actor.uid required');
  if (!before) throw new Error('updateBranch: before snapshot required for audit diff');
  const sanitized = sanitizeBranchInput(input);
  const ref = branchDoc(id);
  const auditRef = newAuditLogRef();

  await runTransaction(db, async (tx) => {
    const after = {
      name: sanitized.name,
      type: sanitized.type,
      address: sanitized.address,
      responsibleEmployeeId: sanitized.responsibleEmployeeId,
      isActive: sanitized.isActive,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.update(ref, after);
    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'branch',
        entityId: id,
        action: 'update',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: auditSnapshot(before),
        after: auditSnapshot(sanitized),
      })
    );
  });
}

/**
 * Atomically toggle isActive and write an `activate` | `deactivate` audit row.
 * @param {string} id
 * @param {boolean} isActive
 * @param {import('@/domain/branches.js').Branch} before
 * @param {{ uid: string, role: string }} actor
 */
export async function setBranchActive(id, isActive, before, actor) {
  if (!actor?.uid) throw new Error('setBranchActive: actor.uid required');
  if (!before) throw new Error('setBranchActive: before snapshot required for audit diff');
  const ref = branchDoc(id);
  const auditRef = newAuditLogRef();
  const action = isActive ? 'activate' : 'deactivate';

  await runTransaction(db, async (tx) => {
    const after = {
      isActive,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.update(ref, after);
    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'branch',
        entityId: id,
        action,
        actorUid: actor.uid,
        actorRole: actor.role,
        before: auditSnapshot(before),
        after: { ...auditSnapshot(before), isActive },
      })
    );
  });
}

/**
 * Adapter object matching the `BranchRepository` port shape.
 * Components should depend on this object, not the named exports above,
 * so it stays drop-in replaceable for tests.
 */
export const firestoreBranchRepository = Object.freeze({
  list: subscribeBranches,
  get: subscribeBranch,
  create: createBranch,
  update: updateBranch,
  setActive: setBranchActive,
});
