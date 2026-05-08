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
 * Counter docs (`category_counters/{categoryId}`): for UI-driven category
 * creation the counter is initialized inside the SAME transaction that
 * writes the category doc, so the asset-create flow always finds an
 * incrementable counter. This was added in Wave A.5 — see the brief in
 * docs/superpowers/plans/. Update / setActive flows do NOT touch the
 * counter (re-initializing on edit would erase the running asset numbers).
 *
 * @module infra/repositories/firestoreCategoryRepository
 */

import {
  collection,
  doc,
  getCountFromServer,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';
import {
  sanitizeCategoryInput,
  CategoryIdConflictError,
  CategoryReferencedError,
} from '@/domain/categories.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';

const COLLECTION = 'categories';

function categoriesCollection() {
  return collection(db, COLLECTION);
}

function categoryDoc(id) {
  return doc(db, COLLECTION, id);
}

function categoryCounterDoc(id) {
  return doc(db, 'category_counters', id);
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
 * Atomically create a category, initialize its `category_counters/{id}`
 * doc to `{ next: 1 }`, and write two audit_logs entries (`create` for the
 * category, `counter_initialized` for the counter). All four writes share
 * a single `runTransaction()` so a partial create can never leave the
 * asset-create flow without an incrementable counter.
 *
 * Callers may pass an explicit `id` to align the doc id with a stable
 * code identifier. The seed bootstrap uses `device`, `furniture`,
 * `license`; the Settings UI passes a slug derived from the RU name and
 * appends a numeric suffix on collision before calling this function.
 * When `id` is omitted Firestore auto-allocates one.
 *
 * Throws `CategoryIdConflictError` if the requested doc id already exists.
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
  const counterRef = categoryCounterDoc(categoryRef.id);
  const auditRef = newAuditLogRef();
  const counterAuditRef = newAuditLogRef();

  await runTransaction(db, async (tx) => {
    // Stable-id collision check: if the caller asked for a specific id
    // and a doc already lives there, fail loudly. The Settings UI catches
    // this and either auto-suffixes the slug client-side or surfaces the
    // i18n error so the operator knows.
    if (options.id) {
      const existing = await tx.get(categoryRef);
      if (existing.exists?.()) {
        throw new CategoryIdConflictError(categoryRef.id);
      }
    }

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

    // Initialize the matching `category_counters/{id}` doc so the
    // asset-create flow has something to increment, and write a
    // `counter_initialized` audit row mirroring the bootstrap behavior in
    // StatusesAndCategoriesBootstrap.ensureCategoryCounter.
    tx.set(counterRef, {
      next: 1,
      updatedAt: serverTimestamp(),
    });

    tx.set(
      counterAuditRef,
      buildAuditLog({
        entity: 'category',
        entityId: categoryRef.id,
        action: 'counter_initialized',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: null,
        after: { next: 1 },
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
 * Hard-delete a category along with its `category_counters/{id}` doc and
 * cascade-delete every sub-type that belongs to the category.
 *
 * Pre-flight: count assets where `categoryId == id`. If > 0 throw
 * CategoryReferencedError — assets carry real inventory data and silently
 * orphaning their categoryId would corrupt history. Sub-types are NOT a
 * blocker: they are catalog rows that get deleted alongside their parent
 * category in the same transaction (operator request 2026-05-08).
 *
 * The pre-flight + the subtype list query both run OUTSIDE the
 * transaction because Firestore client-side transactions can't run
 * aggregate counts or arbitrary queries. We accept the small race
 * window: a concurrent subtype create racing the delete would leave an
 * orphan subtype after the txn, recoverable from audit history. See
 * CategoryReferencedError docstring.
 *
 * Inside `runTransaction`: for each subtype found in the pre-flight
 * query, `tx.delete(subtypeRef)` and `tx.set(auditRef, ...)` with
 * `meta: { cascadeFromCategory: id }` so the audit trail records the
 * cascade clearly. Then `tx.delete(category)`, `tx.delete(counter)`,
 * and a final `tx.set(...)` for the category's own deletion audit row.
 *
 * Transaction write budget: Firestore allows up to 500 writes per
 * transaction. Each subtype consumes 2 writes (delete + audit), the
 * category itself consumes 3 (delete + counter delete + audit). So the
 * hard cap is ~248 subtypes per category. Phase 1 categories have a few
 * dozen subtypes at most; we don't paginate.
 *
 * Server-side enforcement: `firestore.rules` permits delete on
 * `/categories/{id}`, `/category_counters/{id}`, and
 * `/asset_subtypes/{id}` for super_admin only.
 *
 * @param {string} id
 * @param {import('@/domain/categories.js').Category} before
 * @param {{ uid: string, role: string }} actor
 * @throws {CategoryReferencedError} when at least one asset references the
 *   category. Sub-types do NOT raise this error — they cascade.
 */
export async function deleteCategory(id, before, actor) {
  if (!actor?.uid) throw new Error('deleteCategory: actor.uid required');
  if (!before) {
    throw new Error('deleteCategory: before snapshot required for audit diff');
  }

  const assetsQ = query(
    collection(db, 'assets'),
    where('categoryId', '==', id)
  );
  const subtypesQ = query(
    collection(db, 'asset_subtypes'),
    where('categoryId', '==', id)
  );

  // Pre-flight referential-integrity check (assets) + cascade query
  // (subtypes) in parallel.
  const [assetsSnap, subtypesSnap] = await Promise.all([
    getCountFromServer(assetsQ),
    getDocs(subtypesQ),
  ]);
  const assetCount = assetsSnap.data().count;
  if (assetCount > 0) {
    throw new CategoryReferencedError(id, { assetCount });
  }

  // Snapshot every subtype for the audit log's `before` payload. We
  // deliberately keep this minimal — name + flags only — to mirror the
  // shape used by firestoreAssetSubtypeRepository's own audit writes.
  const cascadedSubtypes = subtypesSnap.docs.map((d) => ({
    ref: d.ref,
    id: d.id,
    data: d.data(),
  }));

  const ref = categoryDoc(id);
  const counterRef = categoryCounterDoc(id);
  const auditRef = newAuditLogRef();

  await runTransaction(db, async (tx) => {
    // Cascade-delete every subtype + audit each removal. Audit refs are
    // allocated inside the loop so each subtype gets its own row.
    for (const sub of cascadedSubtypes) {
      const subAuditRef = newAuditLogRef();
      tx.delete(sub.ref);
      tx.set(
        subAuditRef,
        buildAuditLog({
          entity: 'asset_subtype',
          entityId: sub.id,
          action: 'deleted',
          actorUid: actor.uid,
          actorRole: actor.role,
          before: subtypeAuditSnapshot(sub.data),
          after: null,
          meta: { cascadeFromCategory: id },
        })
      );
    }

    tx.delete(ref);
    tx.delete(counterRef);

    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'category',
        entityId: id,
        action: 'deleted',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: auditSnapshot(before),
        after: null,
        meta:
          cascadedSubtypes.length > 0
            ? { cascadedSubtypeCount: cascadedSubtypes.length }
            : null,
      })
    );
  });
}

/**
 * Pluck the audit-friendly fields off a sub-type doc snapshot for the
 * cascade delete's `before` blob. Mirrors the shape used by
 * `firestoreAssetSubtypeRepository.auditSnapshot` — keeping the two
 * synchronized matters because audit consumers may aggregate by
 * `entity: 'asset_subtype'` and a divergent shape would break diffs.
 */
function subtypeAuditSnapshot(data) {
  if (!data) return null;
  return {
    categoryId: data.categoryId ?? null,
    name: data.name ?? null,
    requiresMultilang: data.requiresMultilang ?? null,
    attachableTo: data.attachableTo ?? null,
    sortOrder: data.sortOrder ?? null,
    isActive: data.isActive ?? null,
  };
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
  delete: deleteCategory,
});
