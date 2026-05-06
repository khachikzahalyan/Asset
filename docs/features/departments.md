# Departments

**Phase:** 1 (MVP)
**Status:** spec
**Owner agents:** domain-modeler, firebase-engineer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §4

## Purpose & user value

A **Department** groups employees and serves as the assignee for **shared assets** — assets that aren't issued to a specific person but to a team (e.g., a shared printer used by Accounting, a meeting-room TV used by HR). Without a department concept, shared assets would have to be assigned to a stand-in employee, polluting personal assignment lists and producing misleading audit rows.

The Super Admin manages departments. Asset Admin reads them when creating shared-asset assignments.

## In scope

- A `departments` Firestore collection.
- The Department entity: code identifier (English), `name` (multi-language Tier-2), `branchId` (each department belongs to one branch), optional `responsibleEmployeeId` (department head), `isActive`, `createdAt`, `updatedAt`.
- A `/departments` page (list) and modal/inline edit.
- Soft-close (same as branches): cannot deactivate while shared assets are still assigned.
- Audit row on every write.

## Out of scope

- Department hierarchies (sub-departments). Flat list.
- Cross-branch departments (a department spans exactly one branch in MVP).
- Per-department dashboards / reports — covered by Phase 2 reports.
- Department-specific custom fields.

## Domain entities involved

- **Department** — primary entity.
- **Employee** — references a department via `departmentId` (optional).
- **Assignment** — when assignee is a department (`assigneeType: 'department'`), `assigneeId` references this collection.

## Key user flows

### Creating a department

1. Super Admin opens `/departments` → "Add department".
2. Form fields:
   - `name` — `<MultiLangInput>` (Tier 2)
   - `branchId` — `<BranchSelect>` (required)
   - `responsibleEmployeeId` — optional `<EmployeeSelect>` filtered to the chosen branch
3. Submit → doc created with `isActive: true`. Audit row written.

### Editing / deactivating

Same pattern as branches: rename or change responsible employee freely; deactivate requires no active shared-asset assignments referencing this department.

### Listing departments

`/departments` shows table: name (localized), branch (localized), responsible employee, active/inactive, count of shared assets currently assigned. Filter by branch.

## UI surfaces

- `/departments` — `DepartmentListPage`.
- `<DepartmentSelect>` reused by employee form (optional field) and shared-asset assignment form.
- Edit modal — reuses standard `EntityForm` pattern.

shadcn/ui primitives: `Table`, `Dialog`, `Form`, `Input`, `Select`, `Badge`.

## Firestore collections & shape

### `departments/{departmentId}`

```jsdoc
/**
 * @typedef {Object} Department
 * @property {string} departmentId
 * @property {{ ru: string, en: string, hy: string }} name
 * @property {string} branchId
 * @property {string|null} responsibleEmployeeId
 * @property {boolean} isActive
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */
```

### Indexes

- Composite `(branchId ASC, isActive ASC, name.ru ASC)` for the per-branch dropdown listing.

### Rule sketch

```
match /departments/{departmentId} {
  allow read: if isAdmin();
  allow create, update: if isSuperAdmin()
                        && request.resource.data.name.keys().hasOnly(['ru','en','hy']);
  allow delete: if false;
}
```

## Storage paths

- None.

## Permissions / role gates

| Action | super_admin | asset_admin | tech_admin | employee |
|---|---|---|---|---|
| Read departments | ✅ | ✅ | ✅ | ❌ |
| Create / update / deactivate | ✅ | ❌ | ❌ | ❌ |

## Open questions

- **Should Asset Admin be able to create departments?** Spec implies Super-Admin-only catalog management. Default: Super-Admin-only. Revisit if customer wants Asset Admin to manage their own department catalog.
- **Department-level head vs employee.** Is the `responsibleEmployeeId` purely informational, or does it have permission implications (e.g., the head can sign acceptance acts on behalf of the department)? Default: informational only in MVP. Phase 2 may give the head approval rights.

## Acceptance criteria

- [ ] `departments` collection with the typedef above.
- [ ] Super Admin can create, edit, deactivate departments through `/departments`.
- [ ] Asset Admin and Tech Admin can read; cannot write.
- [ ] Each department references exactly one `branchId`.
- [ ] Deactivating a department with shared-asset assignments is blocked with an error.
- [ ] `<DepartmentSelect>` filters by chosen branch.
- [ ] Every write produces an audit-log row.
- [ ] Name is multi-language via `<MultiLangInput>`.

## Dependencies

- **Depends on:** branches, roles-and-permissions, internationalization, audit-trail.
- **Depended on by:** employees, asset-assignment-and-acts (when assigning to department).
