/**
 * Audit-log domain module.
 *
 * Pure JavaScript: no Firestore, no React, no I/O. Defines the entity
 * typedefs and an enumerated whitelist of `entityType` / `action` values
 * understood by the system. The actual write helper lives in
 * `src/lib/audit/auditHelper.js`; this file documents the shape and a
 * couple of formatting helpers consumed by the UI <HistoryTab> component.
 *
 * Wave 1.5 introduced the timeline UI (decision 2A). The shape here mirrors
 * what `auditHelper.buildAuditLog()` emits, plus the `at: Timestamp` and
 * `id: string` fields that come from Firestore.
 */

/**
 * @typedef {(
 *   'asset' |
 *   'branch' |
 *   'employee' |
 *   'department' |
 *   'category' |
 *   'asset_status' |
 *   'user' |
 *   'auth' |
 *   'assignment' |
 *   'settings' |
 *   'invitation'
 * )} AuditEntityType
 */

/**
 * @typedef {(
 *   'create' |
 *   'update' |
 *   'deactivate' |
 *   'activate' |
 *   'reactivate' |
 *   'assign' |
 *   'unassign' |
 *   'transfer' |
 *   'status_change'
 * )} AuditAction
 */

/**
 * @typedef {Object} AuditLog
 * @property {string} auditId               // mirrors doc id
 * @property {AuditEntityType} entity
 * @property {string} entityId
 * @property {AuditAction|string} action    // string for forward-compat
 * @property {string} actorUid
 * @property {string} actorRole
 * @property {Record<string, unknown>|null} before
 * @property {Record<string, unknown>|null} after
 * @property {string[]} [changedKeys]
 * @property {Record<string, unknown>|null} [meta]
 * @property {string|null} [relatedEmployeeId]
 * @property {string|null} [relatedAssetId]
 * @property {import('firebase/firestore').Timestamp} at
 */

/**
 * Map an `AuditAction` to the i18n key the UI uses for its label.
 * Falls back to the raw action string for unknown actions so Phase-2/3
 * additions surface visibly even before locale strings catch up.
 *
 * @param {string} action
 * @returns {string}
 */
export function actionLabelKey(action) {
  switch (action) {
    case 'create':
      return 'audit.actionCreate';
    case 'update':
      return 'audit.actionUpdate';
    case 'deactivate':
      return 'audit.actionDeactivate';
    case 'activate':
      return 'audit.actionActivate';
    case 'reactivate':
      return 'audit.actionReactivate';
    case 'assign':
      return 'audit.actionAssign';
    case 'unassign':
      return 'audit.actionUnassign';
    case 'transfer':
      return 'audit.actionTransfer';
    case 'status_change':
      return 'audit.actionStatusChange';
    default:
      return action;
  }
}

/**
 * Compute the changed-field labels for a single audit row by intersecting
 * `before` and `after`. Used by <HistoryTab> to render a compact summary
 * such as "department, isActive".
 *
 * Returns an empty array if either side is null (create/delete) or if there
 * is no diff. Defensive against missing `changedKeys` on legacy rows.
 *
 * @param {AuditLog} entry
 * @returns {string[]}
 */
export function changedFieldLabels(entry) {
  if (!entry) return [];
  if (Array.isArray(entry.changedKeys) && entry.changedKeys.length > 0) {
    return entry.changedKeys;
  }
  if (!entry.before || !entry.after) return [];
  const keys = new Set([
    ...Object.keys(entry.before ?? {}),
    ...Object.keys(entry.after ?? {}),
  ]);
  const out = [];
  for (const k of keys) {
    if (JSON.stringify(entry.before?.[k]) !== JSON.stringify(entry.after?.[k])) {
      out.push(k);
    }
  }
  return out;
}
