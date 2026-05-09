import { doc, collection, serverTimestamp } from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';
import { sanitizeLicenseKeyDiff } from '@/lib/audit/sanitizeLicenseKeyDiff.js';

const ALLOWED_ENTITIES = [
  'asset',
  'asset_subtype',
  'brand',
  'model',
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

  // Defense-in-depth: every audit row goes through the license-key
  // sanitiser, regardless of who built the snapshot. This is the second
  // of three protective layers around license keys (rules + sanitiser
  // + repository discipline).
  const safeBefore = sanitizeLicenseKeyDiff(before);
  const safeAfter = sanitizeLicenseKeyDiff(after);

  return {
    entity,
    entityId,
    action,
    actorUid,
    actorRole: actorRole ?? 'system',
    before: safeBefore,
    after: safeAfter,
    changedKeys: diffKeys(safeBefore, safeAfter),
    meta,
    relatedEmployeeId,
    relatedAssetId,
    at: serverTimestamp(),
  };
}

export function newAuditLogRef() {
  return doc(collection(db, 'audit_logs'));
}
