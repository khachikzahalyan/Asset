/**
 * Firestore adapter implementing the AuditRepository port.
 *
 * Boundary: this is the ONLY module in the React app that imports
 * `firebase/firestore` for the `audit_logs` collection. Components
 * compose this adapter through the `useAuditLogs` hook.
 *
 * Reads only: writes to `audit_logs` happen exclusively from the
 * entity-specific repositories (employee/branch/asset/...) inside their
 * own `runTransaction` so the entity write and the audit row stay atomic.
 *
 * @module infra/repositories/firestoreAuditRepository
 */

import {
  collection,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';

const COLLECTION = 'audit_logs';

/**
 * One-shot fetch of the latest audit entries for a single entity, ordered
 * by `at` descending. Uses the composite index
 * `entity ASC + entityId ASC + at DESC` defined in firestore.indexes.json.
 *
 * Why one-shot instead of `onSnapshot`: an entity's history is only
 * appended-to. The detail page already re-renders when the entity itself
 * mutates (its repository writes a new audit row inside the same tx);
 * polling-via-snapshot here would just multiply Firestore reads without
 * surfacing any new info the parent state machine doesn't already know
 * about. Wave-2 may revisit if cross-entity dashboards land.
 *
 * @param {string} entity   `entityType` from the audit log.
 * @param {string} entityId The doc id of the entity being inspected.
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<import('@/domain/audit.js').AuditLog[]>}
 */
export async function listForEntity(entity, entityId, opts = {}) {
  if (!entity || !entityId) return [];
  const max = Number.isFinite(opts.limit) ? opts.limit : 50;

  const q = query(
    collection(db, COLLECTION),
    where('entity', '==', entity),
    where('entityId', '==', entityId),
    orderBy('at', 'desc'),
    fbLimit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ auditId: d.id, ...d.data() }));
}

/**
 * Adapter object matching the `AuditRepository` port shape.
 * Components should depend on this object, not the named exports above,
 * so it stays drop-in replaceable for tests.
 */
export const firestoreAuditRepository = Object.freeze({
  listForEntity,
});
