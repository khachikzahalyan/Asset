/**
 * Firestore adapter implementing the AssetStatusRepository port.
 *
 * Boundary: this is the ONLY module in the React app that imports
 * `firebase/firestore` for the asset_statuses collection. Components and
 * hooks compose this adapter through the hooks layer.
 *
 * Atomicity: every state-changing write goes through `runTransaction()`
 * so the status doc and its `audit_logs/{logId}` companion either both
 * succeed or both roll back.
 *
 * @module infra/repositories/firestoreAssetStatusRepository
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
import { sanitizeAssetStatusInput } from '@/domain/assetStatuses.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';

const COLLECTION = 'asset_statuses';

function statusesCollection() {
  return collection(db, COLLECTION);
}

function statusDoc(id) {
  return doc(db, COLLECTION, id);
}

/**
 * Pluck only the audit-friendly fields from a status-shaped object so
 * the audit log's `before` / `after` blobs stay JSON-clean: no FieldValue
 * sentinels, no Firestore Timestamps.
 *
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, unknown> | null}
 */
function auditSnapshot(obj) {
  if (!obj) return null;
  return {
    name: obj.name ?? null,
    color: obj.color ?? null,
    isFinal: obj.isFinal ?? null,
    isAssignable: obj.isAssignable ?? null,
    sortOrder: obj.sortOrder ?? null,
    isActive: obj.isActive ?? null,
  };
}

function snapshotToStatus(snap) {
  if (!snap.exists()) return null;
  const data = snap.data();
  return { statusId: snap.id, ...data };
}

/**
 * Subscribe to all asset statuses ordered by `sortOrder ASC`.
 *
 * @param {(statuses: import('@/domain/assetStatuses.js').AssetStatus[]) => void} onData
 * @param {(error: Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeAssetStatuses(onData, onError) {
  const q = query(statusesCollection(), orderBy('sortOrder', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ statusId: d.id, ...d.data() }));
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

/**
 * Subscribe to a single asset-status document by id.
 *
 * @param {string} id
 * @param {(status: import('@/domain/assetStatuses.js').AssetStatus | null) => void} onData
 * @param {(error: Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeAssetStatus(id, onData, onError) {
  return onSnapshot(
    statusDoc(id),
    (snap) => onData(snapshotToStatus(snap)),
    (err) => {
      if (onError) onError(err);
    }
  );
}

/**
 * Atomically create an asset status and an audit_logs entry.
 *
 * Callers may pass an explicit `id` to align the doc id with the stable
 * code identifier (e.g. seed bootstrap uses `warehouse`, `assigned`,
 * etc). When `id` is omitted Firestore auto-allocates one.
 *
 * @param {import('@/domain/assetStatuses.js').AssetStatusInput} input
 * @param {{ uid: string, role: string }} actor
 * @param {{ id?: string }} [options]
 * @returns {Promise<string>} new statusId
 */
export async function createAssetStatus(input, actor, options = {}) {
  if (!actor?.uid) throw new Error('createAssetStatus: actor.uid required');
  const sanitized = sanitizeAssetStatusInput(input);
  const statusRef = options.id
    ? statusDoc(options.id)
    : doc(statusesCollection());
  const auditRef = newAuditLogRef();

  await runTransaction(db, async (tx) => {
    const after = {
      statusId: statusRef.id,
      name: sanitized.name,
      color: sanitized.color,
      isFinal: sanitized.isFinal,
      isAssignable: sanitized.isAssignable,
      sortOrder: sanitized.sortOrder,
      isActive: sanitized.isActive,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.set(statusRef, after);

    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'asset_status',
        entityId: statusRef.id,
        action: 'create',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: null,
        after: auditSnapshot(sanitized),
      })
    );
  });

  return statusRef.id;
}

/**
 * Atomically update an asset status and an audit_logs entry.
 *
 * NOTE: the `isFinal` flag is one-way (false -> true OK; true -> false is
 * forbidden). The rules layer enforces that constraint; this repository
 * passes the request through and relies on Firestore to reject it if the
 * caller tries to flip a final status back to non-final. The asset-status
 * Settings UI (Phase 1.5) is responsible for surfacing the error
 * gracefully to the user.
 *
 * @param {string} id
 * @param {import('@/domain/assetStatuses.js').AssetStatusInput} input
 * @param {import('@/domain/assetStatuses.js').AssetStatus} before
 * @param {{ uid: string, role: string }} actor
 */
export async function updateAssetStatus(id, input, before, actor) {
  if (!actor?.uid) throw new Error('updateAssetStatus: actor.uid required');
  if (!before) {
    throw new Error('updateAssetStatus: before snapshot required for audit diff');
  }
  const sanitized = sanitizeAssetStatusInput(input);
  const ref = statusDoc(id);
  const auditRef = newAuditLogRef();

  await runTransaction(db, async (tx) => {
    const after = {
      name: sanitized.name,
      color: sanitized.color,
      isFinal: sanitized.isFinal,
      isAssignable: sanitized.isAssignable,
      sortOrder: sanitized.sortOrder,
      isActive: sanitized.isActive,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.update(ref, after);

    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'asset_status',
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
 * @param {import('@/domain/assetStatuses.js').AssetStatus} before
 * @param {{ uid: string, role: string }} actor
 */
export async function setAssetStatusActive(id, isActive, before, actor) {
  if (!actor?.uid) throw new Error('setAssetStatusActive: actor.uid required');
  if (!before) {
    throw new Error('setAssetStatusActive: before snapshot required for audit diff');
  }
  const ref = statusDoc(id);
  const auditRef = newAuditLogRef();
  const action = isActive ? 'activate' : 'deactivate';

  await runTransaction(db, async (tx) => {
    tx.update(ref, {
      isActive,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'asset_status',
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
 * Adapter object matching the `AssetStatusRepository` port shape.
 * Components should depend on this object, not the named exports above.
 */
export const firestoreAssetStatusRepository = Object.freeze({
  list: subscribeAssetStatuses,
  get: subscribeAssetStatus,
  create: createAssetStatus,
  update: updateAssetStatus,
  setActive: setAssetStatusActive,
});
