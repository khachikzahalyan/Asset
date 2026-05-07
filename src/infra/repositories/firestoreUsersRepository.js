// src/infra/repositories/firestoreUsersRepository.js
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
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';

const COLLECTION = 'users';

function usersCollection() {
  return collection(db, COLLECTION);
}

function userDoc(uid) {
  return doc(db, COLLECTION, uid);
}

function auditSnapshot(u) {
  if (!u) return null;
  return {
    email: u.email ?? null,
    role: u.role ?? null,
    branchId: u.branchId ?? null,
    departmentId: u.departmentId ?? null,
    isActive: u.isActive ?? null,
  };
}

export function subscribeUsers(onData, onError) {
  const q = query(usersCollection(), orderBy('email', 'asc'));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))),
    (err) => {
      if (onError) onError(err);
    }
  );
}

export async function updateUserRole(uid, newRole, before, actor) {
  if (!actor?.uid) throw new Error('updateUserRole: actor.uid required');
  if (!before) throw new Error('updateUserRole: before snapshot required');
  const ref = userDoc(uid);
  const auditRef = newAuditLogRef();

  await runTransaction(db, async (tx) => {
    tx.update(ref, { role: newRole, updatedAt: serverTimestamp() });
    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'user',
        entityId: uid,
        action: 'roleChanged',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: auditSnapshot(before),
        after: auditSnapshot({ ...before, role: newRole }),
      })
    );
  });
}

export async function setUserActive(uid, isActive, before, actor) {
  if (!actor?.uid) throw new Error('setUserActive: actor.uid required');
  if (!before) throw new Error('setUserActive: before snapshot required');
  const ref = userDoc(uid);
  const auditRef = newAuditLogRef();
  const action = isActive ? 'reactivated' : 'deactivated';

  await runTransaction(db, async (tx) => {
    tx.update(ref, { isActive, updatedAt: serverTimestamp() });
    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'user',
        entityId: uid,
        action,
        actorUid: actor.uid,
        actorRole: actor.role,
        before: auditSnapshot(before),
        after: auditSnapshot({ ...before, isActive }),
      })
    );
  });
}

export const firestoreUsersRepository = Object.freeze({
  list: subscribeUsers,
  updateRole: updateUserRole,
  setActive: setUserActive,
});
