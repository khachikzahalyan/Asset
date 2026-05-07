/**
 * Firestore adapter implementing the CategoryRepository port.
 *
 * Boundary: this is the ONLY module in the React app that imports
 * `firebase/firestore` for the categories collection. Components and
 * hooks compose this adapter through the hooks layer.
 *
 * Atomicity: every state-changing write goes through `runTransaction()`
 * so the category doc and its `audit_logs/{logId}` companion either both
 * succeed or both roll back.
 *
 * Counter docs (`category_counters/{categoryId}`): NOT touched by this
 * repository. The counter is initialized at seed time (once per category)
 * and incremented by the asset-create flow inside the same transaction
 * that writes the asset. Keeping the touchpoints separate keeps this
 * repository focused on metadata.
 *
 * @module infra/repositories/firestoreCategoryRepository
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
import { sanitizeCategoryInput } from '@/domain/categories.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';

const COLLECTION = 'categories';

function categoriesCollection() {
  return collection(db, COLLECTION);
}

function categoryDoc(id) {
  return doc(db, COLLECTION, id);
}

/**
 * Pluck only the audit-friendly fields from a category-shaped object so
 * the audit log's `before` / `after` blobs stay JSON-clean: no FieldValue
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
    inventoryCodePrefix: obj.inventoryCodePrefix ?? null,
    requiresMultilang: obj.requiresMultilang ?? null,
    isActive: obj.isActive ?? null,
  };
}

function snapshotToCategory(snap) {
  if (!snap.exists()) return null;
  const data = snap.data();
  return { categoryId: snap.id, ...data };
}

/**
 * Subscribe to all categories ordered by `name.ru ASC`. Doc id is mirrored
 * onto the result as `categoryId` to keep parity with the rest of the
 * domain.
 *
 * @param {(categories: import('@/domain/categories.js').Category[]) => void} onData
 * @param {(error: Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeCategories(onData, onError) {
  const q = query(categoriesCollection(), orderBy('name.ru', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ categoryId: d.id, ...d.data() }));
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

/**
 * Subscribe to a single category document by id.
 *
 * @param {string} id
 * @param {(category: import('@/domain/categories.js').Category | null) => void} onData
 * @param {(error: Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeCategory(id, onData, onError) {
  return onSnapshot(
    categoryDoc(id),
    (snap) => onData(snapshotToCategory(snap)),
    (err) => {
      if (onError) onError(err);
    }
  );
}

/**
 * Atomically create a category and an audit_logs entry.
 *
 * Note: callers may pass an explicit `id` to align the doc id with the
 * stable code identifier (e.g. seed bootstrap uses `device`, `furniture`,
 * `license`). When `id` is omitted Firestore auto-allocates one.
 *
 * @param {import('@/domain/categories.js').CategoryInput} input
 * @param {{ uid: string, role: string }} actor
 * @param {{ id?: string }} [options]
 * @returns {Promise<string>} new categoryId
 */
export async function createCategory(input, actor, options = {}) {
  if (!actor?.uid) throw new Error('createCategory: actor.uid required');
  const sanitized = sanitizeCategoryInput(input);
  const categoryRef = options.id
    ? categoryDoc(options.id)
    : doc(categoriesCollection());
  const auditRef = newAuditLogRef();

  await runTransaction(db, async (tx) => {
    const after = {
      categoryId: categoryRef.id,
      name: sanitized.name,
      inventoryCodePrefix: sanitized.inventoryCodePrefix,
      requiresMultilang: sanitized.requiresMultilang,
      isActive: sanitized.isActive,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.set(categoryRef, after);

    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'category',
        entityId: categoryRef.id,
        action: 'create',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: null,
        after: auditSnapshot(sanitized),
      })
    );
  });

  return categoryRef.id;
}

/**
 * Atomically update a category and an audit_logs entry.
 *
 * NOTE: the `inventoryCodePrefix` is editable through this method; the
 * "no asset references this category" gate lives in the Settings UI
 * (Phase 1.5) and the asset-create flow, not here. The rules layer also
 * permits prefix updates by super_admin only — see firestore.rules.
 *
 * @param {string} id
 * @param {import('@/domain/categories.js').CategoryInput} input
 * @param {import('@/domain/categories.js').Category} before
 * @param {{ uid: string, role: string }} actor
 */
export async function updateCategory(id, input, before, actor) {
  if (!actor?.uid) throw new Error('updateCategory: actor.uid required');
  if (!before) {
    throw new Error('updateCategory: before snapshot required for audit diff');
  }
  const sanitized = sanitizeCategoryInput(input);
  const ref = categoryDoc(id);
  const auditRef = newAuditLogRef();

  await runTransaction(db, async (tx) => {
    const after = {
      name: sanitized.name,
      inventoryCodePrefix: sanitized.inventoryCodePrefix,
      requiresMultilang: sanitized.requiresMultilang,
      isActive: sanitized.isActive,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.update(ref, after);

    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'category',
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
 * @param {import('@/domain/categories.js').Category} before
 * @param {{ uid: string, role: string }} actor
 */
export async function setCategoryActive(id, isActive, before, actor) {
  if (!actor?.uid) throw new Error('setCategoryActive: actor.uid required');
  if (!before) {
    throw new Error('setCategoryActive: before snapshot required for audit diff');
  }
  const ref = categoryDoc(id);
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
        entity: 'category',
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
 * Adapter object matching the `CategoryRepository` port shape.
 * Components should depend on this object, not the named exports above,
 * so it stays drop-in replaceable for tests.
 */
export const firestoreCategoryRepository = Object.freeze({
  list: subscribeCategories,
  get: subscribeCategory,
  create: createCategory,
  update: updateCategory,
  setActive: setCategoryActive,
});
