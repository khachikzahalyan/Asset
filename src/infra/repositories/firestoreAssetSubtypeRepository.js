/**
 * Firestore adapter for AssetSubtypeRepository.
 *
 * Mirrors firestoreCategoryRepository.js: every mutation runs in a single
 * runTransaction() that writes both the data doc AND the audit_logs entry.
 * Components and hooks must NEVER import this adapter directly — they
 * import the hook (`useAssetSubtypes`) which subscribes through here.
 *
 * @module infra/repositories/firestoreAssetSubtypeRepository
 */

import {
  collection,
  doc,
  getCountFromServer,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';
import {
  AssetSubtypeIdConflictError,
  AssetSubtypeReferencedError,
  sanitizeAssetSubtypeInput,
} from '@/domain/assetSubtypes.js';

const COLLECTION = 'asset_subtypes';

function subtypesCollection() {
  return collection(db, COLLECTION);
}

function subtypeDoc(id) {
  return doc(db, COLLECTION, id);
}

/**
 * Pluck only audit-friendly fields so the audit log's before/after blobs
 * stay JSON-clean (no FieldValue sentinels).
 *
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, unknown> | null}
 */
function auditSnapshot(obj) {
  if (!obj) return null;
  return {
    categoryId: obj.categoryId ?? null,
    name: obj.name ?? null,
    requiresMultilang: obj.requiresMultilang ?? null,
    attachableTo: obj.attachableTo ?? null,
    sortOrder: obj.sortOrder ?? null,
    isActive: obj.isActive ?? null,
  };
}

function snapshotToSubtype(snap) {
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    subtypeId: snap.id,
    categoryId: data.categoryId ?? '',
    name: data.name ?? { ru: '', en: '', hy: '' },
    requiresMultilang: Boolean(data.requiresMultilang),
    attachableTo: data.attachableTo ?? null,
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
    isActive: data.isActive !== false,
    createdAt: data.createdAt ?? null,
    createdBy: data.createdBy ?? '',
    updatedAt: data.updatedAt ?? null,
    updatedBy: data.updatedBy ?? '',
  };
}

/**
 * Subscribe to all asset subtypes ordered by sortOrder ASC.
 *
 * @param {(items: import('@/domain/assetSubtypes.js').AssetSubtype[]) => void} onData
 * @param {(error: Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeAssetSubtypes(onData, onError) {
  const q = query(subtypesCollection(), orderBy('sortOrder', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        subtypeId: d.id,
        categoryId: d.data().categoryId ?? '',
        name: d.data().name ?? { ru: '', en: '', hy: '' },
        requiresMultilang: Boolean(d.data().requiresMultilang),
        attachableTo: d.data().attachableTo ?? null,
        sortOrder: typeof d.data().sortOrder === 'number' ? d.data().sortOrder : 0,
        isActive: d.data().isActive !== false,
        createdAt: d.data().createdAt ?? null,
        createdBy: d.data().createdBy ?? '',
        updatedAt: d.data().updatedAt ?? null,
        updatedBy: d.data().updatedBy ?? '',
      }));
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

/**
 * Subscribe to a single subtype document.
 */
export function subscribeAssetSubtype(id, onData, onError) {
  return onSnapshot(
    subtypeDoc(id),
    (snap) => onData(snapshotToSubtype(snap)),
    (err) => {
      if (onError) onError(err);
    }
  );
}

/**
 * Atomically create a subtype and an audit_logs entry. Caller MUST
 * provide a stable id via `options.id` (the seed catalog uses
 * `${categoryId}_${slug}`).
 *
 * @param {import('@/domain/assetSubtypes.js').AssetSubtypeInput} input
 * @param {{ uid: string, role: string }} actor
 * @param {{ id?: string }} [options]
 * @returns {Promise<string>} the new subtype id
 */
export async function createAssetSubtype(input, actor, options = {}) {
  if (!actor?.uid) {
    throw new Error('createAssetSubtype: actor.uid required');
  }
  const id = (options.id ?? '').trim();
  if (!id) {
    throw new Error('createAssetSubtype: options.id required');
  }

  const sanitized = sanitizeAssetSubtypeInput(input);
  const ref = subtypeDoc(id);
  const auditRef = newAuditLogRef();

  await runTransaction(db, async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists?.()) {
      throw new AssetSubtypeIdConflictError(id);
    }
    const after = {
      categoryId: sanitized.categoryId,
      name: sanitized.name,
      requiresMultilang: sanitized.requiresMultilang,
      attachableTo: sanitized.attachableTo,
      sortOrder: sanitized.sortOrder,
      isActive: sanitized.isActive,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.set(ref, after);

    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'asset_subtype',
        entityId: id,
        action: 'create',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: null,
        after: auditSnapshot(sanitized),
      })
    );
  });

  return id;
}

/**
 * Atomically update a subtype and an audit_logs entry.
 *
 * @param {string} id
 * @param {import('@/domain/assetSubtypes.js').AssetSubtypeInput} patch
 * @param {import('@/domain/assetSubtypes.js').AssetSubtype} before
 * @param {{ uid: string, role: string }} actor
 */
export async function updateAssetSubtype(id, patch, before, actor) {
  if (!actor?.uid) {
    throw new Error('updateAssetSubtype: actor.uid required');
  }
  if (!before) {
    throw new Error('updateAssetSubtype: before snapshot required for audit diff');
  }
  // categoryId is immutable post-create. Always reuse the existing one.
  const sanitized = sanitizeAssetSubtypeInput({
    categoryId: before.categoryId,
    name: patch.name === undefined ? before.name : patch.name,
    requiresMultilang:
      patch.requiresMultilang === undefined
        ? before.requiresMultilang
        : patch.requiresMultilang,
    attachableTo:
      patch.attachableTo === undefined ? before.attachableTo : patch.attachableTo,
    sortOrder:
      patch.sortOrder === undefined ? before.sortOrder : patch.sortOrder,
    isActive: patch.isActive === undefined ? before.isActive : patch.isActive,
  });
  const ref = subtypeDoc(id);
  const auditRef = newAuditLogRef();

  await runTransaction(db, async (tx) => {
    const after = {
      name: sanitized.name,
      requiresMultilang: sanitized.requiresMultilang,
      attachableTo: sanitized.attachableTo,
      sortOrder: sanitized.sortOrder,
      isActive: sanitized.isActive,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.update(ref, after);

    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'asset_subtype',
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
 *
 * @param {string} id
 * @param {boolean} isActive
 * @param {import('@/domain/assetSubtypes.js').AssetSubtype} before
 * @param {{ uid: string, role: string }} actor
 */
export async function setAssetSubtypeActive(id, isActive, before, actor) {
  if (!actor?.uid) {
    throw new Error('setAssetSubtypeActive: actor.uid required');
  }
  if (!before) {
    throw new Error('setAssetSubtypeActive: before snapshot required for audit diff');
  }
  const ref = subtypeDoc(id);
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
        entity: 'asset_subtype',
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
 * Hard-delete a sub-type.
 *
 * Pre-flight: count the assets referencing `subtypeId == id`. If > 0,
 * throw AssetSubtypeReferencedError carrying the count so the UI can
 * surface a specific error message.
 *
 * Inside `runTransaction`: delete the sub-type doc and write a single
 * audit_logs row with `action: 'deleted'` carrying the `before` snapshot
 * for forensics.
 *
 * Server-side enforcement: `firestore.rules` permits delete on
 * `/asset_subtypes/{id}` for super_admin only. If the rules deploy
 * hasn't shipped yet, the transaction will reject with `permission-denied`
 * and the calling page surfaces it as an alert.
 *
 * @param {string} id
 * @param {import('@/domain/assetSubtypes.js').AssetSubtype} before
 * @param {{ uid: string, role: string }} actor
 * @throws {AssetSubtypeReferencedError} when any asset references this subtype.
 */
export async function deleteAssetSubtype(id, before, actor) {
  if (!actor?.uid) throw new Error('deleteAssetSubtype: actor.uid required');
  if (!before) {
    throw new Error('deleteAssetSubtype: before snapshot required for audit diff');
  }

  const assetsQ = query(
    collection(db, 'assets'),
    where('subtypeId', '==', id)
  );
  const assetsSnap = await getCountFromServer(assetsQ);
  const assetCount = assetsSnap.data().count;
  if (assetCount > 0) {
    throw new AssetSubtypeReferencedError(id, { assetCount });
  }

  const ref = subtypeDoc(id);
  const auditRef = newAuditLogRef();

  await runTransaction(db, async (tx) => {
    tx.delete(ref);
    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'asset_subtype',
        entityId: id,
        action: 'deleted',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: auditSnapshot(before),
        after: null,
      })
    );
  });
}

/**
 * Adapter object matching the AssetSubtypeRepository port shape.
 */
export const firestoreAssetSubtypeRepository = Object.freeze({
  list: subscribeAssetSubtypes,
  get: subscribeAssetSubtype,
  create: createAssetSubtype,
  update: updateAssetSubtype,
  setActive: setAssetSubtypeActive,
  delete: deleteAssetSubtype,
});
