# Wave-1 Step 2 — Assets CRUD + StatusesAndCategoriesBootstrap

**Phase:** 1 (MVP)
**Spec references:**
- `docs/AMS_Plan_v3.md` §4 (inventory code), §5 (statuses), §8 (technical learning), §14 (db tables).
- `docs/features/asset-registry.md`
- `docs/features/asset-status-catalog.md`
- `docs/features/asset-categories.md`

This plan ships two coordinated work packages. Both touch the assets data
plane in different ways: Package A guarantees the catalogs (statuses +
categories) are seeded on first super_admin sign-in (the user has no
service-account key locally, so `npm run seed` is unavailable). Package B
adds the assets CRUD slice itself: domain, repository, hooks, rules, UI,
i18n, tests.

## Out of scope

- Excel Import/Export (Step 3).
- Assignment workflow / Выдать-Вернуть UI (Step 4) — `assignedTo` is set
  on create, but the dedicated transfer flow is later.
- Status-change history subcollection — leave a TODO comment in code
  pointing at future `/asset_status_log/{assetId}`.
- Photo / scan uploads.
- Write-off / disposal flows beyond setting the status.
- Tech Admin technical-attribute editing (Phase 2).

## Decisions baked in (not asking the user)

| Question | Decision | Source |
|---|---|---|
| Doc id for new asset | Auto-allocated by Firestore | matches existing pattern |
| Inventory number padding | **No zero-padding**, raw integer | spec §4 cleaner of two examples |
| Allowed `Куда` modes | `warehouse` (default) / `employee` / `branch` / `department` | user-approved form spec |
| Holder shape | `assignedTo: { kind: 'warehouse'\|'employee'\|'branch'\|'department', id: string\|null }` (id null for warehouse) | denormalization for fast list rendering |
| Default status code on create | `warehouse` (`DEFAULT_ASSET_STATUS_CODE`) | matches §5 "Поступление → Warehouse" |
| Filter assignable statuses by `Куда` | `Куда === warehouse` → only `isAssignable === false`; otherwise → only `isAssignable === true` | matches §5 lifecycle |
| Multi-lang `name` field | only when `category.requiresMultilang === true`; otherwise plain string | request explicit |
| Brand / Model | Tier-4 ASCII single string, optional | spec §6 / `asset-registry.md` |
| Serial number | Tier-4 ASCII single string, optional | spec |
| Department select component | Build a simple `<DepartmentSelect>` even though departments collection isn't built yet — render an empty-state "Отделы пока не настроены, выберите другой режим" until departments arrive | leaves Куда=ОТДЕЛ functional once departments ship |
| Employee select | Reuse `useEmployees`, simple `<EmployeeSelect>` | mirror `BranchSelect` |
| Concurrent create test | Mock Firestore transaction with two parallel `createAsset` calls and assert different inventory codes | matches `firestoreCategoryRepository.test.js` style |
| Rules for employee read of own assets | We don't have `users/{uid}.employeeId` mapping yet; **leave employee-read rule as `false` with a TODO**, the self-service page won't ship until Step 4. | risk-minimizing; admins still can read everything |

## File tree (new + modified)

### Package A — StatusesAndCategoriesBootstrap

**New:**
- `src/components/system/StatusesAndCategoriesBootstrap.jsx`

**Modified:**
- `src/components/layout/AppShell.jsx` — mount `<StatusesAndCategoriesBootstrap />` next to `<HeadOfficeBootstrap />`.

**Untouched (per the request):**
- `scripts/seed.js` — `bootstrapAssetStatuses` and `bootstrapCategories` stay in place for ops use.

### Package B — Assets CRUD

**New domain:**
- `src/domain/assets.js`

**New infra:**
- `src/infra/repositories/firestoreAssetRepository.js`

**New hooks:**
- `src/hooks/useAssets.js`
- `src/hooks/useAsset.js`

**New components:**
- `src/components/features/assets/AssetFormDialog.jsx`
- `src/components/features/assets/EmployeeSelect.jsx` (small select — mirrors BranchSelect API)
- `src/components/features/assets/DepartmentSelect.jsx` (empty-state stub — Step 2 has no departments collection; renders disabled with "—" placeholder + helper text)
- `src/components/features/assets/StatusBadge.jsx` (status with hex color background; reused from list/detail)

**New pages:**
- `src/pages/AssetListPage.jsx`
- `src/pages/AssetDetailPage.jsx`

**Modified:**
- `firestore.rules` — add `/assets/{assetId}` block.
- `src/config/routes.js` — add `ASSETS`, `ASSET_DETAIL` constants + table entries.
- `src/App.jsx` — add the two routes inside the AppShell route subtree.
- `src/locales/ru/assets.json` — add all keys (overwrite existing minimal stub).
- `src/locales/en/assets.json` — same keys.
- `src/locales/hy/assets.json` — same keys.
- `src/locales/ru/common.json` — leave `navAssets` alone (already exists).

**New tests:**
- `src/test/assets.test.js` — domain sanitize/validate.
- `src/test/firestoreAssetRepository.test.js` — transaction-based creation, monotonic counter, audit row.
- `src/test/AssetFormDialog.test.jsx` — required validation, Куда → Статус filtering, multi-lang branching.
- `src/test/assets.rulesMirror.test.js` — role matrix create/update/read.

### Untouched — verify

- `src/components/layout/AppShell.jsx` already lists `/assets` in `ADMIN_NAV` — no change to nav.

## Data shape

### Asset entity (`assets/{assetId}`)

```jsdoc
/**
 * @typedef {{ kind: 'warehouse', id: null }
 *           | { kind: 'employee', id: string }
 *           | { kind: 'branch', id: string }
 *           | { kind: 'department', id: string }} AssignedTo
 *
 * @typedef {Object} Asset
 * @property {string} assetId
 * @property {string} inventoryCode             // ^[A-Z0-9]+/[0-9]+$, immutable
 * @property {string} categoryId                // FK -> categories
 * @property {string} statusId                  // FK -> asset_statuses (defaults to 'warehouse')
 * @property {{ ru: string, en: string, hy: string } | string} name
 *   Tier 3 free text. Multi-lang shape ONLY when the category has
 *   requiresMultilang===true. Plain string otherwise.
 * @property {string|null} brand                // Tier 4 ASCII, optional
 * @property {string|null} model                // Tier 4 ASCII, optional
 * @property {string|null} serialNumber         // Tier 4, optional
 * @property {string|null} branchId             // location for warehouse/branch modes; null otherwise
 * @property {AssignedTo} assignedTo
 * @property {string|null} notes                // Tier 3 free text
 * @property {import('firebase/firestore').Timestamp|null} purchaseDate
 * @property {number|null} purchasePrice        // major units, e.g. 150000
 * @property {boolean} isActive                 // soft-archive flag (true at create)
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */

/**
 * @typedef {Object} AssetInput
 * @property {string} categoryId
 * @property {{ ru: string, en: string, hy: string } | string} name
 * @property {string|null} [brand]
 * @property {string|null} [model]
 * @property {string|null} [serialNumber]
 * @property {string} [statusId]               // defaults to 'warehouse'
 * @property {AssignedTo} [assignedTo]         // defaults to { kind: 'warehouse', id: null }
 * @property {string|null} [branchId]
 * @property {string|null} [notes]
 * @property {Date|null}   [purchaseDate]
 * @property {number|null} [purchasePrice]
 * @property {boolean} [isActive]
 */
```

### Custom errors

```js
class AssetInventoryCodeTakenError extends Error {
  constructor(code) {
    super(`Inventory code already in use: ${code}`);
    this.name = 'AssetInventoryCodeTakenError';
    this.code = 'asset/inventory-code-taken';
  }
}
```

## Domain helpers

Mirror the structure of `src/domain/employees.js` and `categories.js`:

- `emptyAssetInput(): AssetInput` — defaults: `assignedTo = { kind: 'warehouse', id: null }`, `statusId = ''` (form fills with default after `useAssetStatuses` resolves), `name = ''` (plain string by default), `isActive = true`.
- `sanitizeAssetInput(input, { category }): AssetInput`
  - Trims free-text fields.
  - If `category?.requiresMultilang`, sanitizes `name` as locale map (mirror `categories.js`); else sanitizes as plain trimmed string.
  - Validates `assignedTo.kind` is one of the four allowed values; coerces `id` to null when kind is `warehouse`.
  - Forces `branchId` to null when `assignedTo.kind === 'employee'` or `'department'` (the asset is "with a person", not at a location); keeps `branchId` when `kind === 'warehouse'` or `'branch'`.
  - Coerces ASCII-only on brand/model/serialNumber via `NON_ASCII_REGEX`.
- `validateAssetInput(input, { category }): Record<string,string>`
  - `categoryId` required.
  - `name`:
    - if multi-lang: at least one locale non-empty; warn key `errorNameAllLocales` when partial.
    - else: required plain string.
  - `brand`, `model`, `serialNumber` if present must be ASCII (key `errorAsciiOnly`).
  - `assignedTo.kind` valid.
  - When kind is employee/branch/department, `assignedTo.id` required (key `errorRequired`).
  - When kind is `warehouse` OR `branch`, `branchId` required (warehouse needs *which* warehouse). When kind is `employee` or `department`, `branchId` not required.
- `formatInventoryCode(prefix, number): string` — `${prefix}/${number}`, no zero-pad.
- `nameForDisplay(asset, locale): string` — uses `localize()` when multi-lang, else returns the string verbatim.

## Repository

`firestoreAssetRepository.js` shape:

```js
export const firestoreAssetRepository = Object.freeze({
  list: subscribeAssets,            // ordered by inventoryCode ASC
  get: subscribeAsset,              // single doc subscription
  create: createAsset,              // transactional: counter + asset + audit
  update: updateAsset,              // mutate metadata; status changes go via setStatus
  setStatus: setAssetStatus,        // dedicated audit action='status_change'
});
```

**`createAsset(input, actor)` transaction body:**
1. Validate `input.categoryId` is non-empty; load `categoryDoc` via `tx.get(doc(db, 'categories', categoryId))`. Throw if missing or `isActive === false`.
2. Read `tx.get(doc(db, 'category_counters', categoryId))`.
   - If counter doesn't exist, throw `Error('asset/counter-missing')` with a clear message — bootstrap should have created it.
3. Compose `inventoryCode = ${category.inventoryCodePrefix}/${counter.next}`.
4. `tx.update(counterRef, { next: counter.next + 1, updatedAt: serverTimestamp() })` — strict-monotonic, matches rules.
5. `tx.set(assetRef, { ...sanitized, inventoryCode, statusId: sanitized.statusId || 'warehouse', isActive: true, createdAt, createdBy, updatedAt, updatedBy })`.
6. `tx.set(auditRef, buildAuditLog({ entity: 'asset', entityId, action: 'create', actorUid, actorRole, before: null, after: auditSnapshot(sanitized + inventoryCode) }))`.

**`updateAsset(id, input, before, actor)`:**
- `inventoryCode` immutable — never include in the update payload; rules layer would reject anyway.
- Excludes `statusId` from the patchable fields (use `setStatus`).
- `assignedTo` editable here (this is also how the form re-issues on edit until the dedicated assignment workflow ships in Step 4).

**`setAssetStatus(id, statusId, before, actor, { comment? })`:**
- Dedicated audit `action: 'status_change'`, audit `meta: { fromStatusId, toStatusId, comment }`.
- Validates the new status exists (defensive, also enforced by rules).
- Updates `statusId`, `updatedBy`, `updatedAt`.

**Audit blob shape:** mirror `firestoreEmployeeRepository.auditSnapshot` with timestamps→millis. Fields:
`{ inventoryCode, categoryId, statusId, name, brand, model, serialNumber, branchId, assignedTo, notes, purchaseDate (millis), purchasePrice, isActive }`.

## Hooks

```js
// useAssets.js
export function useAssets() {
  // Standard { data, loading, error } subscription via firestoreAssetRepository.list.
}

// useAsset.js
export function useAsset(id) {
  // Single-doc subscription.
}
```

Same structure as `useEmployees` / `useEmployee`.

## Firestore rules

New block in `firestore.rules` (place after `/asset_statuses`):

```
function isValidInventoryCode(c) {
  return c is string && c.matches('^[A-Z0-9]+/[0-9]+$');
}

function isValidAssignedTo(a) {
  return a is map
         && a.keys().hasOnly(['kind', 'id'])
         && (
              (a.kind == 'warehouse' && a.id == null)
              || (a.kind in ['employee', 'branch', 'department'] && a.id is string && a.id.size() > 0)
            );
}

function isValidAssetName(n) {
  // Plain string OR a 3-locale map. Both shapes accepted.
  return n is string
         || (n is map
             && n.keys().hasOnly(['ru', 'en', 'hy'])
             && n.ru is string && n.en is string && n.hy is string);
}

function isAsciiOrNull(s) {
  return s == null || (s is string && s.matches('^[\\x20-\\x7E]*$'));
}

match /assets/{assetId} {
  // Phase-1 read: any signed-in admin. Employee read is the Step-4
  // problem (we don't have users/{uid}.employeeId reliably yet).
  allow read: if isAdmin();

  allow create: if (isSuperAdmin() || isAssetAdmin())
                && request.resource.data.categoryId is string
                && request.resource.data.statusId is string
                && isValidInventoryCode(request.resource.data.inventoryCode)
                && isValidAssetName(request.resource.data.name)
                && isAsciiOrNull(request.resource.data.brand)
                && isAsciiOrNull(request.resource.data.model)
                && isAsciiOrNull(request.resource.data.serialNumber)
                && (request.resource.data.branchId == null
                    || request.resource.data.branchId is string)
                && isValidAssignedTo(request.resource.data.assignedTo)
                && request.resource.data.isActive is bool
                && request.resource.data.createdBy == request.auth.uid
                && request.resource.data.updatedBy == request.auth.uid
                && request.resource.data.createdAt == request.time
                && request.resource.data.updatedAt == request.time;

  allow update: if (isSuperAdmin() || isAssetAdmin())
                && request.resource.data.categoryId == resource.data.categoryId      // category immutable
                && request.resource.data.inventoryCode == resource.data.inventoryCode // code immutable
                && request.resource.data.statusId is string
                && isValidAssetName(request.resource.data.name)
                && isAsciiOrNull(request.resource.data.brand)
                && isAsciiOrNull(request.resource.data.model)
                && isAsciiOrNull(request.resource.data.serialNumber)
                && (request.resource.data.branchId == null
                    || request.resource.data.branchId is string)
                && isValidAssignedTo(request.resource.data.assignedTo)
                && request.resource.data.isActive is bool
                && request.resource.data.createdBy == resource.data.createdBy
                && request.resource.data.createdAt == resource.data.createdAt
                && request.resource.data.updatedBy == request.auth.uid
                && request.resource.data.updatedAt == request.time;

  allow delete: if false;
}
```

Reasoning:
- Both create AND update accept the full doc shape — repository writes fully-formed docs (`tx.set` on create, `tx.update` on edit, but rules see the merged shape).
- `categoryId` and `inventoryCode` immutability is enforced by the rules so even a malicious client can't repaint an asset into another category.
- `statusId` is checked only as a `string` type — referential validity (status must exist + must not be a deleted status) is owned by the asset-status-catalog (already protected by its own rules block; an attacker writing a non-existent status string still produces a doc that will render with "—" but no privilege escalation).
- `branchId` is allowed null on update (asset moves to "with employee" or "with department" without a branch).

## UI plan

### `AssetListPage.jsx`
- Header: "Активы" + "Добавить актив" CTA (super_admin + asset_admin).
- Filter row: search box (matches `inventoryCode`, `name` localized, `brand`, `model`, `serialNumber`); category select (`useCategories`); status select (`useAssetStatuses`); branch select (`useBranches`).
- Disabled "Импорт" / "Экспорт" buttons with tooltip "Шаг 3" — render as ghost buttons with `disabled` and `title` attribute.
- Table columns:
  1. Inventory code (link to detail).
  2. Name (localized via `localize()` when multi-lang; raw string when not).
  3. Category (localized name from `categories` map).
  4. Brand.
  5. Model.
  6. Status (`<StatusBadge>` with the hex color).
  7. Куда — humanized: "Склад: Главный Офис", "Сотрудник: Иванов Иван", "Филиал: Зейтун", "Отдел: …" (i18n keys `holderWarehouse`, `holderEmployee`, etc).
- Empty state.

### `AssetDetailPage.jsx`
- Read-only summary card with all fields.
- Edit button → opens `<AssetFormDialog>` in edit mode.
- Status dropdown (separate card) — calls `firestoreAssetRepository.setStatus`.
- Audit-trail stub: a placeholder card with "Журнал истории — Шаг 4" (we already have `<HistoryTab>` from prior work; if it accepts an `entityId` filter, render it; if not, leave the stub).
- Back link to `/assets`.

### `AssetFormDialog.jsx`
Per user spec verbatim:

| Order | Field | Component | Notes |
|---|---|---|---|
| 1 | Категория | `<select>` over `useCategories` (active only) | Required. On change, refresh `name` field shape (multi-lang vs single). |
| 2 | Название | `<MultiLangInput>` if `selectedCategory.requiresMultilang`, else `<Input>` | Required. |
| 3 | Бренд | `<Input>` | Optional, ASCII-validated. |
| 4 | Модель | `<Input>` | Optional, ASCII-validated. |
| 5 | S/N | `<Input>` | Optional, ASCII-validated. |
| 6 | Куда | radio group: СКЛАД (default) / СОТРУДНИК / ФИЛИАЛ / ОТДЕЛ | On change, may need to clear `assignedTo.id` and `branchId`. |
|   | (when СКЛАД) | shows `<BranchSelect>` (required) | "Склад" mode means "asset is at warehouse X". Default = head office. |
|   | (when СОТРУДНИК) | `<EmployeeSelect>` (active only) | Required. |
|   | (when ФИЛИАЛ) | `<BranchSelect>` (active only) | Required. |
|   | (when ОТДЕЛ) | `<DepartmentSelect>` | Stub — disabled with "Отделы пока не настроены" helper text in Step 2. |
| 7 | Статус | `<select>` over `useAssetStatuses` filtered by Куда rule above | Required. Default = 'warehouse'. |
| 8 | Дополнительно | `<details>` collapsed: notes (textarea), purchaseDate, purchasePrice | Optional. |

Submit pipeline: `sanitizeAssetInput → validateAssetInput → onSubmit(sanitized)`. Catch `AssetInventoryCodeTakenError` → field error on category (defensive — extremely unlikely under transaction).

### `EmployeeSelect.jsx` (new, simple)
- Mirrors `BranchSelect` API: `{ value, onChange, disabled, includeNone? }`.
- Uses `useEmployees`; renders `formatEmployeeName` per option, ordered by lastName.
- Filters to active only.

### `DepartmentSelect.jsx` (new, stub)
- Renders a disabled `<select>` with one option: "Отделы пока не настроены — выберите другой режим".
- The form catches this state in validation: when Куда=ОТДЕЛ, error message renders inline.
- TODO comment: "Replace with departments hook once `/departments` lands."

## i18n keys

### `locales/ru/assets.json` (overwrite the minimal stub):

```json
{
  "title": "Активы",
  "subtitle": "Каталог корпоративного имущества",
  "addAsset": "Добавить актив",
  "editAsset": "Редактировать актив",
  "import": "Импорт",
  "export": "Экспорт",
  "importSoon": "Доступно с шага 3",
  "exportSoon": "Доступно с шага 3",
  "searchPlaceholder": "Поиск по коду, названию, бренду, модели, S/N",
  "filterByCategory": "Категория",
  "filterByStatus": "Статус",
  "filterByBranch": "Филиал",
  "filterAll": "Все",
  "emptyState": "Активов пока нет",
  "noResults": "Ничего не найдено",

  "inventoryCode": "Инвентарный номер",
  "name": "Наименование",
  "namePlural": "Наименование",
  "category": "Категория",
  "categoryPlaceholder": "Выберите категорию",
  "status": "Статус",
  "branch": "Филиал",
  "brand": "Бренд",
  "model": "Модель",
  "serialNumber": "Серийный номер",
  "imei": "IMEI",
  "purchaseDate": "Дата покупки",
  "purchasePrice": "Стоимость",
  "warrantyUntil": "Гарантия до",
  "notes": "Примечания",
  "more": "Дополнительно",

  "holder": "Куда",
  "holderWarehouse": "Склад",
  "holderEmployee": "Сотрудник",
  "holderBranch": "Филиал",
  "holderDepartment": "Отдел",
  "holderShortWarehouse": "Склад: {{name}}",
  "holderShortEmployee": "Сотрудник: {{name}}",
  "holderShortBranch": "Филиал: {{name}}",
  "holderShortDepartment": "Отдел: {{name}}",
  "departmentsComingSoon": "Отделы пока не настроены — выберите другой режим",

  "errorRequired": "Обязательное поле",
  "errorNameAllLocales": "Заполните все три языка или хотя бы один",
  "errorAsciiOnly": "Только латинские символы и цифры",
  "errorInventoryCodeTaken": "Инвентарный код уже занят",
  "errorCounterMissing": "Счётчик категории не инициализирован — обратитесь к администратору"
}
```

Translate to `en/assets.json` and `hy/assets.json` 1:1 (reasonable translations). Leave existing minimal RU stub fields if they conflict — the keys above are the union.

## Tests

### `assets.test.js`
- `sanitizeAssetInput`:
  - Plain-string `name` when category single-lang.
  - Locale-map `name` when multi-lang.
  - Brand/model/serialNumber trimmed; null when empty.
  - assignedTo defaults applied.
  - branchId nulled when assignedTo.kind in {'employee','department'}.
- `validateAssetInput`:
  - Missing categoryId → errorRequired.
  - Missing name → errorRequired.
  - Multi-lang partial → errorNameAllLocales (when every locale empty after sanitize, errorRequired wins).
  - Cyrillic brand → errorAsciiOnly.
  - assignedTo.kind invalid → errorRequired.
  - assignedTo.id missing for employee → errorRequired.
  - branchId missing when kind in {'warehouse','branch'} → errorRequired (only when category.requiresBranch is implied by rule).
- `formatInventoryCode('400', 7) === '400/7'` (no zero-pad).
- `nameForDisplay` with both shapes.

### `firestoreAssetRepository.test.js`
- Mock `runTransaction` like `firestoreCategoryRepository.test.js`. Make `tx.get` return:
  - For `categories/{id}`: `{ exists: true, data: () => ({ inventoryCodePrefix: '400', isActive: true }) }`.
  - For `category_counters/{id}`: `{ exists: true, data: () => ({ next: 5 }) }`.
- Assert `createAsset` produces:
  - Counter update with `next: 6`.
  - Asset doc with `inventoryCode: '400/5'`.
  - Audit set with `entity: 'asset'`, `action: 'create'`, after blob containing inventoryCode.
- Assert "concurrent" behavior: run two `createAsset` calls back-to-back with the same mocked counter snapshots increasing the counter; verify each produces a distinct inventoryCode given monotonic counter responses.
- Assert `setAssetStatus` writes status_change action with from/to in meta.
- Assert `updateAsset` does NOT include `inventoryCode` or `categoryId` in the update payload.
- Assert missing-actor / missing-before guards throw.

### `AssetFormDialog.test.jsx`
- Mock `useCategories`, `useAssetStatuses`, `useBranches`, `useEmployees` like the EmployeeFormDialog test.
- Cases:
  - Renders with default Куда=СКЛАД, default status=warehouse.
  - Selecting a multi-lang category swaps name from `<input>` to `<MultiLangInput>`.
  - Selecting a single-lang category swaps back to a plain `<input>`.
  - Куда=СОТРУДНИК hides BranchSelect; shows EmployeeSelect.
  - Куда=ОТДЕЛ shows DepartmentSelect with empty-state helper text.
  - Required validation fires when name empty and categoryId empty.
  - Status filter: Куда=СКЛАД shows only `isAssignable===false` statuses; Куда=СОТРУДНИК shows only `isAssignable===true`.
  - Submit success calls onSubmit with sanitized payload; the dialog closes.

### `assets.rulesMirror.test.js`
- Mirror the rules predicates (matching the `categories.rulesMirror.test.js` pattern).
- Test matrix:
  - Read: super/asset/tech allow; employee deny.
  - Create: super/asset allow with valid shape; tech/employee deny.
  - Create with invalid `assignedTo` (extra keys, missing id when kind=employee, etc.) → deny.
  - Create with non-ASCII brand → deny.
  - Create with bad inventoryCode shape ("450/abc", "450/", "/123") → deny.
  - Update: changing inventoryCode → deny.
  - Update: changing categoryId → deny.
  - Update: same-shape update by asset_admin → allow.
  - Update by tech_admin → deny.
  - Delete: every role denied.

## Routing

`src/config/routes.js` add:
```js
ASSETS: '/assets',
ASSET_DETAIL: '/assets/:assetId',
```
plus `assetDetailPath(id)` helper, plus ROUTE_TABLE entries with `allowedRoles: [SUPER_ADMIN, ASSET_ADMIN, TECH_ADMIN]` for both routes (Tech Admin reads the registry per spec).

`src/App.jsx` add two `<Route>` blocks inside the AppShell subtree, both wrapped in `<RoleGate roles={[SUPER_ADMIN, ASSET_ADMIN, TECH_ADMIN]}>`. The "Add asset" / "Edit" buttons are gated additionally to super+asset within the page itself.

## Verification

1. `npm test -- --run` — all suites pass, including 4 new ones.
2. `npm run build` — clean.
3. Manual verification checklist:
   - Sign in as super_admin (zahalyanxcho@gmail.com). On dashboard load, the new bootstrap fires and `asset_statuses` + `categories` collections populate (5 + 3 docs).
   - Refresh — bootstrap is a no-op (idempotent).
   - Navigate to `/assets`. Empty state visible.
   - Click "Добавить актив". Pick category "Устройство" (single-lang) — `name` is a plain input. Pick "Мебель" — three-locale inputs.
   - Submit with Куда=СКЛАД, branch = Главный Офис. Asset appears in list with inventory code `400/1`.
   - Create another with same category — `400/2` (counter increments).
   - Switch Куда=СОТРУДНИК in the form. Status dropdown filters to only Assigned (the one with `isAssignable===true`).
   - Click an asset → detail page renders all fields.

## Operational notes for the user (post-implementation)

After this work lands, the user will need to deploy rules ONE TIME to pick
up Step 1 (`/asset_statuses` + `/categories` blocks already in
firestore.rules from prior work) AND Step 2 (`/assets` block from this
plan). Single command:

```
npx firebase deploy --only firestore:rules
```

Until that runs, the app will work locally (read-only) but writes against
a deployed project that hasn't received the new rules will fail.

## Rollback

- Revert: drop the new files; revert firestore.rules edits; revert App.jsx + routes.js + AppShell.jsx + locales.
- Data: `assets`, `category_counters` are append-only. If the bootstrap ran in production, the seed docs are idempotent — leaving them is safe.
