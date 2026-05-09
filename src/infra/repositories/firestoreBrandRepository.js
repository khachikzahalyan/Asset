/**
 * Firestore adapter implementing the BrandRepository port.
 *
 * Boundary: this is the ONLY module in the React app that imports
 * `firebase/firestore` for the brands collection. Components and
 * hooks compose this adapter through the hooks layer.
 *
 * Atomicity: every state-changing write goes through `runTransaction()`
 * so the brand doc and its `audit_logs/{logId}` companion either both
 * succeed or both roll back.
 *
 * @module infra/repositories/firestoreBrandRepository
 */

import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';
import {
  BrandIdConflictError,
  sanitizeBrandInput,
} from '@/domain/brands.js';

const COLLECTION = 'brands';

function brandsRef() {
  return collection(db, COLLECTION);
}

function brandDocRef(id) {
  return doc(db, COLLECTION, id);
}

/**
 * Derive a stable document id from a brand name.
 * Lowercase + collapse non-alphanum runs to `_` + trim leading/trailing `_`
 * + 64-char cap. Same convention as subtype id derivation.
 *
 * @param {string} name
 * @returns {string}
 */
function deriveBrandId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

/**
 * Subscribe to /brands. Hooks pass `{onData, onError}` so subscription
 * errors can surface in the UI without throwing inside React.
 *
 * @param {{ onData: (brands: import('@/domain/brands.js').Brand[]) => void, onError?: (err: Error) => void }} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeToBrands({ onData, onError }) {
  return onSnapshot(
    query(brandsRef()),
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ brandId: d.id, ...d.data() }));
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
    },
  );
}

/**
 * Atomically create a brand and write an audit_logs entry.
 * Throws `BrandIdConflictError` if the derived id already exists.
 *
 * @param {import('@/domain/brands.js').BrandInput} input
 * @param {{ uid: string, role: string }} actor
 * @returns {Promise<string>} new brandId
 */
export async function createBrand(input, actor) {
  const sanitized = sanitizeBrandInput(input);
  const brandId = deriveBrandId(sanitized.name);
  if (!brandId) throw new Error('brand id derivation failed');

  const ref = brandDocRef(brandId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) throw new BrandIdConflictError(brandId);

    const after = {
      brandId,
      name: sanitized.name,
      isActive: sanitized.isActive,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.set(ref, after);

    tx.set(
      newAuditLogRef(),
      buildAuditLog({
        entity: 'brand',
        entityId: brandId,
        action: 'created',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: null,
        after: { name: after.name, isActive: after.isActive },
      })
    );
  });
  return brandId;
}

/**
 * Atomically update a brand and write an audit_logs entry.
 *
 * @param {string} brandId
 * @param {import('@/domain/brands.js').BrandInput} patch
 * @param {{ uid: string, role: string }} actor
 */
export async function updateBrand(brandId, patch, actor) {
  const ref = brandDocRef(brandId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`brand not found: ${brandId}`);
    const before = snap.data();
    const sanitized = sanitizeBrandInput({ ...before, ...patch });
    const update = {
      name: sanitized.name,
      isActive: sanitized.isActive,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.update(ref, update);
    tx.set(
      newAuditLogRef(),
      buildAuditLog({
        entity: 'brand',
        entityId: brandId,
        action: 'updated',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: { name: before.name, isActive: before.isActive },
        after: { name: sanitized.name, isActive: sanitized.isActive },
      })
    );
  });
}

/**
 * Atomically toggle isActive on a brand and write an audit_logs entry.
 *
 * @param {string} brandId
 * @param {boolean} isActive
 * @param {{ uid: string, role: string }} actor
 */
export async function setBrandActive(brandId, isActive, actor) {
  const ref = brandDocRef(brandId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`brand not found: ${brandId}`);
    const before = snap.data();
    tx.update(ref, {
      isActive: Boolean(isActive),
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
    tx.set(
      newAuditLogRef(),
      buildAuditLog({
        entity: 'brand',
        entityId: brandId,
        action: 'set_active',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: { isActive: before.isActive },
        after: { isActive: Boolean(isActive) },
      })
    );
  });
}

/**
 * Adapter object matching the BrandRepository port shape.
 * Components should depend on this object, not the named exports above,
 * so it stays drop-in replaceable for tests.
 */
export const firestoreBrandRepository = Object.freeze({
  subscribeToBrands,
  createBrand,
  updateBrand,
  setBrandActive,
});
