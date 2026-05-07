// src/infra/repositories/firestoreUserInvitationsRepository.js
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';
import { sanitizeInviteInput, INVITE_STATUS } from '@/domain/userInvitations.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';

const COLLECTION = 'userInvitations';

function inviteCollection() {
  return collection(db, COLLECTION);
}

function inviteDoc(emailLower) {
  return doc(db, COLLECTION, emailLower);
}

function _snapshotToInvite(snap) {
  if (!snap.exists()) return null;
  return { ...snap.data() };
}

function auditSnapshot(invite) {
  if (!invite) return null;
  return {
    email: invite.email ?? null,
    role: invite.role ?? null,
    branchId: invite.branchId ?? null,
    departmentId: invite.departmentId ?? null,
    status: invite.status ?? null,
  };
}

export function listPendingInvitations(onData, onError) {
  const q = query(
    inviteCollection(),
    where('status', '==', INVITE_STATUS.PENDING),
    orderBy('invitedAt', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ ...d.data() }))),
    (err) => {
      if (onError) onError(err);
    }
  );
}

export async function createInvitation(input, actor) {
  if (!actor?.uid) throw new Error('createInvitation: actor.uid required');
  const sanitized = sanitizeInviteInput(input);
  if (!sanitized.email) throw new Error('createInvitation: email required');

  const ref = inviteDoc(sanitized.email);
  const auditRef = newAuditLogRef();

  await runTransaction(db, async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists()) {
      throw new Error(`createInvitation: invitation already exists for ${sanitized.email}`);
    }
    const after = {
      email: sanitized.email,
      role: sanitized.role,
      branchId: null,
      departmentId: null,
      invitedBy: actor.uid,
      invitedAt: serverTimestamp(),
      status: INVITE_STATUS.PENDING,
      acceptedAt: null,
      acceptedUid: null,
      revokedAt: null,
      revokedBy: null,
    };
    tx.set(ref, after);
    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'invitation',
        entityId: sanitized.email,
        action: 'create',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: null,
        after: auditSnapshot(after),
      })
    );
  });

  return sanitized.email;
}

export async function revokeInvitation(emailLower, before, actor) {
  if (!actor?.uid) throw new Error('revokeInvitation: actor.uid required');
  if (!before) throw new Error('revokeInvitation: before snapshot required');
  const ref = inviteDoc(emailLower);
  const auditRef = newAuditLogRef();

  await runTransaction(db, async (tx) => {
    const after = {
      status: INVITE_STATUS.REVOKED,
      revokedBy: actor.uid,
      revokedAt: serverTimestamp(),
    };
    tx.update(ref, after);
    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'invitation',
        entityId: emailLower,
        action: 'revoke',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: auditSnapshot(before),
        after: auditSnapshot({ ...before, status: INVITE_STATUS.REVOKED }),
      })
    );
  });
}

export const firestoreUserInvitationsRepository = Object.freeze({
  listPending: listPendingInvitations,
  create: createInvitation,
  revoke: revokeInvitation,
});
