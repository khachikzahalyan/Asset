/**
 * Firestore adapter implementing the ModelRepository port.
 *
 * Boundary: this is the ONLY module in the React app that imports
 * `firebase/firestore` for the models collection. Components and
 * hooks compose this adapter through the hooks layer.
 *
 * Atomicity: every state-changing write goes through `runTransaction()`
 * so the model doc and its `audit_logs/{logId}` companion either both
 * succeed or both roll back.
 *
 * brandId is immutable post-create: updateModel does NOT include
 * brandId in the update payload.
 *
 * @module infra/repositories/firestoreModelRepository
 */

import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';
import { ModelIdConflictError, sanitizeModelInput } from '@/domain/models.js';

const COLLECTION = 'models';

function modelsRef() {
  return collection(db, COLLECTION);
}

function modelDocRef(id) {
  return doc(db, COLLECTION, id);
}

/**
 * Derive a stable document id from brandId + model name.
 * Format: `${brandId}_${slug}` where slug is the name lowercased,
 * non-alphanum runs collapsed to `_`, leading/trailing `_` trimmed,
 * and capped at 64 characters.
 *
 * @param {string} brandId
 * @param {string} name
 * @returns {string}
 */
function deriveModelId(brandId, name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return `${brandId}_${slug}`;
}

/**
 * Subscribe to /models, optionally filtered by brand.
 * When brandId is null/undefined, an unfiltered query is built.
 * When brandId is truthy, a where('brandId', '==', brandId) clause is added.
 *
 * @param {{
 *   brandId?: string|null,
 *   onData: (models: import('@/domain/models.js').Model[]) => void,
 *   onError?: (err: Error) => void,
 * }} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeToModels({ brandId = null, onData, onError } = {}) {
  const constraints = [];
  if (brandId) constraints.push(where('brandId', '==', brandId));
  const q = query(modelsRef(), ...constraints);
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ modelId: d.id, ...d.data() }));
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
    },
  );
}

/**
 * Atomically create a model and write an audit_logs entry.
 * Throws `ModelIdConflictError` if the derived id already exists.
 *
 * @param {import('@/domain/models.js').ModelInput} input
 * @param {{ uid: string, role: string }} actor
 * @returns {Promise<string>} new modelId
 */
export async function createModel(input, actor) {
  const sanitized = sanitizeModelInput(input);
  if (!sanitized.brandId) throw new Error('model.brandId required');
  if (!sanitized.name) throw new Error('model.name required');
  const modelId = deriveModelId(sanitized.brandId, sanitized.name);

  const ref = modelDocRef(modelId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) throw new ModelIdConflictError(modelId);

    const after = {
      modelId,
      brandId: sanitized.brandId,
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
        entity: 'model',
        entityId: modelId,
        action: 'created',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: null,
        after: {
          brandId: after.brandId,
          name: after.name,
          isActive: after.isActive,
        },
      })
    );
  });
  return modelId;
}

/**
 * Atomically update a model and write an audit_logs entry.
 * brandId is immutable — it is never included in the update payload.
 *
 * @param {string} modelId
 * @param {Partial<import('@/domain/models.js').ModelInput>} patch
 * @param {{ uid: string, role: string }} actor
 */
export async function updateModel(modelId, patch, actor) {
  const ref = modelDocRef(modelId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`model not found: ${modelId}`);
    const before = snap.data();
    const sanitized = sanitizeModelInput({ ...before, ...patch });
    const update = {
      // brandId is immutable post-create — never included here
      name: sanitized.name,
      isActive: sanitized.isActive,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.update(ref, update);
    tx.set(
      newAuditLogRef(),
      buildAuditLog({
        entity: 'model',
        entityId: modelId,
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
 * Atomically toggle isActive on a model and write an audit_logs entry.
 *
 * @param {string} modelId
 * @param {boolean} isActive
 * @param {{ uid: string, role: string }} actor
 */
export async function setModelActive(modelId, isActive, actor) {
  const ref = modelDocRef(modelId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`model not found: ${modelId}`);
    const before = snap.data();
    tx.update(ref, {
      isActive: Boolean(isActive),
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
    tx.set(
      newAuditLogRef(),
      buildAuditLog({
        entity: 'model',
        entityId: modelId,
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
 * Adapter object matching the ModelRepository port shape.
 * Components should depend on this object, not the named exports above,
 * so it stays drop-in replaceable for tests.
 */
export const firestoreModelRepository = Object.freeze({
  subscribeToModels,
  createModel,
  updateModel,
  setModelActive,
});
