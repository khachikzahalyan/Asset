/**
 * Firestore adapter implementing the AssetRepository port.
 *
 * Boundary: this is the ONLY module in the React app that imports
 * `firebase/firestore` for the assets + category_counters collections (in
 * the asset-create flow). Components and hooks compose this adapter
 * through the hooks layer.
 *
 * Atomicity: every state-changing write goes through `runTransaction()`
 * so the asset doc, the matching `category_counters/{categoryId}`
 * increment (on create), and the `audit_logs/{logId}` companion either
 * all succeed or all roll back. Collisions on the inventory code are
 * impossible by construction — the counter doc is the source of truth
 * and Firestore guarantees serial-equivalent transaction semantics.
 *
 * Status changes go through the dedicated `setStatus` method (audit
 * `action: 'status_change'`). The status-change history subcollection
 * (`/asset_status_log/{assetId}`) is a Step-4 concern; for now we rely
 * on `audit_logs` as the canonical history.
 *
 * @module infra/repositories/firestoreAssetRepository
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
} from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';
import {
  sanitizeAssetInput,
  validateAssetInput,
  formatInventoryCode,
  AssetCategoryInactiveError,
  AssetCounterMissingError,
} from '@/domain/assets.js';
import { AssetSubtypeInactiveError } from '@/domain/assetSubtypes.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';

// ---------------------------------------------------------------------------
// Collection / doc refs
// ---------------------------------------------------------------------------

const ASSETS = 'assets';
const CATEGORIES = 'categories';
const CATEGORY_COUNTERS = 'category_counters';
const ASSET_SUBTYPES = 'asset_subtypes';

function assetsCollection() {
  return collection(db, ASSETS);
}

function assetDoc(id) {
  return doc(db, ASSETS, id);
}

function categoryDoc(id) {
  return doc(db, CATEGORIES, id);
}

function categoryCounterDoc(id) {
  return doc(db, CATEGORY_COUNTERS, id);
}

function assetSubtypeDoc(id) {
  return doc(db, ASSET_SUBTYPES, id);
}

function snapshotToAsset(snap) {
  if (!snap.exists()) return null;
  return { assetId: snap.id, ...snap.data() };
}

// ---------------------------------------------------------------------------
// Audit blob shaping
//
// The audit log stores JSON-clean snapshots — no FieldValue sentinels, no
// Firestore Timestamps. We convert Timestamps to millis so the blob
// round-trips cleanly.
// ---------------------------------------------------------------------------

function timestampToMillis(value) {
  if (value == null) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.valueOf();
  return null;
}

function auditSnapshot(obj) {
  if (!obj) return null;
  return {
    inventoryCode: obj.inventoryCode ?? null,
    categoryId: obj.categoryId ?? null,
    subtypeId: obj.subtypeId ?? null,
    statusId: obj.statusId ?? null,
    name: obj.name ?? null,
    brand: obj.brand ?? null,
    model: obj.model ?? null,
    serialNumber: obj.serialNumber ?? null,
    branchId: obj.branchId ?? null,
    assignedTo: obj.assignedTo ?? null,
    notes: obj.notes ?? null,
    purchaseDate: timestampToMillis(obj.purchaseDate),
    purchasePrice: obj.purchasePrice ?? null,
    condition: obj.condition ?? null,
    warrantyStart: timestampToMillis(obj.warrantyStart),
    warrantyEnd: timestampToMillis(obj.warrantyEnd),
    isActive: obj.isActive ?? null,
  };
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/**
 * Subscribe to all assets ordered by `inventoryCode ASC`.
 * @param {(items: import('@/domain/assets.js').Asset[]) => void} onData
 * @param {(error: Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeAssets(onData, onError) {
  const q = query(assetsCollection(), orderBy('inventoryCode', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ assetId: d.id, ...d.data() }));
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

/**
 * Subscribe to a single asset document by id.
 * @param {string} id
 * @param {(asset: import('@/domain/assets.js').Asset | null) => void} onData
 * @param {(error: Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeAsset(id, onData, onError) {
  return onSnapshot(
    assetDoc(id),
    (snap) => onData(snapshotToAsset(snap)),
    (err) => {
      if (onError) onError(err);
    }
  );
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Atomically create an asset, increment the matching category counter,
 * and write an `audit_logs` entry.
 *
 * Throws:
 *   - `AssetCategoryInactiveError` if the referenced category doesn't
 *     exist or has `isActive === false`.
 *   - `AssetCounterMissingError` if `category_counters/{categoryId}` is
 *     missing — the bootstrap should have created it.
 *
 * @param {import('@/domain/assets.js').AssetInput} input
 * @param {{ uid: string, role: string }} actor
 * @param {{ category?: { requiresMultilang: boolean } | null }} [opts]
 *   Pass the resolved category so the sanitizer can shape `name`
 *   correctly. The transaction also reads the live category doc and
 *   rejects on inactive — opts.category is purely a sanitizer hint.
 * @returns {Promise<string>} new assetId
 */
export async function createAsset(input, actor, opts = {}) {
  if (!actor?.uid) throw new Error('createAsset: actor.uid required');
  const sanitized = sanitizeAssetInput(input, opts);
  if (!sanitized.categoryId) {
    throw new Error('createAsset: categoryId required');
  }
  if (!sanitized.subtypeId) {
    throw new Error('createAsset: subtypeId required');
  }

  const assetRef = doc(assetsCollection());
  const auditRef = newAuditLogRef();
  const catRef = categoryDoc(sanitized.categoryId);
  const counterRef = categoryCounterDoc(sanitized.categoryId);
  const subtypeRef = assetSubtypeDoc(sanitized.subtypeId);

  const purchaseDateTs = sanitized.purchaseDate
    ? Timestamp.fromDate(sanitized.purchaseDate)
    : null;
  const warrantyStartTs = sanitized.warrantyStart
    ? Timestamp.fromDate(sanitized.warrantyStart)
    : null;
  const warrantyEndTs = sanitized.warrantyEnd
    ? Timestamp.fromDate(sanitized.warrantyEnd)
    : null;

  return runTransaction(db, async (tx) => {
    const catSnap = await tx.get(catRef);
    if (!catSnap.exists()) {
      throw new AssetCategoryInactiveError(sanitized.categoryId);
    }
    const cat = catSnap.data();
    if (cat?.isActive === false) {
      throw new AssetCategoryInactiveError(sanitized.categoryId);
    }
    const prefix = cat?.inventoryCodePrefix;
    if (!prefix) {
      throw new Error(
        `createAsset: category ${sanitized.categoryId} missing inventoryCodePrefix`
      );
    }

    const counterSnap = await tx.get(counterRef);
    if (!counterSnap.exists()) {
      throw new AssetCounterMissingError(sanitized.categoryId);
    }
    const next = counterSnap.data()?.next;
    if (typeof next !== 'number' || !Number.isInteger(next) || next < 1) {
      throw new Error(
        `createAsset: counter for ${sanitized.categoryId} is malformed`
      );
    }

    // Subtype validation — load and check attachableTo invariant.
    const subtypeSnap = await tx.get(subtypeRef);
    if (!subtypeSnap.exists() || subtypeSnap.data()?.isActive === false) {
      throw new AssetSubtypeInactiveError(sanitized.subtypeId);
    }
    const subtype = subtypeSnap.data();

    // Re-run domain validator with the loaded subtype context. The form
    // should have caught this — surface as a generic invariant error.
    const formErrors = validateAssetInput(sanitized, {
      category: opts.category ?? null,
      subtype: { attachableTo: subtype.attachableTo ?? null },
    });
    if (Object.keys(formErrors).length > 0) {
      throw new Error(`asset/invariant: ${JSON.stringify(formErrors)}`);
    }

    const inventoryCode = formatInventoryCode(prefix, next);

    // Strict-monotonic-by-one increment — matches firestore.rules.
    tx.update(counterRef, {
      next: next + 1,
      updatedAt: serverTimestamp(),
    });

    const after = {
      assetId: assetRef.id,
      inventoryCode,
      categoryId: sanitized.categoryId,
      subtypeId: sanitized.subtypeId,
      statusId: sanitized.statusId,
      name: sanitized.name,
      brand: sanitized.brand,
      model: sanitized.model,
      serialNumber: sanitized.serialNumber,
      branchId: sanitized.branchId,
      assignedTo: sanitized.assignedTo,
      notes: sanitized.notes,
      purchaseDate: purchaseDateTs,
      purchasePrice: sanitized.purchasePrice,
      condition: sanitized.condition,
      warrantyStart: warrantyStartTs,
      warrantyEnd: warrantyEndTs,
      isActive: sanitized.isActive,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.set(assetRef, after);

    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'asset',
        entityId: assetRef.id,
        action: 'create',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: null,
        after: auditSnapshot({
          ...sanitized,
          inventoryCode,
          purchaseDate: sanitized.purchaseDate,
          warrantyStart: sanitized.warrantyStart,
          warrantyEnd: sanitized.warrantyEnd,
        }),
        relatedAssetId: assetRef.id,
        relatedEmployeeId:
          sanitized.assignedTo?.kind === 'employee' ? sanitized.assignedTo.id : null,
      })
    );

    return assetRef.id;
  });
}

/**
 * Atomically update an asset's metadata + audit row.
 *
 * Excludes `inventoryCode`, `categoryId`, and `statusId` from the patch:
 *   - `inventoryCode` is immutable for the lifetime of the asset.
 *   - `categoryId` is immutable (changing categories would break the
 *     prefix invariant baked into the inventory code).
 *   - `statusId` goes through `setStatus()` so the audit row can be
 *     `action: 'status_change'` with a meaningful before/after diff.
 *
 * @param {string} id
 * @param {import('@/domain/assets.js').AssetInput} input
 * @param {import('@/domain/assets.js').Asset} before
 * @param {{ uid: string, role: string }} actor
 * @param {{ category?: { requiresMultilang: boolean } | null }} [opts]
 */
export async function updateAsset(id, input, before, actor, opts = {}) {
  if (!actor?.uid) throw new Error('updateAsset: actor.uid required');
  if (!before) throw new Error('updateAsset: before snapshot required for audit diff');
  const sanitized = sanitizeAssetInput(input, opts);

  const ref = assetDoc(id);
  const auditRef = newAuditLogRef();

  const purchaseDateTs = sanitized.purchaseDate
    ? Timestamp.fromDate(sanitized.purchaseDate)
    : null;
  const warrantyStartTs = sanitized.warrantyStart
    ? Timestamp.fromDate(sanitized.warrantyStart)
    : null;
  const warrantyEndTs = sanitized.warrantyEnd
    ? Timestamp.fromDate(sanitized.warrantyEnd)
    : null;

  // Subtype invariant must be re-checked when the subtypeId or the
  // assignedTo target changes (the two factors that drive
  // `attachableTo` enforcement). If neither changed we trust the
  // existing invariant.
  const subtypeIdChanged =
    sanitized.subtypeId && sanitized.subtypeId !== before.subtypeId;
  const assignedToChanged =
    JSON.stringify(sanitized.assignedTo) !== JSON.stringify(before.assignedTo);
  const needsSubtypeCheck = Boolean(sanitized.subtypeId) && (subtypeIdChanged || assignedToChanged);
  const subtypeRef = needsSubtypeCheck
    ? assetSubtypeDoc(sanitized.subtypeId)
    : null;

  await runTransaction(db, async (tx) => {
    if (subtypeRef) {
      const subtypeSnap = await tx.get(subtypeRef);
      if (!subtypeSnap.exists() || subtypeSnap.data()?.isActive === false) {
        throw new AssetSubtypeInactiveError(sanitized.subtypeId);
      }
      const subtype = subtypeSnap.data();
      const formErrors = validateAssetInput(sanitized, {
        category: opts.category ?? null,
        subtype: { attachableTo: subtype.attachableTo ?? null },
      });
      if (Object.keys(formErrors).length > 0) {
        throw new Error(`asset/invariant: ${JSON.stringify(formErrors)}`);
      }
    }

    const after = {
      // categoryId & inventoryCode & statusId NOT touched here.
      name: sanitized.name,
      brand: sanitized.brand,
      model: sanitized.model,
      serialNumber: sanitized.serialNumber,
      branchId: sanitized.branchId,
      assignedTo: sanitized.assignedTo,
      notes: sanitized.notes,
      purchaseDate: purchaseDateTs,
      purchasePrice: sanitized.purchasePrice,
      condition: sanitized.condition,
      warrantyStart: warrantyStartTs,
      warrantyEnd: warrantyEndTs,
      isActive: sanitized.isActive,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    // Only patch subtypeId when the caller explicitly provided one — mirrors
    // the existing convention that the patch shape only carries fields the
    // caller actually wants to change.
    if (sanitized.subtypeId) {
      after.subtypeId = sanitized.subtypeId;
    }
    tx.update(ref, after);

    // Compose the audit `after` blob from the merged shape (the immutable
    // fields stay equal to `before`).
    const mergedAfter = {
      inventoryCode: before.inventoryCode,
      categoryId: before.categoryId,
      subtypeId: sanitized.subtypeId || before.subtypeId,
      statusId: before.statusId,
      name: sanitized.name,
      brand: sanitized.brand,
      model: sanitized.model,
      serialNumber: sanitized.serialNumber,
      branchId: sanitized.branchId,
      assignedTo: sanitized.assignedTo,
      notes: sanitized.notes,
      purchaseDate: sanitized.purchaseDate,
      purchasePrice: sanitized.purchasePrice,
      condition: sanitized.condition,
      warrantyStart: sanitized.warrantyStart,
      warrantyEnd: sanitized.warrantyEnd,
      isActive: sanitized.isActive,
    };

    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'asset',
        entityId: id,
        action: 'update',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: auditSnapshot(before),
        after: auditSnapshot(mergedAfter),
        relatedAssetId: id,
        relatedEmployeeId:
          sanitized.assignedTo?.kind === 'employee' ? sanitized.assignedTo.id : null,
      })
    );
  });
}

/**
 * Atomically change the asset's status and write a `status_change`
 * audit row. The audit `meta` carries the from/to status ids and an
 * optional comment so downstream readers don't have to diff the two
 * snapshots to find the transition.
 *
 * @param {string} id
 * @param {string} statusId
 * @param {import('@/domain/assets.js').Asset} before
 * @param {{ uid: string, role: string }} actor
 * @param {{ comment?: string }} [opts]
 */
export async function setAssetStatus(id, statusId, before, actor, opts = {}) {
  if (!actor?.uid) throw new Error('setAssetStatus: actor.uid required');
  if (!before) throw new Error('setAssetStatus: before snapshot required for audit diff');
  if (!statusId || typeof statusId !== 'string') {
    throw new Error('setAssetStatus: statusId required');
  }

  const ref = assetDoc(id);
  const auditRef = newAuditLogRef();
  const fromStatusId = before.statusId ?? null;
  const comment = typeof opts.comment === 'string' ? opts.comment.trim() : null;

  await runTransaction(db, async (tx) => {
    tx.update(ref, {
      statusId,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });

    const mergedAfter = { ...before, statusId };
    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'asset',
        entityId: id,
        action: 'status_change',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: auditSnapshot(before),
        after: auditSnapshot(mergedAfter),
        meta: { fromStatusId, toStatusId: statusId, comment },
        relatedAssetId: id,
        relatedEmployeeId:
          before.assignedTo?.kind === 'employee' ? before.assignedTo.id : null,
      })
    );
  });
}

/**
 * Adapter object matching the `AssetRepository` port shape.
 * Components should depend on this object, not the named exports above,
 * so it stays drop-in replaceable for tests.
 */
export const firestoreAssetRepository = Object.freeze({
  list: subscribeAssets,
  get: subscribeAsset,
  create: createAsset,
  update: updateAsset,
  setStatus: setAssetStatus,
});
