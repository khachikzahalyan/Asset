# Employees Foundation — Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Sequential dispatch only — no parallel implementer agents during execution.

**Goal:** Ship the Employees foundation of AMS Phase 1 (`employees` collection, repository, list page, create/edit dialog reused from the Quick Actions block on the dashboard) with full audit-log coverage, role gates, i18n in `ru`/`en`/`hy`, and tests at every layer.

**Architecture:** Ports-and-adapters mirroring the existing `branches` slice — pure domain module + JSDoc port + Firestore adapter using `runTransaction` to write the entity doc and the `audit_logs` row atomically through the existing `auditHelper`. UI consumes the adapter through hooks and renders shadcn/ui primitives. The form dialog is one component reused both from `/employees` and from the dashboard "Быстрые действия" block.

**Tech Stack:** React 18 + Vite + Tailwind + shadcn/ui (already installed), `react-router-dom` v7, `i18next` + `react-i18next`, Firebase v9 modular SDK + `runTransaction`, Vitest + Testing Library, `@firebase/rules-unit-testing` for rules tests.

---

## 0. Decisions — locked from the brainstorm (do not relitigate)

These come from the parent session and are **final** for Wave 1. The implementer must respect them; the spec-reviewer must enforce them.

| Decision | Value |
|---|---|
| UX strategy for "Быстрые действия" | Variant B — minimum-viable modals with reusable form components |
| Where Quick Actions live | Dashboard tile-block + duplicated buttons on `/employees` (and later `/assets`). No FAB. |
| Wave order | **Employees → Assets → Assignment**. This plan covers Employees only. |
| "Add employee" role gate (Wave 1) | `super_admin` + `asset_admin` only. `tech_admin` has read-only access; `employee` has no access. |
| Email uniqueness strategy | **Random doc id + transactional uniqueness check via `email_index/{emailHashLowercased}` sentinel doc**. (Not deterministic doc id — keeps URLs clean and avoids exposing a hashed PII fragment in routes.) |
| Termination semantics in Wave 1 | Soft-deactivate only (`isActive: false` + `terminatedAt`). The full Phase-3 redistribution wizard is out of scope. Block termination if active assignments exist — but in Wave 1 there are no assignments yet, so the check is a stub that always returns 0 and the operation always succeeds. The stub is replaced in Wave 3. |
| Re-activation | Super Admin only (per `docs/features/employees.md` Open questions, default). |
| Department field in Wave 1 | **Optional**, no Department collection wired (`departments` collection is a separate plan). Form exposes the field as a free-text `position` plus a *deferred* `departmentId` field that is hidden behind a `featureFlag.enableDepartments` constant in `src/domain/featureFlags.js` and rendered as `null` until Wave 1.5 (Departments). |
| `userId` link to `users/{uid}` | Not stored in Wave 1. The link is established when the employee first signs in via email-link (out of scope here). The `employees` doc has no `userId` field yet. |
| MultiLangInput on employee form | None — every Employee text field is Tier 3 (free text) or Tier 4 (email, ASCII). |

---

## 1. Goal & Non-Goals

### Goal

Phase-1-complete Employees feature:

- `employees` Firestore collection with the typedef from `docs/features/employees.md`.
- A `firestoreEmployeeRepository` adapter that funnels every write through `runTransaction` + `buildAuditLog`.
- A `/employees` list page with search + branch filter + status filter.
- A `/employees/:id` detail page (read-only summary in Wave 1; the "Currently assigned assets" tab is a stub that says "Появится в Wave 3").
- A reusable `<EmployeeFormDialog>` modal handling create + edit, opened from both `/employees` and the dashboard Quick Actions tile.
- Role gates: `super_admin` + `asset_admin` write; `tech_admin` reads; `employee` denied.
- i18n keys for all UI strings in `ru` / `en` / `hy`.
- Audit row for every create / update / deactivate / activate, written in the same transaction as the entity write.
- Email uniqueness enforced via `email_index/{emailHashLowercased}` sentinel docs in the same transaction.
- Tests: domain unit, repo unit (mocked Firestore), rules tests against the emulator, page render, dialog interaction.

### Non-Goals (explicitly deferred)

- **Assets, asset categories, asset statuses, assignments, acts of acceptance** — Waves 2 and 3.
- **Excel import (two-pass employees + assets)** — Phase 2.
- **Phase-3 employee termination flow** with bulk asset redistribution.
- **Profile photo upload** to Storage.
- **Custom HR fields** (salary, ID number, contract scan).
- **Auth account linking** (`users/{uid}.employeeId`) — created on first email-link sign-in, not by this slice.
- **Multi-step wizard.** Single dialog only.
- **Bulk actions** (mass-deactivate, mass-edit) on the list page.
- **Department collection and `<DepartmentSelect>`** — separate Wave 1.5 plan; `departmentId` field is wire-shaped but null in Wave 1.

---

## 2. Sources of truth — re-read before starting

All paths absolute. Open these BEFORE the first dispatch.

- `C:/Users/DELL/Desktop/assets-crm/docs/AMS_Plan_v3.md` — sections covering employees, audit, role-permission matrix.
- `C:/Users/DELL/Desktop/assets-crm/docs/features/employees.md` — primary product spec for this slice (re-read entirely).
- `C:/Users/DELL/Desktop/assets-crm/docs/features/roles-and-permissions.md` — role matrix, rule helpers (`isSuperAdmin`, `isAssetAdmin`, `isTechAdmin`, `isAdmin`).
- `C:/Users/DELL/Desktop/assets-crm/docs/features/audit-trail.md` — `audit_logs` shape, helper contract, append-only rules.
- `C:/Users/DELL/Desktop/assets-crm/docs/features/dashboards.md` — Quick Actions tile target.
- `C:/Users/DELL/Desktop/assets-crm/docs/features/branches.md` — pattern reference (the Wave-1 Employees slice mirrors this slice almost 1:1).
- `C:/Users/DELL/Desktop/assets-crm/docs/features/internationalization.md` — 4-tier i18n strategy (Employee fields are all Tier 3/4).
- `C:/Users/DELL/Desktop/assets-crm/src/domain/branches.js` — reference shape for the new `src/domain/employees.js`.
- `C:/Users/DELL/Desktop/assets-crm/src/domain/repositories/BranchRepository.js` — reference shape for the new `EmployeeRepository` port.
- `C:/Users/DELL/Desktop/assets-crm/src/infra/repositories/firestoreBranchRepository.js` — reference adapter; `firestoreEmployeeRepository` is structurally similar with the added uniqueness step.
- `C:/Users/DELL/Desktop/assets-crm/src/lib/audit/auditHelper.js` — `buildAuditLog`, `newAuditLogRef`. Already supports `entity: 'employee'`.
- `C:/Users/DELL/Desktop/assets-crm/firestore.rules` — rule helpers and existing branches/users blocks.
- `C:/Users/DELL/Desktop/assets-crm/firestore.indexes.json` — `employees` composite indexes already declared (`(branchId, isActive, lastName)`, `(departmentId, isActive)`); no new indexes needed in Wave 1.
- `C:/Users/DELL/Desktop/assets-crm/src/pages/BranchListPage.jsx` — page layout reference.
- `C:/Users/DELL/Desktop/assets-crm/src/pages/DashboardPage.jsx` — Quick Actions target.
- `C:/Users/DELL/Desktop/assets-crm/src/components/features/branches/BranchFormDialog.jsx` — dialog reference.
- `C:/Users/DELL/Desktop/assets-crm/src/components/features/branches/BranchSelect.jsx` — already-existing select used by the form.
- `C:/Users/DELL/Desktop/assets-crm/src/locales/ru/employees.json` — partial keys already there; will be expanded.

---

## 3. Domain layer

### 3.1 `src/domain/employees.js`

Pure JS, no Firestore, no React. Mirrors `src/domain/branches.js`.

```jsdoc
/**
 * @typedef {Object} Employee
 * @property {string} employeeId            // mirrors doc id
 * @property {string} firstName             // Tier 3, free text, required
 * @property {string} lastName              // Tier 3, required
 * @property {string|null} middleName       // Tier 3, optional
 * @property {string} email                 // Tier 4, ASCII, required, unique among active
 * @property {string|null} phone            // Tier 3, optional
 * @property {string} branchId              // FK -> branches; required
 * @property {string|null} departmentId     // wire-shaped, null in Wave 1
 * @property {string|null} position         // Tier 3, free text, optional
 * @property {boolean} isActive             // soft-deactivation flag
 * @property {import('firebase/firestore').Timestamp|null} hiredAt
 * @property {import('firebase/firestore').Timestamp|null} terminatedAt
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */

/**
 * @typedef {Object} EmployeeInput
 * @property {string} firstName
 * @property {string} lastName
 * @property {string|null} [middleName]
 * @property {string} email
 * @property {string|null} [phone]
 * @property {string} branchId
 * @property {string|null} [departmentId]
 * @property {string|null} [position]
 * @property {boolean} [isActive]            // defaults to true on create
 * @property {Date|null} [hiredAt]           // converted to Timestamp by adapter
 */
```

Exports:

- `emptyEmployeeInput(): EmployeeInput` — fresh form-state with `isActive: true`.
- `sanitizeEmployeeInput(input): EmployeeInput` — trim every string, lower-case email, coerce nulls, normalize booleans.
- `validateEmployeeInput(input): Record<string, string>` — error keys in `validation.json`.
  - `firstName`, `lastName` required (`errorRequired`).
  - `email` required + must match ASCII regex `^[\x21-\x7E]+@[\x21-\x7E]+\.[\x21-\x7E]+$` (`errorEmailInvalid`); reject non-ASCII chars (`errorEmailNonAscii`).
  - `branchId` required (`errorBranchRequired`).
  - `phone` optional, but if present must match `^\+?[0-9 ()-]{6,32}$` (`errorPhoneInvalid`).
- `isEmployeeInputValid(input): boolean` — true when `validateEmployeeInput` returns `{}`.
- `formatEmployeeName(employee, locale): string` — `"${lastName} ${firstName}${middleName ? ' ' + middleName : ''}"`. Locale-agnostic in Wave 1 (Tier 3 free text), but the parameter is reserved for future locale-aware ordering.
- `hashEmailKey(email): string` — pure helper that returns `email.trim().toLowerCase()`. Used as the doc id of the `email_index/{key}` sentinel. (Plain lower-case; no real hash — keeps debuggability and the key is already a primary identifier, no PII benefit from hashing.) NOTE: documented as "lookup key" not "hash" in the JSDoc; the function name is `emailKey` to avoid implying cryptographic hashing.

Rename the helper to `emailKey(email)` in the actual code. `hashEmailKey` is misleading.

### 3.2 `src/domain/repositories/EmployeeRepository.js`

JSDoc-only port (no runtime exports). Mirrors `BranchRepository.js`.

```jsdoc
/**
 * @typedef {Object} EmployeeRepository
 * @property {(onData: (employees: Employee[]) => void, onError: (err: Error) => void) => () => void} list
 * @property {(id: string, onData: (e: Employee | null) => void, onError: (err: Error) => void) => () => void} get
 * @property {(input: EmployeeInput, actor: ActorContext) => Promise<string>} create
 * @property {(id: string, input: EmployeeInput, before: Employee, actor: ActorContext) => Promise<void>} update
 * @property {(id: string, isActive: boolean, before: Employee, actor: ActorContext, opts?: { activeAssignmentCount?: number }) => Promise<void>} setActive
 */
```

`setActive` accepts an optional `activeAssignmentCount` so Wave 3 can plug in the real check without changing the signature. In Wave 1 the caller passes `0` and the helper enforces `if (count > 0 && !isActive) throw EmployeeHasActiveAssignmentsError`.

### 3.3 Domain invariants (encoded in the validator + repo)

1. Every Employee must have `branchId` referencing an existing branch — referential integrity is **not** enforced by Firestore rules in Wave 1 (rules only validate type/format); the UI's `<BranchSelect>` and admin discipline are the safeguard. A future hardening pass can add `exists(/databases/.../branches/$(request.resource.data.branchId))` once we measure the read cost.
2. Email is unique among **all** employees, active or terminated — no email reassignment in Wave 1.
3. Email lower-case canonical form is the only one stored.
4. Termination requires zero active assignments (stubbed to 0 in Wave 1).
5. Reactivation clears `terminatedAt` (sets it to `null`). Reactivation is `super_admin` only — both the rules and the UI enforce this.

### 3.4 Custom error classes

`src/domain/employees.js` exports:

```js
export class EmployeeEmailTakenError extends Error {
  constructor(email) { super(`Email already in use: ${email}`); this.code = 'employee/email-taken'; }
}
export class EmployeeHasActiveAssignmentsError extends Error {
  constructor(count) { super(`Cannot deactivate: ${count} active assignments`); this.code = 'employee/has-active-assignments'; }
}
```

The dialog catches `code` and renders the matching i18n key.

---

## 4. Firestore schema, rules, and indexes

### 4.1 Collections

| Collection | Doc id | Purpose |
|---|---|---|
| `employees/{employeeId}` | random | The Employee entity. |
| `email_index/{emailKey}` | `email.trim().toLowerCase()` | Uniqueness sentinel. Body: `{ employeeId: string, createdAt: Timestamp }`. |

### 4.2 Indexes — already declared

`firestore.indexes.json` already has:

- `(branchId ASC, isActive ASC, lastName ASC)` — `employees`.
- `(departmentId ASC, isActive ASC)` — `employees`.

No index changes needed in Wave 1. The list page query is `orderBy('lastName','asc')` (single-field auto index) plus client-side filtering for search; once the dataset grows past a few thousand we may revisit.

### 4.3 Rules diff — `firestore.rules`

Add **after** the `branches` block, **before** the closing `}` of the outer `match`:

```firestore-rules
// ---- employees ----
// Read by any admin. Tech Admin is read-only.
// Create / update / setActive / reactivate handled by per-action conditions below.
// Soft-delete only.
function isAsciiPrintable(s) {
  // CEL doesn't expose a regex with character classes, so we approximate via
  // length bounds + the rules engine's `matches`.
  return s is string && s.matches('^[\\x21-\\x7e]+@[\\x21-\\x7e]+\\.[\\x21-\\x7e]+$');
}

function isValidEmployeeShape(d) {
  return d.firstName is string && d.firstName.size() > 0
      && d.lastName  is string && d.lastName.size()  > 0
      && (!('middleName' in d) || d.middleName == null || d.middleName is string)
      && d.email is string && isAsciiPrintable(d.email)
      && (!('phone' in d) || d.phone == null || d.phone is string)
      && d.branchId is string && d.branchId.size() > 0
      && (!('departmentId' in d) || d.departmentId == null || d.departmentId is string)
      && (!('position' in d) || d.position == null || d.position is string)
      && d.isActive is bool;
}

match /employees/{employeeId} {
  // tech_admin can read; super_admin + asset_admin can read AND write.
  allow read: if isAdmin();

  allow create: if (isSuperAdmin() || isAssetAdmin())
                && isValidEmployeeShape(request.resource.data)
                && request.resource.data.createdBy == request.auth.uid
                && request.resource.data.updatedBy == request.auth.uid
                && request.resource.data.createdAt == request.time
                && request.resource.data.updatedAt == request.time
                && request.resource.data.terminatedAt == null;

  allow update: if (isSuperAdmin() || isAssetAdmin())
                && isValidEmployeeShape(request.resource.data)
                && request.resource.data.createdBy == resource.data.createdBy
                && request.resource.data.createdAt == resource.data.createdAt
                && request.resource.data.updatedBy == request.auth.uid
                && request.resource.data.updatedAt == request.time
                // Reactivation (isActive flips false -> true) is super_admin only.
                && (
                     resource.data.isActive == request.resource.data.isActive
                     || (resource.data.isActive == true && request.resource.data.isActive == false)
                     || (resource.data.isActive == false && request.resource.data.isActive == true && isSuperAdmin())
                   );

  allow delete: if false;
}

// ---- email_index ----
// Sentinel collection enforcing employee email uniqueness in a transaction.
// Doc id = lowercased trimmed email; body { employeeId, createdAt }.
match /email_index/{emailKey} {
  allow read:   if isAdmin();
  allow create: if (isSuperAdmin() || isAssetAdmin())
                && request.resource.data.employeeId is string
                && request.resource.data.createdAt == request.time;
  allow update, delete: if (isSuperAdmin() || isAssetAdmin());
  // ^ Update/delete needed when an admin edits an employee's email or terminates
  //   (we keep the sentinel so a terminated email cannot be reused; cleanup is manual).
}
```

Rules helpers (`isSuperAdmin`, `isAssetAdmin`, `isAdmin`) already exist.

> **Note for firebase-engineer:** `email_index` update/delete is permissive on purpose — only admins reach it, and the audit row in `audit_logs` is the immutable trail. We do NOT want a separate audit row for index doc churn (it's noise). The repository writes index doc moves; the implementation is in `firestoreEmployeeRepository.update`.

### 4.4 The audit-helper contract is already in place

`buildAuditLog` already accepts `entity: 'employee'` (whitelisted in `ALLOWED_ENTITIES`). No change to `auditHelper.js` is required. The Wave 1 implementer just calls it — same shape as the branches adapter.

---

## 5. Repository adapter

### 5.1 File layout

`src/infra/repositories/firestoreEmployeeRepository.js`. Mirrors `firestoreBranchRepository.js` with three differences:

1. `create` writes **three** docs in one transaction: `employees/{id}` + `email_index/{emailKey}` + `audit_logs/{logId}`. Before writing, it `tx.get(emailIndexDoc)` and rejects with `EmployeeEmailTakenError` if it exists.
2. `update` writes the employee doc, the audit row, and conditionally the index sentinel: if `before.email !== after.email`, the transaction also `tx.delete(oldEmailIndex)` and `tx.set(newEmailIndex, ...)` after a `tx.get(newEmailIndex)` uniqueness check.
3. `setActive(false, ...)` first checks `opts.activeAssignmentCount ?? 0 === 0`, then writes the audit (`deactivate`) plus `terminatedAt: serverTimestamp()`. `setActive(true, ...)` writes the audit (`activate` *or* `reactivate` if `before.isActive === false && before.terminatedAt != null`) and clears `terminatedAt`.

### 5.2 `auditSnapshot` for employees

```js
function auditSnapshot(obj) {
  if (!obj) return null;
  return {
    firstName: obj.firstName ?? null,
    lastName: obj.lastName ?? null,
    middleName: obj.middleName ?? null,
    email: obj.email ?? null,
    phone: obj.phone ?? null,
    branchId: obj.branchId ?? null,
    departmentId: obj.departmentId ?? null,
    position: obj.position ?? null,
    isActive: obj.isActive ?? null,
    terminatedAt: obj.terminatedAt ? obj.terminatedAt.toMillis?.() ?? null : null,
  };
}
```

`Timestamp` → millis is intentional: keeps the audit blob JSON-clean (no Firestore SDK objects).

### 5.3 Adapter exports (port shape)

```js
export const firestoreEmployeeRepository = Object.freeze({
  list: subscribeEmployees,
  get: subscribeEmployee,
  create: createEmployee,
  update: updateEmployee,
  setActive: setEmployeeActive,
});
```

### 5.4 Subscriptions

- `subscribeEmployees(onData, onError)` — `query(collection(db,'employees'), orderBy('lastName','asc'))`.
- `subscribeEmployee(id, onData, onError)` — single-doc.

---

## 6. UI surfaces

### 6.1 Routes and gates

`src/config/routes.js` — append:

```js
EMPLOYEES: '/employees',
EMPLOYEE_DETAIL: '/employees/:id',
```

```js
{ path: ROUTES.EMPLOYEES,        allowedRoles: [ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN, ROLES.TECH_ADMIN] },
{ path: ROUTES.EMPLOYEE_DETAIL,  allowedRoles: [ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN, ROLES.TECH_ADMIN] },
```

`src/App.jsx` — wrap the page in a `RoleGate`:

```jsx
<Route path="/employees" element={
  <RoleGate roles={[ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN, ROLES.TECH_ADMIN]}>
    <EmployeeListPage />
  </RoleGate>
} />
<Route path="/employees/:id" element={
  <RoleGate roles={[ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN, ROLES.TECH_ADMIN]}>
    <EmployeeDetailPage />
  </RoleGate>
} />
```

`AppShell.jsx` already lists `/employees` for `ADMIN_ROLES` — no nav change.

### 6.2 Hooks

- `src/hooks/useEmployees.js` — list subscription (mirror of `useBranches`).
- `src/hooks/useEmployee.js` — single-doc subscription (mirror of `useBranch`).

### 6.3 Components

- `src/components/features/employees/EmployeeFormDialog.jsx` — modal handling create + edit. Props: `{ open, onClose, employee?, onSubmit }`. Internal layout:
  - Two-column grid on `sm+`, single column on mobile.
  - Fields:
    - `lastName` (required, `<Input>`).
    - `firstName` (required, `<Input>`).
    - `middleName` (optional, `<Input>`).
    - `email` (required, `<Input type="email">`, ASCII-validated on submit; rendered errors translate `errorEmailInvalid` / `errorEmailNonAscii` / `employee/email-taken`).
    - `phone` (optional, `<Input type="tel">`).
    - `branchId` (required, `<BranchSelect includeNone={false}>`).
    - `position` (optional, `<Input>`).
    - `hiredAt` (optional, `<Input type="date">`).
  - Submit button disabled while `submitting`.
  - On submit, call `firestoreEmployeeRepository.create(input, actor)` (or `.update(id, input, before, actor)` in edit mode); catch `EmployeeEmailTakenError` and surface `errors.email = 'errorEmailTaken'`. Other errors flow to `<Alert>`.
  - On success, `toast.success("Сотрудник создан / обновлён")` (Wave-1 toast may be a simple inline banner if no global toast is set up yet — check `src/components/common/`; if missing, render `<Alert variant="success">` for 4 seconds then close).
  - **CTA-link for the dashboard flow:** when invoked from the dashboard with prop `mode="quick"` and creation succeeds, the success banner includes a "Выдать актив этому сотруднику" button. The button is **disabled in Wave 1** with a tooltip "Выдача активов появится в Wave 3". The button is wired but inert; it's there to validate the i18n keys and the visual flow. (Alternative: hide the button entirely. Decision: render disabled — preserves the visual layout that Wave 3 will activate, matches the brainstorm decision to keep CTA chains.)
- `src/components/features/employees/EmployeeSelect.jsx` — reusable select listing **active** employees, filtered by an optional `branchId`. Used by future asset-assignment forms; shipped now as part of the Employees slice so Wave 3 doesn't have to backfill it.

### 6.4 Pages

- `src/pages/EmployeeListPage.jsx` — list with header, search box, branch filter (`<BranchSelect>` with "All" option), status filter chips (`active` / `terminated` / `all`), table columns: Lastname Firstname (link to detail) — Email — Branch (localized) — Position — Status (Badge: active / terminated). The "Add employee" button is rendered **only** when `role in [SUPER_ADMIN, ASSET_ADMIN]`. Empty state and loading state mirror `BranchListPage`.
- `src/pages/EmployeeDetailPage.jsx` — detail view: summary card with the employee's fields + an "Edit" button (gated, opens `<EmployeeFormDialog>` in edit mode) + a "Deactivate" / "Reactivate" button (deactivate gated to super_admin + asset_admin; reactivate gated to super_admin only) + a stub tab "Currently assigned assets" with the placeholder text "Появится в Wave 3" + a stub tab "История" with placeholder "Появится после интеграции с журналом аудита" (the Audit-trail timeline is a separate feature spec; we're not building it in Wave 1).

### 6.5 Dashboard Quick Actions wiring

`src/pages/DashboardPage.jsx` — modify the existing `<Card>` titled `t('quickActions')`:

- Render the three buttons (`addAsset`, `issueAsset`, `addEmployee`) inside a `<RoleGate>`:
  - `addAsset`, `issueAsset` → disabled in Wave 1 (no handler), but visible only to `[SUPER_ADMIN, ASSET_ADMIN]` for `addAsset` and to `ADMIN_ROLES` for `issueAsset`. Tooltip "Появится в следующей волне" on each.
  - `addEmployee` → visible to `[SUPER_ADMIN, ASSET_ADMIN]`; opens `<EmployeeFormDialog mode="quick">`. Tech Admin does not see this button at all.
- On dialog success, the dashboard receives the new `employeeId` and shows the inline CTA banner with the disabled "Выдать актив этому сотруднику" button (per §6.3).

### 6.6 Toast / inline-success surface

A global toast does not exist yet (`src/components/common/` has no `Toast` component). Wave 1 uses a **local success Alert** inside the dialog → a closing transition to a parent-mounted `<Alert variant="success">` banner that auto-hides after 4 seconds. If a future Wave introduces a toast provider, the dialog's success path migrates to it without changing the repository layer.

If the implementer feels strongly that a real toast helps, the recommended library is `sonner`. Default for Wave 1: do not introduce a new dependency; use `<Alert>`.

---

## 7. Permissions matrix — Wave 1 only

| Action | super_admin | asset_admin | tech_admin | employee |
|---|---|---|---|---|
| Read `/employees` list and `/employees/:id` | ✅ | ✅ | ✅ | ❌ (route gated) |
| Create employee | ✅ | ✅ | ❌ (UI button hidden + rules deny) | ❌ |
| Edit employee | ✅ | ✅ | ❌ | ❌ |
| Deactivate employee | ✅ | ✅ | ❌ | ❌ |
| Reactivate employee | ✅ | ❌ (rules deny) | ❌ | ❌ |
| Read own employee row at `/me` (out of scope here) | n/a | n/a | n/a | ✅ in Wave 4 |

Tech Admin reaches `/employees` but sees no write affordances. The "Add employee" button is hidden by `<RoleGate>`, the "Edit" button on detail page is hidden, the deactivate button is hidden. If Tech Admin somehow POSTs anyway (devtools), the rules deny.

The dashboard's "Add employee" Quick Action button is hidden for Tech Admin; for Tech Admin the dashboard still renders the Quick Actions card with only `issueAsset` (Wave 3) visible.

---

## 8. i18n — keys to add or expand

All paths absolute. `<MultiLangInput>` is **not** used in this slice — Employee text fields are Tier 3 (free text) or Tier 4 (email).

### 8.1 `src/locales/{ru,en,hy}/employees.json` — full required set

```json
{
  "title": "Сотрудники",
  "subtitle": "Список сотрудников и их активы",
  "addEmployee": "Добавить сотрудника",
  "editEmployee": "Редактировать сотрудника",
  "deactivate": "Деактивировать",
  "reactivate": "Восстановить",
  "firstName": "Имя",
  "lastName": "Фамилия",
  "middleName": "Отчество",
  "fullName": "ФИО",
  "email": "Email",
  "phone": "Телефон",
  "position": "Должность",
  "branch": "Филиал",
  "department": "Отдел",
  "hiredAt": "Дата найма",
  "terminatedAt": "Дата увольнения",
  "active": "Активен",
  "terminated": "Уволен",
  "status": "Статус",
  "filter_all": "Все",
  "filter_active": "Активные",
  "filter_terminated": "Уволенные",
  "filterByBranch": "Филиал",
  "filterByStatus": "Статус",
  "searchPlaceholder": "Поиск по имени или email",
  "emptyState": "Сотрудников пока нет. Нажмите «Добавить сотрудника», чтобы создать первого.",
  "currentlyAssignedAssets": "Закреплённые активы",
  "currentlyAssignedAssetsComingWave3": "Появится в Wave 3 — после внедрения активов и выдачи.",
  "historyTab": "История",
  "historyComingSoon": "Появится после интеграции с журналом аудита.",
  "issueAssetCta": "Выдать актив этому сотруднику",
  "issueAssetCtaDisabled": "Выдача активов появится в Wave 3",
  "toastCreated": "Сотрудник создан",
  "toastUpdated": "Сотрудник обновлён",
  "toastDeactivated": "Сотрудник деактивирован",
  "toastReactivated": "Сотрудник восстановлен",
  "errorEmailInvalid": "Неверный формат email",
  "errorEmailNonAscii": "Email должен содержать только латиницу",
  "errorEmailTaken": "Этот email уже используется другим сотрудником",
  "errorBranchRequired": "Выберите филиал",
  "errorPhoneInvalid": "Неверный формат телефона",
  "errorHasAssignments": "Нельзя деактивировать: за сотрудником закреплены активы",
  "confirmDeactivateTitle": "Деактивировать сотрудника?",
  "confirmDeactivateBody": "Сотрудник перестанет быть доступным для новых выдач. Все аудит-записи сохранятся.",
  "confirmReactivateTitle": "Восстановить сотрудника?",
  "confirmReactivateBody": "Сотрудник снова будет доступен для выдач."
}
```

The `en` file uses the same keys with English values; the `hy` file uses the same keys with Armenian values. The implementer drafts all three; the i18n-engineer verifies.

### 8.2 `src/locales/{ru,en,hy}/common.json` — only add if missing

Already present: `save`, `cancel`, `edit`, `delete`, `loading`, `search`. No additions expected.

### 8.3 `src/locales/{ru,en,hy}/dashboard.json` — keys already exist

`addEmployee`, `issueAsset`, `addAsset`, `quickActions` are all present. No changes.

### 8.4 `src/locales/{ru,en,hy}/validation.json`

Add if missing:

- `errorRequired` — already present from branches.

---

## 9. Tests

### 9.1 Domain unit tests — `src/test/employees.test.js`

- `sanitizeEmployeeInput` trims firstName/lastName/middleName/email/phone/position; lowercases email; coerces missing booleans.
- `validateEmployeeInput`:
  - Returns `{firstName:'errorRequired'}` when blank.
  - Returns `{email:'errorEmailInvalid'}` for `"foo"`.
  - Returns `{email:'errorEmailNonAscii'}` for `"тест@example.com"`.
  - Returns `{branchId:'errorBranchRequired'}` when missing.
  - Returns `{phone:'errorPhoneInvalid'}` for `"abc"`.
  - Returns `{}` for the happy-path object.
- `formatEmployeeName({firstName:'Khach', lastName:'Z', middleName:null}, 'ru')` returns `'Z Khach'`.
- `emailKey('  Foo@Bar.com ')` returns `'foo@bar.com'`.

### 9.2 Repository unit tests — `src/test/firestoreEmployeeRepository.test.js`

Uses the same hoisted-mock pattern as `firestoreBranchRepository.test.js`. Cover:

1. `create` writes 3 transactional ops (employee `set`, email_index `set`, audit `set`) and the audit row has `entity:'employee'`, `action:'create'`, `actorUid` matching, `before:null`, `after:{...}`.
2. `create` with a colliding `email_index` returns `tx.get` → `exists=true` and rejects with `EmployeeEmailTakenError` (the test stubs the `tx.get` to return `{exists:()=>true}`).
3. `create` rejects when `actor.uid` missing.
4. `update` writes `update(employee)` + `set(audit)` and **does not** touch the email_index when email is unchanged.
5. `update` with a changed email writes `delete(oldIndex)` + `set(newIndex)` after a `tx.get(newIndex)` collision check.
6. `update` rejects when the new email is taken (collision branch returns `EmployeeEmailTakenError`).
7. `setActive(false, ...)` with `activeAssignmentCount: 0` writes `deactivate` audit + `terminatedAt: SERVER_TS`.
8. `setActive(false, ...)` with `activeAssignmentCount: 3` rejects with `EmployeeHasActiveAssignmentsError`, writes nothing.
9. `setActive(true, ...)` from a previously-terminated record writes `reactivate` audit (action distinguishes from create-time `activate`) and clears `terminatedAt`.
10. `firestoreEmployeeRepository` is `Object.isFrozen`-ed and matches the port shape.

### 9.3 Rules tests — `firestore-tests/employees.rules.test.js` (new file in a `firestore-tests/` folder at repo root)

Run via `@firebase/rules-unit-testing` against the Firestore emulator. The repo doesn't yet have rules-tests scaffolding for **branches** in CI either — Wave 1 introduces the tooling.

Setup the env:

```js
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
```

Cases (each with a `userInvitations` and `users` precondition seeded as `super_admin` / `asset_admin` / `tech_admin` / `employee` test users):

- **read `/employees/{id}`:** super_admin ✅, asset_admin ✅, tech_admin ✅, employee ❌.
- **create `/employees/{id}` with valid shape:** super_admin ✅, asset_admin ✅, tech_admin ❌, employee ❌, anon ❌.
- **create with non-ASCII email:** super_admin ❌ (rule rejects).
- **create missing `branchId`:** super_admin ❌.
- **update setting `isActive: false` (deactivate):** super_admin ✅, asset_admin ✅, tech_admin ❌, employee ❌.
- **update flipping `isActive: false → true` (reactivate):** super_admin ✅, asset_admin ❌ (rule denies asset_admin reactivation), tech_admin ❌, employee ❌.
- **update changing `createdBy`:** any role ❌ (rule denies).
- **update where `updatedBy != request.auth.uid`:** ❌.
- **delete `/employees/{id}`:** every role ❌.
- **`email_index/{key}` create:** super_admin ✅, asset_admin ✅, tech_admin ❌, employee ❌.
- **`audit_logs` update / delete:** every role ❌ (sanity check still holds with the Wave-1 changes).
- **`audit_logs` create with wrong `actorUid`:** ❌.
- **bootstrap super_admin path on `/users/{uid}`:** unchanged — sanity check still passes.

Add `npm run test:rules` script: `vitest --config firestore-tests/vitest.config.js`. The orchestrator's verification command (`npm test -- --run`) should also run rules tests if the script is wired into the root `test` script; if not, document `npm run test:rules` as a separate gate in the verification section below.

> **Decision:** in Wave 1 we add a top-level `firestore-tests/` workspace **only if it doesn't disrupt existing CI**. If the implementer hits friction wiring the emulator into the existing Vitest config, **add a `firestore-tests/package.json`** with its own Vitest config and a root-level npm script `"test:rules": "cd firestore-tests && npm test"`. Document this in `firestore-tests/README.md`.

### 9.4 UI component tests — `src/test/EmployeeFormDialog.test.jsx`

- Renders all required field labels.
- Submit with empty firstName surfaces `errorRequired`.
- Submit with non-ASCII email surfaces `errorEmailNonAscii`.
- Successful submit calls the `onSubmit` prop with sanitized input.
- After submit, the dialog calls `onClose`.
- Edit mode pre-fills the form fields from `employee` prop.
- The "Выдать актив этому сотруднику" CTA renders when `mode="quick"` and submission succeeds; the button is disabled and shows the tooltip key.

### 9.5 Page tests — `src/test/EmployeeListPage.test.jsx`

- Renders the empty-state when `useEmployees` returns `data: []`.
- Renders rows with localized branch name when data present.
- Hides "Добавить сотрудника" for `tech_admin`.
- Search filters rows.
- Status filter chip flips `active` / `terminated`.

### 9.6 Test infrastructure

- `src/test/setup.js` already wires `@testing-library/jest-dom`. No change.
- The repository unit tests follow the hoisted-mock pattern from `firestoreBranchRepository.test.js`. The implementer should copy the structure and adapt the assertions; **do not** start writing the tests against the emulator (those live in `firestore-tests/`).

---

## 10. Tasks (sequential, TDD-friendly)

Each task is one orchestrator dispatch. After every implementer task, dispatch `test-engineer`; the next task does not start until `test-engineer` returns PASS. Reviewer FAIL re-dispatches the relevant implementer.

### Task 1 — domain-modeler: `src/domain/employees.js` + port

- [ ] **Step 1:** Create `C:/Users/DELL/Desktop/assets-crm/src/domain/employees.js` with all typedefs, `emptyEmployeeInput`, `sanitizeEmployeeInput`, `validateEmployeeInput`, `isEmployeeInputValid`, `formatEmployeeName`, `emailKey`, and the two error classes from §3.4. No Firestore imports.
- [ ] **Step 2:** Create `C:/Users/DELL/Desktop/assets-crm/src/domain/repositories/EmployeeRepository.js` (JSDoc-only port mirroring `BranchRepository.js`).
- [ ] **Step 3:** Run `npm run lint` and `npm run build` to confirm no syntax errors.
- [ ] **Step 4:** Hand off to test-engineer.

**Dispatch:** `domain-modeler` (model: opus — domain shape decisions).

### Task 2 — test-engineer: domain unit tests

- [ ] Create `C:/Users/DELL/Desktop/assets-crm/src/test/employees.test.js` covering every case in §9.1.
- [ ] Run `npm test -- --run`; expected: all employees-domain tests green; no regression.
- [ ] PASS / FAIL report.

**Dispatch:** `test-engineer` (model: sonnet).

### Task 3 — firebase-engineer: repository adapter + `email_index` sentinel

- [ ] Create `C:/Users/DELL/Desktop/assets-crm/src/infra/repositories/firestoreEmployeeRepository.js` per §5.
- [ ] Wire `Object.freeze` adapter export matching the port.
- [ ] Do **not** modify `firestore.rules` or `firestore.indexes.json` yet — Task 5 handles rules.
- [ ] Run `npm run build` to confirm no syntax errors.

**Dispatch:** `firebase-engineer` (model: sonnet).

### Task 4 — test-engineer: repository unit tests

- [ ] Create `C:/Users/DELL/Desktop/assets-crm/src/test/firestoreEmployeeRepository.test.js` with hoisted mocks (model after `firestoreBranchRepository.test.js`).
- [ ] Cover every case in §9.2.
- [ ] Run `npm test -- --run`. PASS / FAIL.

**Dispatch:** `test-engineer`.

### Task 5 — firebase-engineer: Firestore rules + `email_index` block

- [ ] Edit `C:/Users/DELL/Desktop/assets-crm/firestore.rules` — append the `employees` and `email_index` blocks from §4.3.
- [ ] Verify `firestore.indexes.json` already has the two `employees` indexes (it does); no change needed.
- [ ] Do not deploy.

**Dispatch:** `firebase-engineer`.

### Task 6 — test-engineer: rules tests against emulator

- [ ] Bootstrap `firestore-tests/` workspace per §9.3 (or wire into root vitest if frictionless).
- [ ] Add `firestore-tests/employees.rules.test.js` with every case in §9.3.
- [ ] Document `npm run test:rules` in the root `package.json`.
- [ ] Run the rules tests. PASS / FAIL.

**Dispatch:** `test-engineer`.

> If the test-engineer hits emulator-bootstrap friction, the agent reports back with the issue and the orchestrator re-dispatches `firebase-engineer` to wire the emulator config (`firebase.json` already exists; check whether `firestore: { port }` is configured).

### Task 7 — react-ui-engineer: hooks

- [ ] Create `C:/Users/DELL/Desktop/assets-crm/src/hooks/useEmployees.js` (mirror of `useBranches.js`).
- [ ] Create `C:/Users/DELL/Desktop/assets-crm/src/hooks/useEmployee.js` (mirror of `useBranch.js`).
- [ ] No Firestore imports — only the adapter.

**Dispatch:** `react-ui-engineer`.

### Task 8 — react-ui-engineer: `<EmployeeFormDialog>` and `<EmployeeSelect>`

- [ ] Create `C:/Users/DELL/Desktop/assets-crm/src/components/features/employees/EmployeeFormDialog.jsx` per §6.3.
- [ ] Create `C:/Users/DELL/Desktop/assets-crm/src/components/features/employees/EmployeeSelect.jsx` per §6.3 (filter by branch + active).
- [ ] No direct Firestore imports — call repository through `useAuth` for actor + the adapter.

**Dispatch:** `react-ui-engineer`.

### Task 9 — test-engineer: dialog tests

- [ ] Create `C:/Users/DELL/Desktop/assets-crm/src/test/EmployeeFormDialog.test.jsx` covering §9.4.
- [ ] Run `npm test -- --run`. PASS / FAIL.

**Dispatch:** `test-engineer`.

### Task 10 — react-ui-engineer: list page + detail page + routes

- [ ] Create `C:/Users/DELL/Desktop/assets-crm/src/pages/EmployeeListPage.jsx` per §6.4.
- [ ] Create `C:/Users/DELL/Desktop/assets-crm/src/pages/EmployeeDetailPage.jsx` per §6.4.
- [ ] Edit `C:/Users/DELL/Desktop/assets-crm/src/config/routes.js` — append `EMPLOYEES`, `EMPLOYEE_DETAIL`, `employeeDetailPath(id)` helper, and the route-table entries.
- [ ] Edit `C:/Users/DELL/Desktop/assets-crm/src/App.jsx` — wire the two `<Route>`s with `<RoleGate>`.

**Dispatch:** `react-ui-engineer`.

### Task 11 — test-engineer: page render tests

- [ ] Create `C:/Users/DELL/Desktop/assets-crm/src/test/EmployeeListPage.test.jsx` covering §9.5.
- [ ] Run `npm test -- --run`. PASS / FAIL.

**Dispatch:** `test-engineer`.

### Task 12 — react-ui-engineer: dashboard Quick Actions wiring

- [ ] Edit `C:/Users/DELL/Desktop/assets-crm/src/pages/DashboardPage.jsx` per §6.5: gate the three buttons, wire `addEmployee` to open `<EmployeeFormDialog mode="quick">`, surface the success banner with the disabled "Выдать актив" CTA.
- [ ] Disable `addAsset` and `issueAsset` with tooltip key `dashboard.comingNextWave`.
- [ ] Add `comingNextWave` key to `dashboard.json` in all three locales.

**Dispatch:** `react-ui-engineer`.

### Task 13 — i18n-engineer: locale files

- [ ] Edit `C:/Users/DELL/Desktop/assets-crm/src/locales/{ru,en,hy}/employees.json` to match §8.1 exactly. The `ru` file is canonical; the `en` and `hy` files mirror keys 1:1 with localized values.
- [ ] Add `comingNextWave` to `src/locales/{ru,en,hy}/dashboard.json`.
- [ ] Verify no Tier-2 `<MultiLangInput>` is used anywhere in the Employees slice.
- [ ] Run a render-test fixture that loads each locale and asserts every key resolves (no `[key]` placeholder strings).

**Dispatch:** `i18n-engineer` (model: sonnet — full namespace pass).

### Task 14 — test-engineer: i18n smoke

- [ ] Add a smoke test `C:/Users/DELL/Desktop/assets-crm/src/test/employees.i18n.test.js` that imports each locale's `employees.json` and asserts the same set of keys is present in all three locales.
- [ ] Run `npm test -- --run`. PASS / FAIL.

**Dispatch:** `test-engineer`.

### Task 15 — spec-reviewer

- [ ] Open `docs/features/employees.md` and this plan side-by-side.
- [ ] Verify every acceptance criterion in the spec is delivered (or explicitly deferred per §1 Non-Goals).
- [ ] Check the locked decisions in §0 are honored.
- [ ] Report PASS or numbered gaps with file:line and the implementer to re-run.

**Dispatch:** `spec-reviewer`.

### Task 16 — code-quality-reviewer

- [ ] Review files changed in Tasks 1, 3, 5, 7, 8, 10, 12, 13.
- [ ] Verify: modular Firebase v9 imports, no `firestore`/`auth`/`storage` imports in components/pages/hooks; every state-changing write goes through `runTransaction` + `buildAuditLog`; `<RoleGate>` used at routes; `t()` used for every UI string; no inline secrets; shadcn/ui primitives reused; error handling on every async call.
- [ ] Report PASS or issues.

**Dispatch:** `code-quality-reviewer`.

### Task 17 — security-reviewer (ALWAYS triggered for AMS)

- [ ] Review `firestore.rules` employees + email_index blocks per §4.3.
- [ ] Confirm `audit_logs` rule (`update, delete: if false`) is unchanged and still enforced.
- [ ] Confirm reactivation rule denies `asset_admin`.
- [ ] Confirm `email_index` cannot leak email enumeration to non-admins (read denied to `employee` and `tech_admin`-on-write).
- [ ] Confirm the dialog cannot inject HTML / non-ASCII into email; verify ASCII regex.
- [ ] Confirm no client write path lets `tech_admin` create or edit an employee.
- [ ] Confirm `employee_index` create/update don't allow forging `employeeId` to point to another employee's id (rule does not currently validate this; **add** `request.resource.data.employeeId == resource.data.employeeId` to the update branch and skip update entirely if the implementer chooses delete-then-create instead — note this in the security review and let firebase-engineer decide).
- [ ] Report PASS or issues.

**Dispatch:** `security-reviewer`.

### Task 18 — verification

- [ ] Run from `C:/Users/DELL/Desktop/assets-crm`:
  - `npm run lint`
  - `npm test -- --run`
  - `npm run test:rules` (or however the rules-test script ended up wired)
  - `npm run build`
- [ ] All four must pass with zero warnings.
- [ ] Manual smoke (developer-side, not part of an agent dispatch):
  1. Sign in as `super_admin` (zahalyanxcho@gmail.com).
  2. Open `/dashboard` → click "Добавить сотрудника" in Quick Actions → dialog opens.
  3. Fill all fields, pick an existing branch → Save → success banner with disabled "Выдать актив" CTA.
  4. Navigate to `/employees` → row visible.
  5. Click row → detail page renders with all fields.
  6. Click "Edit" → change phone → Save → updated.
  7. Click "Deactivate" → confirm → row shows "Уволен" badge.
  8. Sign out, sign in as a `tech_admin` (or simulate via `users/{uid}.role`) → confirm "Add employee" button is hidden, dashboard tile is hidden.
  9. Open Firestore console → verify two `audit_logs` rows (`create` then `update`) and one `email_index/{lowercaseEmail}` doc.

---

## 11. Open questions and default decisions

These are knowable but **not** worth blocking on. The implementer applies the default unless the user intervenes during Stage C.

| # | Question | Default for Wave 1 |
|---|---|---|
| 1 | Should we ship a global `<Toast>` provider in this slice? | No. Local `<Alert>` banner. Migrate when a multi-feature need emerges. |
| 2 | Should `email_index` get a TTL / cleanup script? | No. Manual cleanup in operator runbook (Phase 2). |
| 3 | Should reactivation be allowed for `asset_admin` too? | No — `super_admin` only per `docs/features/employees.md` Open questions. |
| 4 | Should the detail page show an audit timeline now? | No. Stub tab "Появится после интеграции с журналом аудита" — the timeline is a separate Audit-trail feature spec and should be one shared `<HistoryTab>` reused across entities. |
| 5 | Should `<EmployeeSelect>` be filtered by `branchId` only, or always show all? | Filter by `branchId` when prop provided; otherwise list every active employee. (Wave 3 will mostly pass `branchId`.) |
| 6 | Where should "Department" appear in the Wave-1 form? | Hidden behind `featureFlags.enableDepartments = false`. Wire-shaped only. |
| 7 | Should we add `userId` to Employee now? | No. Wave 4 (Employee self-service) wires the `users/{uid}.employeeId` direction. |
| 8 | Should we add Firestore composite indexes beyond the two already declared? | No. Wave 1 uses `orderBy('lastName','asc')` (auto). |
| 9 | Should we add a phone-format library? | No. Plain regex `^\+?[0-9 ()-]{6,32}$`. Phase 2 may upgrade to `libphonenumber-js`. |
| 10 | Should we accept email re-use after termination? | No. Email is permanently owned. |

---

## 12. Subagents involved in Wave 1

In dispatch order:

1. `domain-modeler` (Task 1).
2. `test-engineer` (Tasks 2, 4, 6, 9, 11, 14).
3. `firebase-engineer` (Tasks 3, 5).
4. `react-ui-engineer` (Tasks 7, 8, 10, 12).
5. `i18n-engineer` (Task 13).
6. `spec-reviewer` (Task 15).
7. `code-quality-reviewer` (Task 16).
8. `security-reviewer` (Task 17 — always for AMS).

---

## 13. Acceptance criteria — Wave 1 Done condition

- [ ] `employees` Firestore collection exists with the typedef from §3.1.
- [ ] `email_index/{emailKey}` sentinel collection exists; uniqueness enforced in a transaction.
- [ ] Every create / update / deactivate / reactivate writes one `audit_logs` row inside the same `runTransaction` as the entity write.
- [ ] `firestore.rules` deny all writes by `tech_admin` and `employee` to `employees` and `email_index`. `asset_admin` cannot reactivate. Verified by emulator tests.
- [ ] `/employees` and `/employees/:id` reachable for all three admin roles; `<RoleGate>` redirects employees to `/me`.
- [ ] `<EmployeeFormDialog>` is the single source of truth for create/edit, used both at `/employees` and the dashboard Quick Actions.
- [ ] Dashboard's "Добавить сотрудника" tile opens the same dialog and on success shows the disabled "Выдать актив этому сотруднику" CTA.
- [ ] Tech Admin sees no "Добавить сотрудника" affordance anywhere.
- [ ] All UI strings localized in `ru`, `en`, `hy`. Smoke test asserts key parity across locales.
- [ ] `npm run lint`, `npm test -- --run`, `npm run test:rules`, `npm run build` all pass.
- [ ] Manual smoke (§10 Task 18) succeeds end-to-end against the live Firebase project.
- [ ] No code references to "Telcell", "warehouse" (legacy), or any Phase-2/3 feature beyond stub strings.

---

## 14. Rollback

If Wave 1 lands broken on `main`:

1. Revert the file changes from §6 and §10 (page, dialog, hooks, routes, dashboard wiring).
2. Revert the Firestore rules append in `firestore.rules` for `employees` and `email_index`.
3. The `audit_logs` rule and the `branches` block are untouched — no rollback needed there.
4. Re-deploy the prior `firestore.rules` via `npx firebase deploy --only firestore:rules`.
5. The `employees` and `email_index` collections, if they have any data, can stay — they're read-only without rules permitting writes.

The `auditHelper.js` whitelist already allows `entity: 'employee'` — that's a pre-existing change and is safe to keep.

---

## 15. Self-review — performed before saving

- **Spec coverage:** every acceptance criterion in `docs/features/employees.md` maps to a §6 / §9 task or to a §1 Non-Goal. Reactivation is super_admin-only ✓. Email uniqueness ✓. Soft-deactivation ✓. Audit row on every write ✓. Department dropdown filtered by branch — deferred to Wave 1.5 (decision in §0). Phone regex — added. Tier-4 ASCII email — validator + rule both check.
- **No placeholders:** every code reference points to a real file, real function, real i18n key. No "TBD", no "implement appropriately".
- **Type consistency:** `EmployeeInput`, `Employee`, `ActorContext` (reused from `BranchRepository.js`), error classes — all referenced consistently across §3, §5, §6, §9.
- **The Wave-1 scope strictly excludes Assets and Assignments.** Quick Actions buttons for those are rendered as **disabled** with a "Появится в следующей волне" tooltip, which validates the visual chain decision from the brainstorm without bleeding scope.
