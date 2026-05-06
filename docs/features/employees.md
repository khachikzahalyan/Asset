# Employees

**Phase:** 1 (MVP)
**Status:** spec
**Owner agents:** domain-modeler, firebase-engineer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §4, §6

## Purpose & user value

An **Employee** is a person who can be assigned assets. The collection is the canonical roster: who works at which branch, in which department, contactable via which email. The same email is later used by the **email-link sign-in** flow to let the employee see their own assigned assets via `/me`. Without a pre-registered employee record, no one outside the admin set can sign into AMS.

Asset Admin and Super Admin manage employees. Tech Admin reads. Employees themselves see only their own self-service page (covered by `employee-self-service.md`).

## In scope

- An `employees` Firestore collection.
- The Employee entity: `firstName`, `lastName`, `middleName?`, `email`, `phone?`, `branchId`, `departmentId?`, `position?`, `isActive`, `hiredAt?`, `terminatedAt?`, `createdAt`, `updatedAt`.
- Email uniqueness across active employees (enforced via deterministic doc id OR a uniqueness index).
- A `/employees` list page with search, branch filter, department filter, status filter.
- A `/employees/:id` detail page showing currently-assigned assets.
- A standard create/edit form.
- Soft-termination: setting `isActive: false` + `terminatedAt`. Termination flow with bulk asset redistribution is Phase 3.
- Audit row on every write.

## Out of scope

- Termination flow with asset redistribution (Phase 3 — `employee-termination-flow.md`).
- Profile photo upload (Phase 2 — would land at `Storage: employees/{employeeId}/avatar.{ext}`).
- Custom HR fields (salary, ID number, hire contract scan).
- Auth account linking — `users/{uid}` is created on first email-link sign-in by matching the email; this feature only manages the `employees` doc.
- Bulk import — Phase 2 (Excel two-pass import).

## Domain entities involved

- **Employee** — primary entity.
- **Branch** — each employee belongs to one branch.
- **Department** — optional, must belong to the same branch.
- **User** — `users/{uid}.employeeId` links an authenticated employee back to their employee record.
- **Asset / Assignment** — track which assets are currently with the employee.

## Key user flows

### Creating an employee (Asset Admin or Super Admin)

1. Admin opens `/employees` → "Add employee".
2. Form fields:
   - First name, last name (Tier 3, plain `<Input>`)
   - Middle name (optional, Tier 3)
   - Email (validated, Tier 4 — ASCII only)
   - Phone (optional)
   - Branch (`<BranchSelect>`, required)
   - Department (`<DepartmentSelect>` filtered to chosen branch, optional)
   - Position (Tier 3, free text)
   - Hired date (optional)
3. On submit:
   - Validate email isn't already used by another active employee.
   - Repository creates the doc (with deterministic id `email-hash` or random id + uniqueness check). Audit row written.
4. Redirect to `/employees/:id`.

### Editing an employee

Standard edit form. Email change is allowed but still must be unique. Audit row captures the diff. Changing `branchId` or `departmentId` is allowed but logged.

### Terminating (deactivating) an employee — MVP

1. Admin opens `/employees/:id` → "Terminate".
2. UI checks: any active assignments? If yes, show "Cannot terminate: 3 assets still assigned. Use termination flow (Phase 3) or unassign first." Block in MVP.
3. If no active assignments, set `isActive: false`, `terminatedAt: now`. Audit.
4. Employee disappears from `<EmployeeSelect>` for new assignments; remains visible in lists with "Terminated" badge.

### Searching / filtering

`/employees` shows table: full name, email, branch (localized), department (localized), position, active/terminated, count of active assignments. Search by name or email; filter by branch / department / status.

### Re-activation

If an employee comes back, Super Admin can flip `isActive: true` + clear `terminatedAt`. Audit row.

## UI surfaces

- `/employees` — `EmployeeListPage`.
- `/employees/:id` — `EmployeeDetailPage` with summary card + "Currently assigned" assets table + "History" link to audit-trail timeline.
- `<EmployeeSelect>` reused by asset-assignment form (filtered by branch + active).

shadcn/ui primitives: `Table`, `Dialog`, `Form`, `Input`, `Select`, `Badge`, `Tabs`, `Card`.

## Firestore collections & shape

### `employees/{employeeId}`

```jsdoc
/**
 * @typedef {Object} Employee
 * @property {string} employeeId
 * @property {string} firstName               // Tier 3, free text
 * @property {string} lastName                // Tier 3, free text
 * @property {string|null} middleName         // Tier 3
 * @property {string} email                   // Tier 4, ASCII
 * @property {string|null} phone
 * @property {string} branchId
 * @property {string|null} departmentId
 * @property {string|null} position           // Tier 3
 * @property {boolean} isActive
 * @property {import('firebase/firestore').Timestamp|null} hiredAt
 * @property {import('firebase/firestore').Timestamp|null} terminatedAt
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */
```

### Indexes

- Single-field on `email` (auto, used by employee-self-service email-link match).
- Composite `(branchId ASC, isActive ASC, lastName ASC)` for the per-branch employee dropdown.
- Composite `(departmentId ASC, isActive ASC)` if the dept page lists members.

### Email uniqueness

Two viable approaches; pick one in domain model:

1. **Deterministic doc id** = lowercased email hash. Create then becomes idempotent and uniqueness is structurally guaranteed.
2. **Random id + uniqueness check** in a transaction (read-then-write against an `email_index/{emailHash}` doc).

Default proposal: option 1 (simpler, no index doc).

### Rule sketch

```
match /employees/{employeeId} {
  allow read: if isAdmin() || (isEmployee() && employeeId == get(/databases/$(database)/documents/users/$(request.auth.uid)).data.employeeId);
  allow create, update: if isSuperAdmin() || isAssetAdmin();
  allow delete: if false;
}
```

The employee self-read condition lets `/me` fetch the employee's own row.

## Storage paths

- None in MVP. Phase 2: `employees/{employeeId}/avatar.{ext}`.

## Permissions / role gates

| Action | super_admin | asset_admin | tech_admin | employee |
|---|---|---|---|---|
| Read employees list | ✅ | ✅ | ✅ | ❌ |
| Read self employee row | ✅ | ✅ | ✅ | ✅ |
| Create / update / terminate | ✅ | ✅ | ❌ | ❌ |
| Reactivate (clear `terminatedAt`) | ✅ | ❌ | ❌ | ❌ |

## Open questions

- **Email uniqueness path.** Deterministic doc id (cleaner, but exposes a hash in URLs) vs random id + uniqueness index. Default: deterministic. Revisit if customer dislikes hash-based URLs.
- **Re-hire of a terminated employee.** Same email, same row, flip `isActive`? Or new row? Default: same row, flip flag (preserves audit trail).
- **Can a terminated employee's email be reassigned to a new person?** Default: no — email is uniquely owned. If forced (rare), Super Admin manually changes the terminated employee's email to a sentinel (`old.email+terminated@...`) before assigning the original to a new hire.

## Acceptance criteria

- [ ] `employees` collection with the typedef above.
- [ ] Asset Admin and Super Admin can create, edit, terminate, and re-activate (Super Admin only) employees.
- [ ] Tech Admin can read but not write.
- [ ] Employee can read only their own row.
- [ ] Email is unique across active employees.
- [ ] Terminating an employee with active assignments is blocked in MVP with a clear error.
- [ ] Inactive employees do not appear in `<EmployeeSelect>` for new assignments but appear in lists with a "Terminated" badge.
- [ ] Department dropdown filters to the chosen branch.
- [ ] Every write produces an audit-log row.
- [ ] Email is validated as ASCII-only (Tier 4).

## Dependencies

- **Depends on:** branches, departments, roles-and-permissions, internationalization, audit-trail.
- **Depended on by:** asset-registry, asset-assignment-and-acts, employee-self-service, dashboards, employee-termination-flow (Phase 3).
