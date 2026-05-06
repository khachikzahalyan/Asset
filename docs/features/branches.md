# Branches

**Phase:** 1 (MVP)
**Status:** spec
**Owner agents:** domain-modeler, firebase-engineer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §4, §6

## Purpose & user value

A **Branch** is a physical location where assets live and where employees are based. Every asset must be associated with exactly one branch. AMS distinguishes two branch *types*: a regular **branch** (e.g., a retail office) and a **warehouse** (a centralized storage location). The distinction matters because assets sitting in a warehouse are typically unassigned (waiting to be issued), whereas assets in a branch are typically assigned to a specific employee at that branch.

The Super Admin manages branches (create, rename, mark closed). Other admins read the list to populate dropdowns when creating assets or employees.

## In scope

- A `branches` Firestore collection.
- The Branch entity with English code identifier, multi-language `name`, `type` (`'branch' | 'warehouse'`), `address`, optional `responsibleEmployeeId` (a Branch Manager), `isActive`, `createdAt`, `updatedAt`.
- A `/branches` page (list) and `/branches/:id` (detail/edit).
- Soft-close: setting `isActive: false` instead of hard-delete (deleting a branch with assets/employees would cascade-orphan them).
- Validation: cannot deactivate a branch that still has active employees or active assets (the form blocks it; rule enforces).
- Audit-log row on every write.

## Out of scope

- Per-branch admin scoping (Asset Admin sees all branches in MVP; revisit if customer asks for branch-scoped admins).
- Branch hierarchies (parent/child, regions). Flat list only.
- Branch-specific notification preferences.
- Branch-specific asset prefixes (the inventory-code prefix lives on the Category, not the Branch).
- Geo-coordinates / map view.

## Domain entities involved

- **Branch** — primary entity for this feature. See typedef below.
- **Employee** — references a branch via `branchId`.
- **Asset** — references a branch via `branchId` (the asset's current physical location).
- **Assignment** — references a branch indirectly through the asset.

## Key user flows

### Creating a branch (Super Admin)

1. Super Admin opens `/branches` → clicks "Add branch".
2. Form fields:
   - `name` — `<MultiLangInput>` (Tier 2; required ru, en, hy)
   - `type` — radio: "Branch" / "Warehouse"
   - `address` — single-language Tier-3 string (free-text, as typed)
   - `responsibleEmployeeId` — optional employee dropdown (nullable; can be set later when employees exist)
3. On submit: repository creates the doc; audit row written in same transaction.
4. Redirect to `/branches/:id`.

### Renaming or editing a branch

1. Super Admin opens `/branches/:id` → "Edit".
2. Same form as create, pre-filled.
3. On submit: doc updated, audit row `{ entity: 'branch', action: 'update', diff: { ... } }`.

### Deactivating a branch

1. Super Admin opens `/branches/:id` → "Deactivate".
2. UI checks: is there any asset with `branchId == this && status != final`? Is there any employee with `branchId == this && isActive`? If yes, block the action with a clear error and a list of blocking entities.
3. If clear, set `isActive: false`. Audit row `{ entity: 'branch', action: 'deactivate' }`.
4. Branch disappears from creation dropdowns but remains visible in lists with a "Closed" badge for historical reference.

### Reading branches (any admin)

1. `/branches` shows table: name (localized), type, address, responsible, asset count, employee count, active/inactive.
2. Search by name (across locales) and filter by type / active.

## UI surfaces

- `/branches` — `BranchListPage` with table.
- `/branches/:id` — `BranchDetailPage` with summary + edit button + tabs for "Employees at this branch" and "Assets at this branch".
- `/branches/:id/edit` (or modal) — `BranchEditForm`.
- Dropdown component `<BranchSelect>` reused by employee and asset forms.

shadcn/ui primitives: `Table`, `Dialog`, `Form`, `Input`, `Select`, `RadioGroup`, `Badge`, `Button`.

## Firestore collections & shape

### `branches/{branchId}`

```jsdoc
/**
 * @typedef {Object} Branch
 * @property {string} branchId
 * @property {{ ru: string, en: string, hy: string }} name
 * @property {'branch'|'warehouse'} type
 * @property {string} address                 // free-text, Tier 3
 * @property {string|null} responsibleEmployeeId
 * @property {boolean} isActive
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy               // uid
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy               // uid
 */
```

### Indexes

- Single-field on `isActive` (auto).
- Single-field on `type` (auto).
- Composite `(isActive ASC, type ASC, name.ru ASC)` if list page sorts by name; only add if Firebase warns about it in dev console.

### Rule sketch

```
match /branches/{branchId} {
  allow read: if isAdmin();
  allow create, update: if isSuperAdmin()
                        && request.resource.data.name.keys().hasOnly(['ru','en','hy'])
                        && request.resource.data.type in ['branch','warehouse'];
  allow delete: if false;  // soft-close only
}
```

Audit-log helper writes to `audit_logs` in the same transaction as every create/update.

## Storage paths

- None (no images on branches in MVP).

## Permissions / role gates

| Action | super_admin | asset_admin | tech_admin | employee |
|---|---|---|---|---|
| Read branches | ✅ | ✅ | ✅ | ❌ |
| Create / update / deactivate | ✅ | ❌ | ❌ | ❌ |

## Open questions

- **Warehouse vs branch — is the distinction meaningful for any rule?** Beyond UI labeling and reporting filters, does anything in the system *behave* differently for a warehouse vs a branch? Default: no — same entity, same rules, just a `type` flag. Revisit if a customer needs warehouse-only operations (e.g., bulk receive).
- **Multiple central warehouses?** Spec implies one central warehouse; data model supports many. Keep model permissive.
- **Address i18n.** Address is currently Tier 3 (single string). If a customer needs the address in three languages (rare), promote to a `<MultiLangInput>`. Not MVP.

## Acceptance criteria

- [ ] `branches` collection exists with the typedef above.
- [ ] Super Admin can create, edit, deactivate a branch through `/branches`.
- [ ] Asset Admin and Tech Admin can read but cannot write.
- [ ] Deactivating a branch with active assets or employees is blocked with a clear error message listing the blockers.
- [ ] Inactive branches do not appear in `<BranchSelect>` for new asset/employee assignments but DO appear in lists with a "Closed" badge.
- [ ] Every write produces an `audit_logs` row.
- [ ] Branch name is multi-language via `<MultiLangInput>`.
- [ ] Address is single-language Tier-3 free text.
- [ ] Firestore rule prevents non-Super-Admin writes; rule test verifies.

## Dependencies

- **Depends on:** roles-and-permissions, internationalization, audit-trail.
- **Depended on by:** employees, asset-registry, dashboards (branch counts).
