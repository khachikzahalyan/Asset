import { doc, collection, serverTimestamp } from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';

const ALLOWED_ENTITIES = [
  'asset',
  'asset_subtype',
  'branch',
  'employee',
  'department',
  'category',
  'asset_status',
  'user',
  'auth',
  'assignment',
  'settings',
  'invitation',
];

function diffKeys(before, after) {
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  const changed = [];
  for (const k of keys) {
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) {
      changed.push(k);
    }
  }
  return changed;
}

export function buildAuditLog({
  entity,
  entityId,
  action,
  actorUid,
  actorRole,
  before = null,
  after = null,
  meta = null,
  relatedEmployeeId = null,
  relatedAssetId = null,
}) {
  if (!ALLOWED_ENTITIES.includes(entity)) {
    throw new Error(`auditHelper: unknown entity '${entity}'`);
  }
  if (!actorUid) {
    throw new Error('auditHelper: actorUid required');
  }
  return {
    entity,
    entityId,
    action,
    actorUid,
    actorRole: actorRole ?? 'system',
    before,
    after,
    changedKeys: diffKeys(before, after),
    meta,
    relatedEmployeeId,
    relatedAssetId,
    at: serverTimestamp(),
  };
}

export function newAuditLogRef() {
  return doc(collection(db, 'audit_logs'));
}
