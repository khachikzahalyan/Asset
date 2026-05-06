# Audit Trail

**Phase:** 1 (MVP)
**Status:** spec
**Owner agents:** firebase-engineer, security-reviewer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §3, §11, §16

## Purpose & user value

Every state-changing write in AMS produces an immutable row in `audit_logs`. The audit trail answers: *who did what, to which entity, when, with what before/after diff*. It backs:

- The **asset timeline** view (every asset's history at `/assets/:id` → "History" tab).
- The **employee history** view ("what assets did this person ever hold?").
- Forensic queries during disputes ("the asset was assigned to X on date Y; here's the audit row signed by admin Z").

The collection is **append-only**: rules forbid update and delete for everyone, including Super Admin. The only way to undo a mistake is to write a compensating action (a new audit row).

## In scope

- An `audit_logs` Firestore collection.
- The AuditLog entity: `{ logId, entity, entityId, action, actorUid, actorRole, before, after, diff, at, ip?, requestId? }`.
- A shared **audit-helper** function used by every repository write, that writes the audit row in the **same Firestore transaction** as the entity write.
- Firestore rules: `read` allowed for admins; `write` allowed only when paired with the matching entity write (helper-mediated); `update` and `delete` forbidden for everyone.
- An `/assets/:id` "History" tab and `/employees/:id` "History" tab querying `audit_logs` by `entityId`.
- A super-admin-only `/audit` page (general audit search, last 100 entries, filter by entity / actor / date range).

## Out of scope

- Audit-log retention / archival (logs grow indefinitely; revisit when storage cost becomes a concern).
- Audit-log export to ERP / SIEM — Phase 2 reports.
- Tampered-row detection (cryptographic chain). Firestore rules + lack of update/delete is the integrity guarantee in MVP.
- Real-time audit feed.

## Domain entities involved

- **AuditLog** — primary entity.
- All other entities (asset, branch, employee, status, category, department, user, settings) — every write must be paired with an audit row.

## Key user flows

### Internal — repository write produces an audit row

1. Caller invokes `assetRepo.update(assetId, patch)`.
2. Repository constructs the diff `{ before, after, changedKeys }` from current and target docs.
3. Repository runs a Firestore transaction:
   - Reads current asset doc.
   - Writes the patched asset doc.
   - Writes a new `audit_logs/{logId}` doc with `{ entity: 'asset', entityId, action: 'update', diff, actorUid, actorRole, at: serverTimestamp() }`.
4. Transaction commits atomically. Either both writes succeed or both fail.

### User-facing — viewing an asset's history

1. User opens `/assets/:id` → "History" tab.
2. Page calls `auditRepo.listForEntity('asset', assetId)` → returns rows ordered by `at desc`, limit 50, with "Load more" pagination.
3. Each row renders as a localized line: `[2026-05-01 14:32] John Doe (Asset Admin) — Updated status from "In stock" to "Issued"` with an expand-for-details button showing the JSON diff.

### User-facing — viewing an employee's history

Same pattern as asset history, querying by `entity: 'employee'` AND `entityId: employeeId`. Includes assignment-related rows where the employee is the assignee (those rows reference the assignment entity, but link back via a denormalized `relatedEmployeeId` field).

### Searching audit logs (Super Admin)

`/audit` page with filters: entity type, action, actor, date range. Returns paginated rows.

## UI surfaces

- `<HistoryTab entityType={type} entityId={id} />` — reusable, used by `/assets/:id`, `/employees/:id`, etc.
- `<AuditRow log={log} />` — renders one localized log line with expand-for-diff.
- `/audit` — `AuditPage`, super-admin-only.

shadcn/ui primitives: `Table`, `Card`, `Badge`, `Collapsible`, `DateRangePicker`.

## Firestore collections & shape

### `audit_logs/{logId}`

```jsdoc
/**
 * @typedef {Object} AuditLog
 * @property {string} logId
 * @property {'asset'|'branch'|'employee'|'department'|'category'|'asset_status'|'user'|'auth'|'assignment'|'settings'} entity
 * @property {string} entityId                 // doc id of the entity (or 'singleton' for settings)
 * @property {'create'|'update'|'delete'|'deactivate'|'reactivate'|'assign'|'unassign'|'sign_in'|'sign_out'|'transition'} action
 * @property {string} actorUid
 * @property {'super_admin'|'asset_admin'|'tech_admin'|'employee'|'system'} actorRole
 * @property {Object|null} before              // previous doc state (or null for create)
 * @property {Object|null} after               // new doc state (or null for delete)
 * @property {string[]} changedKeys           // top-level field names that changed
 * @property {Object|null} meta                // arbitrary action-specific payload (e.g., { actId, scanUrl })
 * @property {string|null} relatedEmployeeId  // denormalized for employee-history queries
 * @property {string|null} relatedAssetId
 * @property {import('firebase/firestore').Timestamp} at
 */
```

### Indexes

- Composite `(entity ASC, entityId ASC, at DESC)` — entity-history view.
- Composite `(actorUid ASC, at DESC)` — "what did this admin do" audit search.
- Composite `(relatedEmployeeId ASC, at DESC)` — employee history including assignment events.
- Composite `(relatedAssetId ASC, at DESC)` — asset history including assignment events.
- Composite `(entity ASC, action ASC, at DESC)` — `/audit` filters.
- Composite `(at DESC)` — fallback chronological feed.

### Rule sketch

```
match /audit_logs/{logId} {
  allow read: if isAdmin();
  allow create: if isAdmin()
                && request.resource.data.actorUid == request.auth.uid
                && request.resource.data.at == request.time;
  allow update, delete: if false;             // CRITICAL: append-only
}
```

The `actorUid == request.auth.uid` check prevents an admin from forging a row attributed to someone else. The `at == request.time` check prevents back-dating.

`update, delete: if false` applies to **everyone** including Super Admin. This is non-negotiable.

## Storage paths

- None (audit rows are pure Firestore docs; if a Storage upload is part of the action, the URL goes into `meta.uploadUrl`).

## Audit-helper contract

Every repository write must use this helper:

```js
// src/lib/audit/auditHelper.js
async function writeWithAudit(transaction, {
  entityRef, entityType, entityId, action, before, after, meta, relatedEmployeeId, relatedAssetId
}) {
  // 1. Compute changedKeys from before/after.
  // 2. Write the entity doc inside the transaction.
  // 3. Write the audit_logs doc inside the same transaction.
}
```

Repositories MUST use this for `setDoc`, `updateDoc`, `addDoc`, `deleteDoc`. A code-quality-reviewer rule and a runtime test enforce it.

## Permissions / role gates

| Action | super_admin | asset_admin | tech_admin | employee |
|---|---|---|---|---|
| Read audit logs (any) | ✅ | ✅ | ✅ | ❌ |
| Read entity-scoped logs | ✅ | ✅ | ✅ | ❌ |
| Create (via helper, paired with entity write) | ✅ | ✅ | ✅ | ❌ |
| Update / delete | ❌ | ❌ | ❌ | ❌ |

Employee role does NOT read audit logs in MVP.

## Open questions

- **Sign-in audit rows.** Do successful sign-ins write a row? Default: yes — `{ entity: 'auth', action: 'sign_in', actorUid }` — handy for security review. Failed sign-ins are tracked by Firebase Auth itself; no row written.
- **Read-events auditing.** AMS does not audit reads in MVP. If a customer needs read-access auditing (sensitive PII), Phase 2.
- **Diff size.** Large field changes (long text descriptions, attribute JSON) blow up audit row size. Default: cap `before/after` at 10 KB each; fall back to `changedKeys` only with a `truncated: true` flag.
- **Server vs client diff computation.** Computing `before` requires reading the doc before writing — that's an extra read per write. Acceptable cost for MVP.

## Acceptance criteria

- [ ] `audit_logs` collection exists with the typedef above.
- [ ] `audit_logs` rules: read = admin, create = admin + actor matches request.auth.uid, update/delete = false.
- [ ] Every entity write in the codebase goes through the audit-helper (verified by a static check or rules test).
- [ ] Asset detail page "History" tab renders chronological audit rows with diff expand.
- [ ] Employee detail page "History" tab renders audit rows for the employee + their assignment events.
- [ ] Super Admin can search audit logs by entity / actor / date range at `/audit`.
- [ ] Rules test verifies update and delete are denied even for super_admin.
- [ ] Rules test verifies actorUid spoofing is denied.
- [ ] `at` field is server-timestamp; back-dating denied by rules.
- [ ] Sign-in writes an audit row.

## Dependencies

- **Depends on:** roles-and-permissions, authentication.
- **Depended on by:** **every other feature with a write path** (cross-cutting).
