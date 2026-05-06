# Asset Assignment & Acts of Acceptance

**Phase:** 1 (MVP)
**Status:** spec
**Owner agents:** firebase-engineer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §8, §9

## Purpose & user value

When AMS issues an asset to an employee or to a department, the action must be **traceable** and (for employees) **physically signed**. The "act of acceptance" is the legal artifact: a printed/signed document the employee acknowledges, scanned and uploaded as PDF or photo. Returning the asset works the same way in reverse — return-act scan optional but recommended.

This feature wraps:
- Assigning an asset to an employee or department.
- Returning an asset (clearing the assignee).
- Uploading the act-of-acceptance scan to Cloud Storage.
- Recording the assignment lifecycle in the `assignments` collection.
- Keeping the Asset's denormalized `currentAssignee*` fields in sync.

## In scope

- An `assignments` Firestore collection.
- The Assignment entity: `{ assignmentId, assetId, assigneeType, assigneeId, branchId, startedAt, startedBy, endedAt?, endedBy?, actUrl, returnActUrl?, notes? }`.
- A "Assign" action on `/assets/:id` that opens a modal with assignee picker + act-scan upload.
- A "Return" action that ends the active assignment.
- Cloud Storage path `acts/{assetId}/{assignmentId}-issue.{ext}` and `acts/{assetId}/{assignmentId}-return.{ext}`.
- File constraints: JPEG / PNG / PDF, max 10 MB.
- Atomic writes: assignment doc, asset doc denormalized fields, audit row — all in one transaction.
- Validation: asset must be in an `isAssignable` status; cannot reassign while another active assignment exists.

## Out of scope

- Digital signature workflow (employee signs in-app instead of paper). Phase 2 / Phase 3.
- Approval workflow before issuing (two-eyes). Phase 3 — `write-off-approval-workflow.md` covers a similar pattern.
- Bulk assignment (one-click assign 10 assets to one employee). Phase 2.
- Notifications to employees on assignment. Phase 2 (`notifications-system.md`).
- Generation of the act-of-acceptance PDF in-app (admins upload externally-prepared scans).

## Domain entities involved

- **Assignment** — primary entity for this feature.
- **Asset** — denormalized `currentAssigneeType`, `currentAssigneeId`, `currentAssignmentId` fields.
- **Employee / Department** — assignee target.
- **AuditLog** — every assign/return writes a row.

## Key user flows

### Assigning an asset to an employee

1. Asset Admin opens `/assets/:id` → sees "Unassigned" → clicks "Assign".
2. Modal opens with:
   - Assignee type: Employee / Department (radio)
   - Assignee picker: `<EmployeeSelect>` filtered to active + same branch (suggested), or `<DepartmentSelect>` filtered to same branch
   - Act-of-acceptance file upload (required, JPEG/PNG/PDF ≤10 MB)
   - Notes (optional)
3. UI validates:
   - Asset's current `statusId` must have `isAssignable: true` (else show "Asset is in non-assignable status: <name>").
   - Asset has no active assignment (`currentAssignmentId == null`).
   - File type and size.
4. On submit:
   - File uploads to `acts/{assetId}/{newAssignmentId}-issue.{ext}` (the `assignmentId` is generated client-side first).
   - Repository runs a transaction:
     - Creates `assignments/{assignmentId}` with `{ startedAt, startedBy, actUrl, ... }`
     - Updates `assets/{assetId}` with `currentAssigneeType`, `currentAssigneeId`, `currentAssignmentId`, `statusId: 'issued'` (transitions via lifecycle engine)
     - Writes `audit_logs` row `{ entity: 'assignment', action: 'assign', meta: { actUrl } }`
   - If the upload succeeds but the transaction fails, an orphaned act file remains in Storage; cleanup is a janitorial concern (Phase 2 cron).
5. Modal closes, page refreshes, asset shows "Assigned to <employee>" with "View act" link and "Return" button.

### Returning an asset

1. Asset Admin opens `/assets/:id` → sees "Assigned to X" → clicks "Return".
2. Modal opens with:
   - Confirmation summary
   - Return-act upload (optional)
   - Notes (optional)
3. On submit:
   - If a return-act file is selected, upload to `acts/{assetId}/{assignmentId}-return.{ext}`.
   - Transaction:
     - Updates `assignments/{assignmentId}` with `{ endedAt, endedBy, returnActUrl?, notes? }`
     - Updates `assets/{assetId}` clearing `currentAssignee*` and `currentAssignmentId`, transitions status to `in_stock` (via lifecycle engine)
     - Writes audit row `{ entity: 'assignment', action: 'unassign' }`
4. Asset shows "Unassigned" again.

### Reassigning (assigning to a new person without an explicit return)

Not allowed in MVP. The UI forces a Return step first. Rationale: every assignment must close cleanly with an `endedAt` so audit trail and history are clean.

### Viewing assignment history

`/assets/:id` → "History" tab shows all past assignments + audit rows. Each assignment row links to the issue and (if present) return act PDFs.

## UI surfaces

- "Assign" / "Return" buttons on `/assets/:id` Overview tab.
- `<AssignAssetModal asset={...} onAssigned={...} />`
- `<ReturnAssetModal assignment={...} onReturned={...} />`
- `<ActScanLink url={...} />` — small "View act" link with PDF/image icon.
- `<AssignmentHistoryRow />` — used inside History tab.

shadcn/ui primitives: `Dialog`, `Form`, `Input`, `RadioGroup`, `Select`, `Button`, `Alert`.

## Firestore collections & shape

### `assignments/{assignmentId}`

```jsdoc
/**
 * @typedef {Object} Assignment
 * @property {string} assignmentId
 * @property {string} assetId
 * @property {'employee'|'department'} assigneeType
 * @property {string} assigneeId
 * @property {string} branchId                   // denormalized for branch-scoped queries
 * @property {import('firebase/firestore').Timestamp} startedAt
 * @property {string} startedBy                  // uid
 * @property {string} actUrl                      // Storage download URL
 * @property {import('firebase/firestore').Timestamp|null} endedAt
 * @property {string|null} endedBy
 * @property {string|null} returnActUrl
 * @property {string|null} notes
 */
```

### Indexes

- Composite `(assetId ASC, startedAt DESC)` — asset's assignment history.
- Composite `(assigneeType ASC, assigneeId ASC, endedAt ASC, startedAt DESC)` — employee's currently-active assignments (where `endedAt == null`).
- Composite `(branchId ASC, endedAt ASC, startedAt DESC)` — branch dashboard.

### Rule sketch

```
match /assignments/{assignmentId} {
  allow read: if isAdmin()
              || (isEmployee()
                  && resource.data.assigneeType == 'employee'
                  && resource.data.assigneeId == get(/databases/$(database)/documents/users/$(request.auth.uid)).data.employeeId);
  allow create: if (isSuperAdmin() || isAssetAdmin())
                && request.resource.data.startedBy == request.auth.uid
                && request.resource.data.endedAt == null;
  allow update: if (isSuperAdmin() || isAssetAdmin())
                // only the close-out (set endedAt) is allowed
                && resource.data.endedAt == null
                && request.resource.data.assetId == resource.data.assetId
                && request.resource.data.assigneeId == resource.data.assigneeId;
  allow delete: if false;
}
```

## Storage paths

- `acts/{assetId}/{assignmentId}-issue.{ext}` — required, uploaded on assign.
- `acts/{assetId}/{assignmentId}-return.{ext}` — optional, uploaded on return.

### Storage rule sketch

```
match /acts/{assetId}/{fileName} {
  allow read: if request.auth != null
              && (isAdmin()
                  || (isEmployee()
                      && get(/databases/$(database)/documents/assets/$(assetId)).data.currentAssigneeId
                         == get(/databases/$(database)/documents/users/$(request.auth.uid)).data.employeeId));
  allow write: if (isSuperAdmin() || isAssetAdmin())
               && request.resource.size < 10 * 1024 * 1024
               && request.resource.contentType in ['image/jpeg', 'image/png', 'application/pdf'];
  allow delete: if false;        // act scans never delete
}
```

## Permissions / role gates

| Action | super_admin | asset_admin | tech_admin | employee |
|---|---|---|---|---|
| Read assignments (any) | ✅ | ✅ | ✅ | ❌ |
| Read own assignments | ✅ | ✅ | ✅ | ✅ |
| Create (assign) | ✅ | ✅ | ❌ | ❌ |
| Update (close-out / return) | ✅ | ✅ | ❌ | ❌ |
| Delete | ❌ | ❌ | ❌ | ❌ |
| View act scan | ✅ | ✅ | ✅ | ✅ (own only) |

## Open questions

- **Branch consistency between asset and assignee.** If the chosen employee is at branch B and the asset is at branch A, do we block, or auto-move the asset to branch B? Default proposal: auto-move (record both `assetBranchBefore` and `assetBranchAfter` in audit row meta). Confirm with customer.
- **Required return-act scan.** Should returning require a scan? Default: optional in MVP; admins can take a photo of the returned device and upload, but it's not blocking.
- **Re-uploading a corrected act.** If admin uploads wrong file, can they replace it? Default: no (acts are immutable). Workaround: add a new entry in `notes` and upload the corrected file as `acts/{assetId}/{assignmentId}-issue-v2.{ext}` — Phase 2 may build a proper attachment list.
- **Department-assigned asset visibility.** Currently only employees with their `users/{uid}.employeeId` can see their assignments. Department-assigned assets aren't shown to anyone except admins in MVP. Phase 2: show "shared assets in your department" on `/me` if employee belongs to that department.

## Acceptance criteria

- [ ] `assignments` collection with the typedef above.
- [ ] Assigning an asset writes the assignment, updates the asset's `currentAssignee*`, transitions status to `issued`, writes audit row — all in one transaction.
- [ ] Returning an asset closes the assignment, clears `currentAssignee*`, transitions status to `in_stock`, writes audit row — all in one transaction.
- [ ] Act-of-acceptance file required on assign; uploaded to `acts/{assetId}/{assignmentId}-issue.{ext}`.
- [ ] File constraints (JPEG/PNG/PDF, ≤10 MB) enforced client-side and in Storage rules.
- [ ] Cannot assign while an active assignment exists (UI-blocked + rule-blocked).
- [ ] Cannot assign to an asset whose status is non-assignable (UI-blocked).
- [ ] Employees can read their own assignments and act scans only.
- [ ] Storage rule blocks deletion of acts under any role.
- [ ] Asset history tab shows past assignments with links to act scans.

## Dependencies

- **Depends on:** asset-registry, employees, departments, asset-status-catalog, asset-lifecycle-transitions, audit-trail.
- **Depended on by:** employee-self-service, dashboards.
