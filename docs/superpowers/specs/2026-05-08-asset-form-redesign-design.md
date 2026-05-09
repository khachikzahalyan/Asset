# Asset Form Redesign — Brands, Models, Progressive Disclosure, License Specifics

**Phase:** 1.5 (extension of MVP)
**Status:** spec
**Date:** 2026-05-08
**Owner agents:** domain-modeler, firebase-engineer, react-ui-engineer, i18n-engineer
**Spec references:**
- Extends `docs/superpowers/specs/2026-05-08-configurable-asset-holder-rules-design.md`.
- Builds on `docs/features/asset-registry.md`, `docs/features/asset-categories.md`.

---

## 1. Purpose & user value

The current asset-creation form treats every category the same way: one flat list of fields, free-text Brand and Model strings typed by hand each time, a redundant "Name" field for Devices and Licenses, and a Serial Number field that doubles as a license key — with no protection around the key. Operators repeatedly type "HP" / "EliteBook 840 G6" by hand with typos, see a meaningless "Name" field on top of Brand+Model, and Asset Admins can read license keys they shouldn't touch.

We are redesigning the form so that:

- Brand and Model become **typed catalogs** managed by the Super Admin.
- The form **discloses fields progressively** in five logical groups, with a final preview step before commit.
- The "Name" field disappears for Devices and Licenses; the asset's display title is composed from `Subtype · Brand · Model`. Furniture keeps a multi-lang Name because there is no brand/model convention there.
- **License** is treated as a first-class asset variant: dedicated fields (`licenseType`, `subscribedAt`, `expiresAt`, `licenseKey`), no inventory code, an admin-tunable expiry warning threshold, and **license keys never leave a hardened sub-collection** — Asset Admins literally cannot read them.

The North-Star outcome: a Super Admin can configure Brands and Models once, an Asset Admin creates an asset by picking from dropdowns and confirming a preview, and a license key is visible to exactly two roles (Super Admin and Tech Admin) and to no one else, ever — including in audit logs.

---

## 2. Locked decisions

### 2.1 Brand and Model become catalog collections

| Collection | Doc id | Fields |
|---|---|---|
| `brands` | auto | `name: string` (Tier 4, free-form, English-preferred but no enforcement), `isActive: boolean`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`. |
| `models` | auto | `brandId: string` (FK → `brands`), `name: string` (Tier 4), `isActive: boolean`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`. |

- Both are managed in the Settings area by Super Admin only (analogous to `SubtypeManagementPage`).
- A model has exactly one parent brand. Deleting a brand is blocked while it has any active model OR any asset references it (same pattern as `CategoryInUseError` in `src/domain/categories.js`).
- Soft-delete via `isActive: false`; hard-delete forbidden by rules.
- No multi-language fields. Brand and Model are Tier 4.

### 2.2 Asset schema — Brand and Model become FKs

In `src/domain/assets.js`:

- `assets.brand: string|null` → **`assets.brandId: string|null`** (FK to `brands`).
- `assets.model: string|null` → **`assets.modelId: string|null`** (FK to `models`).
- Validation: if `modelId` is set, `brandId` must be set, and the model must belong to that brand. Validation is enforced in `validateAssetInput()` AND in `firestore.rules` via a `get()` lookup on the model doc (deferred to firebase-engineer; see §6.4 — pure rule check is "if both present, both are non-empty strings"; cross-doc consistency is enforced by the form, the repository sanitizer, and a Cloud-Function audit trigger sweep — *not* in rules, because rules-side `get()` per write is expensive and the form already constrains the choice).
- Existing string fields `brand`, `model` are **dropped** from the schema. Migration: see §7.

### 2.3 Categories gain `assignsInventoryCode`

In `src/domain/categories.js`:

- New field `Category.assignsInventoryCode: boolean`. Default `true`. The seeded `license` category has `assignsInventoryCode: false`.
- When `assignsInventoryCode === false`, the form does NOT call `category_counters` and does NOT compute / show an inventory code preview. The asset doc is written with `inventoryCode: null`.
- Firestore rules update: `isValidInventoryCode(value)` must accept `null` when the category's `assignsInventoryCode` flag is false. Because rules cannot cheaply read the category doc, the rule is loosened to `inventoryCode == null || isValidInventoryCode(inventoryCode)`; the form and repository enforce the right shape per category.

### 2.4 Asset name is conditional

`assets.name` shape:
- For categories where `requiresMultilang === true` (Furniture today): a multi-lang `{ ru, en, hy }` map, edited via `<MultiLangInput>`, required.
- For categories where `requiresMultilang === false` (Device, License today): the field is **removed from the form**. Stored value is `null`.

`validateAssetInput` is updated:
- When `category.requiresMultilang === true`: `name` must be a non-empty multi-lang map (at least one locale must have content).
- When `category.requiresMultilang === false`: `name` must be `null`.

The asset's **displayed title** is computed by a new helper `formatAssetTitle(asset, { brand, model, subtype }, locale)`:
- If `requiresMultilang` (Furniture): `localize(asset.name, locale)`.
- Otherwise: `[subtype.name, brand.name, model.name].filter(Boolean).join(' · ')`.

### 2.5 Asset-create form — progressive disclosure, 5 groups

All groups live in the same `AssetFormDialog`. Groups appear top-to-bottom in this order; later groups appear only after enough of the earlier groups is filled to make them meaningful (the dialog stays scrollable — we do NOT use a multi-step wizard).

| # | Group | Fields | Visibility rule |
|---|---|---|---|
| 1 | What is it? | Category → Subtype → Brand → Model | Always visible. Subtype unlocks after Category. Brand and Model appear after Category; Model is `disabled` until Brand is chosen. Brand and Model are **hidden entirely** when the chosen category has `requiresMultilang === true` (Furniture). |
| 2 | Identifiers | Inventory-code preview (read-only), Serial number (`serialNumber`, ASCII), Name (Furniture only — `<MultiLangInput>`) | Group appears once Group 1 has Category and Subtype. Inventory-code preview appears only when `category.assignsInventoryCode === true`. License-key field is **NOT here** — see Group 6. |
| 3 | Where is it? | Branch (location), Assigned-to picker (`assignedTo` discriminated union, kinds filtered by subtype's `attachableTo`) | Visible after Group 1. Same logic as today; no behavior change. |
| 4 | Money & warranty | Purchase date, Purchase price + currency, Warranty start, Warranty end, Condition (new/used) | Collapsed inside an `<Accordion>` labelled "Дополнительно". Open by default for `condition` (already required). |
| 5 | Notes | `notes` textarea | Always at the bottom. |
| 6 | License-only block | `licenseType` (radio: personal / business / enterprise), `subscribedAt`, `expiresAt`, License key (super_admin & tech_admin only) | Appears between Group 2 and Group 3, **only when `categoryId === 'license'`**. License key sub-field hidden completely for asset_admin. |

### 2.6 Preview-modal step — create only

After the operator clicks the primary "Далее" button at the bottom of the form, a dedicated `AssetCreatePreviewDialog` opens with:
- The composed title (`formatAssetTitle`).
- Inventory code (or "—" if not assigned).
- Subtype, Brand, Model rows (Subtype only for Furniture; Brand/Model rows for Device/License).
- License-specific summary rows (`Тип лицензии`, `Дата подписки`, `Дата окончания`, `Ключ лицензии: введён / не введён` — never the value).
- Holder summary (kind + resolved entity name).
- Branch, Condition, Warranty window, Purchase price.
- Buttons: **Назад** (return to the form, state preserved) and **Создать** (commit).

The preview step is **only for create**, not for edit. Edit dialog uses the same form layout but submits directly without a preview.

### 2.7 License-specific schema

When `categoryId === 'license'`, the asset doc carries:

| Field | Type | Notes |
|---|---|---|
| `licenseType` | `'personal' \| 'business' \| 'enterprise'` | Required for licenses. Validated in domain & rules. |
| `subscribedAt` | `Timestamp` | Required. Tier 4. Day-precision in UI; stored as `Timestamp`. |
| `expiresAt` | `Timestamp` | Required. Validation: `expiresAt > subscribedAt`. |
| `inventoryCode` | `null` | Consequence of `assignsInventoryCode === false` on the `license` category, not a license-specific rule. Devices keep `inventoryCode` because their category has the flag `true`. |
| `name` | `null` | Consequence of `requiresMultilang === false` on the `license` category, same reasoning. Furniture keeps the multi-lang `name`. |

License key lives **NOT on the asset doc** but in a sub-collection — see §2.8.

### 2.8 License key — hardened sub-collection `assets/{assetId}/secrets/key`

| Aspect | Decision |
|---|---|
| Location | `/assets/{assetId}/secrets/key` (single document with fixed id `key`). |
| Shape | `{ value: string, updatedAt: Timestamp, updatedBy: string }` |
| Read | super_admin OR tech_admin only. |
| Write (create + update) | super_admin OR tech_admin only. |
| Delete | Forbidden (`allow delete: if false`). |
| Repository | New `firestoreLicenseSecretRepository.js` exposing `getLicenseKey(assetId)`, `setLicenseKey(assetId, value)`. Method `setLicenseKey` writes the secret AND triggers `withAudit` for the asset, but the audit entry NEVER contains the key value (see audit rule below). |
| UI surface | In `AssetFormDialog` License block: `<LicenseKeyField>` shows `•••••` masked input by default; "Показать" / "Скрыть" toggle; "Копировать" button (uses `navigator.clipboard.writeText` from in-memory state, never re-fetches). For asset_admin the field is **completely absent** — no placeholder, no "you don't have permission" hint, just nothing. |
| In list / detail views | Never rendered. AssetDetailPage shows an action button "Управлять ключом" (super_admin / tech_admin only) that opens a small dialog `LicenseKeyDialog`. |
| Audit | The audit-helper writes `{ entityType: 'asset', entityId, action: 'license_key_changed' }` with `before/after` set to `{ licenseKeySet: true/false }` ONLY (no value, no length, no hash). A cross-cutting unit test asserts no audit log under any circumstance contains a key value. |
| Logging / errors | `firestoreLicenseSecretRepository` MUST NOT include the key value in any thrown error message or `console.*` call. ESLint rule (manual review) enforced. |

### 2.9 Global setting: license expiry warning threshold

New singleton-style document at `/settings/notifications` with:

```jsonc
{
  "licenseExpiryWarningDays": 30,   // integer 1..365, default 30
  "updatedAt": Timestamp,
  "updatedBy": string                // uid of last super_admin to change it
}
```

- Read: any signed-in admin (needed for badge rendering on asset pages).
- Write: super_admin only.
- Managed in a new Settings sub-page `/settings/notifications` (route + page component `NotificationSettingsPage.jsx`).
- Used in Phase 1 to render a UI badge on each license asset:
  - `Истекает через N дней` when `expiresAt - now ≤ licenseExpiryWarningDays days` and `> 0`.
  - `Истекла N дней назад` when `expiresAt < now`.
  - Hidden otherwise.
- **Phase 2 reuse:** the same threshold drives email notifications. NOT in scope for this redesign.

### 2.10 Categories form — surface the new flag

`CategoryFormDialog` gets a single new checkbox:

> ☐ Этой категории присваивается инвентарный код

Default `true` for new categories. For the seeded `license` category the seeder writes `assignsInventoryCode: false` and the checkbox is read-only when the category's id is in the system-seed set (the same way `requiresMultilang` already behaves for seed rows — no change to the lock logic, just an extra field).

---

## 3. Architectural choices & rationale

**Brand/Model as separate collections, not arrays on Category.** Two reasons: (a) brands span categories (HP makes laptops AND printers) so embedding under a category creates duplicates; (b) models are scoped to a brand and have lifecycle of their own (active/inactive, future "discontinued" flag) — they earn document status. We pay one extra Firestore read per asset on the detail page, which is fine.

**Single document `secrets/key`, not many small docs.** A license has exactly one current key; rotating it overwrites the same doc. We deliberately do NOT keep a key-history sub-collection — past keys are a liability, not an asset, and rules forbid delete to keep the immutability we DO want (the *current* key cannot be erased; it can only be replaced).

**License key NEVER in the asset document, NEVER in audit logs, NEVER in logs.** Three protective layers: (1) Firestore rules block the read for non-privileged roles at `/assets/{aid}/secrets/{any}`; (2) `withAudit` sees a sanitised diff that excludes the key; (3) the repository code that touches the key has a hard rule (covered by a unit test) of never passing the value to `console`, `Error.message`, or any helper that could surface it. Defense in depth.

**No `/licenses` collection.** Licenses are assets. Treating them as a separate top-level collection would fork half of the asset machinery (assignment, audit, status, branch placement). The cost of category-conditional fields on assets is much smaller than the cost of two parallel hierarchies.

**Preview only on create.** The preview's value is "did I pick the right thing before I write it" — a one-shot pre-flight. On edit, the operator already sees the entity in context (they navigated to it on purpose). Adding a preview to edit would just slow them down.

**Progressive disclosure inside one dialog, not a wizard.** Power users on desktop should be able to tab through fields fast. A multi-step wizard adds clicks and breaks keyboard flow. We hide irrelevant groups until they make sense, but everything that IS relevant is visible at once.

---

## 4. Data shapes

### 4.1 Brand

```jsdoc
/**
 * @typedef {Object} Brand
 * @property {string} brandId          // mirrors doc id
 * @property {string} name             // Tier 4
 * @property {boolean} isActive
 * @property {Timestamp} createdAt
 * @property {string} createdBy
 * @property {Timestamp} updatedAt
 * @property {string} updatedBy
 */

/**
 * @typedef {Object} BrandInput
 * @property {string} name
 * @property {boolean} [isActive]
 */
```

### 4.2 Model

```jsdoc
/**
 * @typedef {Object} Model
 * @property {string} modelId          // mirrors doc id
 * @property {string} brandId          // FK -> brands
 * @property {string} name             // Tier 4
 * @property {boolean} isActive
 * @property {Timestamp} createdAt
 * @property {string} createdBy
 * @property {Timestamp} updatedAt
 * @property {string} updatedBy
 */

/**
 * @typedef {Object} ModelInput
 * @property {string} brandId
 * @property {string} name
 * @property {boolean} [isActive]
 */
```

### 4.3 Asset (delta)

```jsdoc
/**
 * @typedef {Object} Asset
 * // ... existing fields ...
 * @property {string|null} brandId                  // CHANGED: was `brand: string|null`. Always null for categories where requiresMultilang === true (Furniture).
 * @property {string|null} modelId                  // CHANGED: was `model: string|null`. Always null when brandId is null. If non-null, the model's brandId must equal asset.brandId.
 * @property {AssetName | null} name                // RESHAPED: null when category.requiresMultilang === false
 * @property {string|null} inventoryCode            // RESHAPED: null when category.assignsInventoryCode === false
 *
 * // License-only fields (present only when categoryId === 'license'):
 * @property {'personal'|'business'|'enterprise'|null} licenseType
 * @property {Timestamp|null} subscribedAt
 * @property {Timestamp|null} expiresAt
 */
```

### 4.4 Category (delta)

```jsdoc
/**
 * @typedef {Object} Category
 * // ... existing fields ...
 * @property {boolean} assignsInventoryCode         // NEW. default true. license seed = false.
 */
```

### 4.5 LicenseSecret (sub-collection doc)

```jsdoc
/**
 * @typedef {Object} LicenseSecret
 * @property {string} value             // the actual key. never logged, never audited.
 * @property {Timestamp} updatedAt
 * @property {string} updatedBy         // uid
 */
```

### 4.6 NotificationSettings

```jsdoc
/**
 * @typedef {Object} NotificationSettings
 * @property {number} licenseExpiryWarningDays      // integer 1..365
 * @property {Timestamp} updatedAt
 * @property {string} updatedBy
 */
```

---

## 5. UX flows

### 5.1 Create asset (Device example)

1. Operator opens `AssetFormDialog`. Group 1 visible. Category dropdown enabled.
2. Picks Category = Device. Subtype dropdown becomes enabled and lists subtypes for Device. Brand and Model dropdowns appear (because `requiresMultilang === false`).
3. Picks Subtype = Laptop. Group 2 (Identifiers) appears. Inventory-code preview shows the next allocated code from `category_counters/device`.
4. Picks Brand = HP. Model dropdown enables.
5. Picks Model = EliteBook 840 G6. Group 3 (Where) visible. Operator picks Branch and Assigned-to (kind filtered by subtype's `attachableTo`).
6. Operator opens "Дополнительно" accordion to set warranty / price.
7. Clicks **Далее**. `AssetCreatePreviewDialog` opens with composed title `Laptop · HP · EliteBook 840 G6`, inventory code, holder, branch, warranty.
8. Clicks **Создать**. Asset is committed (transactional inventory-code allocation + audit log).

### 5.2 Create asset (License example)

1. Same as above through Category = License.
2. Subtype dropdown lists license subtypes (e.g. "Annual Subscription"). Brand and Model dropdowns appear.
3. Group 2 appears with Serial-number field but NO inventory-code preview (because `assignsInventoryCode === false`).
4. Group 6 (License-only block) appears with: Тип лицензии (radio), Дата подписки, Дата окончания, Ключ лицензии (only if super_admin / tech_admin).
5. Group 3 (Where) appears.
6. Click **Далее** → preview shows License-specific rows including "Ключ лицензии: введён" (if non-empty), never the value.
7. **Создать** writes the asset doc AND, in the same logical transaction, writes the secret doc (separate Firestore write because sub-collection writes can't be batched into the parent's create — implementation detail: two writes inside a single `runTransaction`, with the secret write conditional on `licenseKey` being non-empty).

### 5.3 Asset Admin viewing a license

- Opens `AssetDetailPage` for a license asset.
- Sees Type, Subscribed-At, Expires-At, expiry-warning badge.
- Does NOT see "Управлять ключом" button.
- A direct Firestore probe at `/assets/X/secrets/key` returns permission-denied. Tested.

---

## 6. Files affected

### 6.1 New files

| Path | Purpose |
|---|---|
| `src/domain/brands.js` | `Brand` typedef, `emptyBrandInput`, `sanitizeBrandInput`, `validateBrandInput`, `BrandIdConflictError`, `BrandInUseError`. |
| `src/domain/models.js` | `Model` typedef, `emptyModelInput`, `sanitizeModelInput`, `validateModelInput`, `ModelIdConflictError`, `ModelInUseError`. |
| `src/domain/notificationSettings.js` | `NotificationSettings` typedef, `sanitize` + `validate` (range 1..365). |
| `src/domain/licenseSecrets.js` | `LicenseSecret` typedef, `sanitize` (no validation of value content beyond non-empty + length cap, e.g. ≤ 4096 chars). |
| `src/infra/repositories/firestoreBrandRepository.js` | CRUD against `/brands`. |
| `src/infra/repositories/firestoreModelRepository.js` | CRUD against `/models`. With a query helper `byBrand(brandId)`. |
| `src/infra/repositories/firestoreLicenseSecretRepository.js` | get/set against `/assets/{assetId}/secrets/key`. NEVER returns the value in error paths. Calls `withAudit` with sanitized diff `{ licenseKeySet: bool }`. |
| `src/infra/repositories/firestoreNotificationSettingsRepository.js` | get/set against `/settings/notifications`. |
| `src/components/features/brands/BrandFormDialog.jsx` | Super Admin CRUD. |
| `src/components/features/brands/BrandsManagementPage.jsx` (or page in `src/pages/`) | List + edit brands. |
| `src/components/features/models/ModelFormDialog.jsx` | Super Admin CRUD. |
| `src/components/features/models/ModelsManagementPage.jsx` (or page in `src/pages/`) | List + edit models. Filtered by brand. |
| `src/components/features/assets/BrandSelect.jsx` | Dropdown of active brands. Emits `brandId`. |
| `src/components/features/assets/ModelSelect.jsx` | Dropdown of active models for a given brand. Emits `modelId`. Disabled when no brand. |
| `src/components/features/assets/LicenseTypeRadio.jsx` | Radio over `LICENSE_TYPES`. |
| `src/components/features/assets/LicenseKeyField.jsx` | Masked input with show/hide + copy. Hidden for non-privileged roles. |
| `src/components/features/assets/LicenseKeyDialog.jsx` | Dedicated dialog for "Управлять ключом" on the AssetDetailPage. |
| `src/components/features/assets/AssetCreatePreviewDialog.jsx` | The preview-and-confirm step. |
| `src/components/features/assets/LicenseExpiryBadge.jsx` | Reads `/settings/notifications.licenseExpiryWarningDays` via a hook; renders the warning. |
| `src/components/features/settings/NotificationSettingsPage.jsx` (page in `src/pages/`) | Super-admin form for `licenseExpiryWarningDays`. |
| `src/hooks/useBrands.js`, `src/hooks/useModels.js`, `src/hooks/useNotificationSettings.js` | Reactive hooks. |
| `src/hooks/useLicenseSecret.js` | Imperative `get/set`. NOT a real-time hook (we don't want live-streaming the key). |
| `src/lib/asset/formatAssetTitle.js` | Pure helper. |
| `src/locales/{ru,en,hy}/brands.json` | New namespace. |
| `src/locales/{ru,en,hy}/models.json` | New namespace. |
| `src/locales/{ru,en,hy}/licenses.json` | New namespace, license-specific UI. |
| Tests for each of the above (co-located `.test.jsx` / `.test.js`). |

### 6.2 Modified files

| Path | Change |
|---|---|
| `src/domain/assets.js` | Replace `brand`/`model` with `brandId`/`modelId`; add `licenseType`, `subscribedAt`, `expiresAt`; reshape `name` to allow null; reshape `inventoryCode` to allow null; update `validateAssetInput` to consult `category.requiresMultilang` AND `category.assignsInventoryCode` AND `category.id === 'license'`. Drop ASCII validation on `brand`/`model` (now FKs, not strings). |
| `src/domain/categories.js` | Add `assignsInventoryCode: boolean` to typedefs, `sanitizeCategoryInput`, default seed values. |
| `src/infra/repositories/firestoreAssetRepository.js` | Read/write the new fields. Skip inventory-code allocation when `category.assignsInventoryCode === false`. When the form passes a `licenseKey`, the repository calls `firestoreLicenseSecretRepository.setLicenseKey` inside the same `runTransaction`. |
| `src/infra/repositories/firestoreCategoryRepository.js` | Persist `assignsInventoryCode`. Seed `license` category with `false`. |
| `src/components/features/assets/AssetFormDialog.jsx` | Major rewrite for progressive disclosure + 5 groups + license block + role-gated license-key sub-field. NO inventory-code preview when `assignsInventoryCode === false`. NO Name field when `requiresMultilang === false`. |
| `src/components/features/assets/AssetSelect.jsx` and `StatusBadge.jsx` | Switch any `asset.brand` / `asset.model` reads to lookups via the new `useBrands` / `useModels` hooks. |
| `src/components/features/categories/CategoryFormDialog.jsx` | Add the `assignsInventoryCode` checkbox. |
| `src/pages/AssetListPage.jsx` and `AssetDetailPage.jsx` | Use `formatAssetTitle` for the displayed title. License pages: render `LicenseExpiryBadge` and the "Управлять ключом" action. |
| `src/pages/SubtypeManagementPage.jsx` | No code change in scope; cited because the new Brand/Model management pages mirror its structure. |
| `firestore.rules` | Add rule blocks for `/brands`, `/models`, `/assets/{aid}/secrets/{any}`, `/settings/notifications`. Update `/assets/{assetId}` validators (`brandId`/`modelId`/`inventoryCode`/`name` shape, license fields). |
| `src/i18n/namespaces.js` | Register `brands`, `models`, `licenses` namespaces. |
| `src/locales/{ru,en,hy}/assets.json` | New keys for the redesigned form (group titles, license fields, preview labels). |
| `src/locales/{ru,en,hy}/settings.json` | Keys for the notification-settings page. |
| `src/locales/{ru,en,hy}/categories.json` | Key for the new `assignsInventoryCode` checkbox. |
| `src/lib/audit/withAudit.js` (or wherever audit-diff is sanitized) | New helper `sanitizeLicenseKeyDiff` that strips any `licenseKey`/`secrets.key` field path before the diff is written. Unit-tested. |
| `src/components/routing/AppRouter.jsx` | New routes: `/settings/brands`, `/settings/models`, `/settings/notifications`. All super-admin gated. |
| `src/config/navItems.js` | Add nav entries for the new Settings sub-pages. |

### 6.3 Removed fields / files

- `assets.brand: string` and `assets.model: string` — removed from the schema. Their ASCII validators in `src/domain/assets.js` and `firestore.rules` are deleted.
- No file deletions.

### 6.4 Firestore rules — concrete additions

```text
match /brands/{brandId} {
  allow read:   if isAdmin();
  allow create: if isSuperAdmin()
                && request.resource.data.name is string
                && request.resource.data.name.size() > 0
                && request.resource.data.isActive is bool
                && request.resource.data.createdBy == request.auth.uid
                && request.resource.data.createdAt == request.time;
  allow update: if isSuperAdmin()
                && request.resource.data.diff(resource.data).affectedKeys()
                   .hasOnly(['name', 'isActive', 'updatedAt', 'updatedBy']);
  allow delete: if false;
}

match /models/{modelId} {
  allow read:   if isAdmin();
  allow create: if isSuperAdmin()
                && request.resource.data.brandId is string
                && request.resource.data.brandId.size() > 0
                && request.resource.data.name is string
                && request.resource.data.name.size() > 0
                && request.resource.data.isActive is bool
                && exists(/databases/$(database)/documents/brands/$(request.resource.data.brandId));
  allow update: if isSuperAdmin()
                && request.resource.data.diff(resource.data).affectedKeys()
                   .hasOnly(['name', 'isActive', 'updatedAt', 'updatedBy']);
  allow delete: if false;
}

match /assets/{assetId}/secrets/{secretId} {
  allow read:   if isSuperAdmin() || isTechAdmin();
  allow create: if (isSuperAdmin() || isTechAdmin())
                && secretId == 'key'
                && request.resource.data.value is string
                && request.resource.data.value.size() > 0
                && request.resource.data.value.size() <= 4096
                && request.resource.data.updatedBy == request.auth.uid
                && request.resource.data.updatedAt == request.time;
  allow update: if (isSuperAdmin() || isTechAdmin())
                && request.resource.data.diff(resource.data).affectedKeys()
                   .hasOnly(['value', 'updatedAt', 'updatedBy']);
  allow delete: if false;
}

match /settings/notifications {
  allow read:   if isAdmin();
  allow write:  if isSuperAdmin()
                && request.resource.data.licenseExpiryWarningDays is int
                && request.resource.data.licenseExpiryWarningDays >= 1
                && request.resource.data.licenseExpiryWarningDays <= 365
                && request.resource.data.updatedBy == request.auth.uid
                && request.resource.data.updatedAt == request.time;
}
```

Updates to the existing `/assets/{assetId}` block:
- `inventoryCode == null || isValidInventoryCode(inventoryCode)`.
- Replace `isAsciiOrNull(brand)` / `isAsciiOrNull(model)` with `(brandId == null || brandId is string) && (modelId == null || modelId is string)`.
- `name` validator updated to accept `null` as well as the existing multi-lang shape.
- New license-conditional validators: when `categoryId == 'license'`, `licenseType` must be one of the three enum values, `subscribedAt` and `expiresAt` must be timestamps, `expiresAt > subscribedAt`. (Conditional rules expressed via ternary `categoryId == 'license' ? <license-checks> : (licenseType == null && subscribedAt == null && expiresAt == null)`.)

---

## 7. Migration

Per user note: existing data is sparse. Migration is **not a runtime data-fix script**; it is a one-time manual reset, treated as part of initial setup.

| Concern | Approach |
|---|---|
| Existing `assets.brand: string` / `assets.model: string` values | Left in place at the doc level (Firestore doesn't error on unknown fields), but ignored by the new repository / domain readers. Operator clears them on next edit. |
| Form / domain | Reads `brandId` / `modelId` only. Old string fields are not surfaced. |
| Categories without `assignsInventoryCode` | Repository read defaults missing field to `true`. Seeder is updated so a fresh install gets `assignsInventoryCode: false` on `license` and `true` on the others. The `license` category, if already seeded, is patched in-place by the bootstrapper (`StatusesAndCategoriesBootstrap`) on next super-admin sign-in. |
| Category `name` storage | Unchanged. |
| Asset `name` for Device/License with existing data | Sanitizer at write time normalizes `name` to `null` whenever the category is non-multilang. On read, downstream `formatAssetTitle` ignores `name` for non-Furniture categories, so legacy values are silently inert. |

No write-side migration script is shipped. If the operator wants to scrub legacy `brand`/`model` strings from old docs, that is a Phase-2 import/export task.

---

## 8. Acceptance criteria

A reviewer signs this redesign off only when ALL of the following hold:

1. **Brands and Models exist as catalog collections.** Super Admin can create, soft-deactivate, and rename brands and models from the new Settings pages. Asset form dropdowns read from these collections.
2. **`assets.brand` / `assets.model` are gone from the schema** in `src/domain/assets.js`, `firestore.rules`, and the asset repository. New fields `assets.brandId` / `assets.modelId` are populated on every newly-created Device/License asset.
3. **Category gains `assignsInventoryCode`.** The `license` category is seeded with `false`. The category form exposes a checkbox.
4. **No "Name" field is shown for Device / License in the asset form.** `formatAssetTitle` produces `Subtype · Brand · Model` for those; produces multi-lang Name for Furniture.
5. **Form is progressively disclosed.** Group 1 → Group 2 (after Subtype) → Group 6 (only for License) → Group 3 → Group 4 (collapsed) → Group 5. Brand visible only for non-multi-lang categories. Model dropdown disabled until Brand chosen.
6. **Preview-modal step works on create only.** `AssetCreatePreviewDialog` shows the composed title, holder, license-summary rows (without the key value), and a Назад / Создать pair. Edit dialog skips the preview.
7. **License block is fully functional.** `licenseType` radio with three options, `subscribedAt` and `expiresAt` date fields with `expiresAt > subscribedAt` validation, `LicenseKeyField` rendered only for super_admin / tech_admin.
8. **License key is hardened.** A Firestore rules unit test confirms an asset_admin and an employee both get `permission-denied` when reading `/assets/X/secrets/key`. Super_admin and tech_admin succeed. Audit-helper test confirms no `audit_logs` entry contains the key value, regardless of code path.
9. **Global setting works.** `/settings/notifications` doc exists with `licenseExpiryWarningDays`. `NotificationSettingsPage` lets the super_admin change it. Range-validation 1..365. `LicenseExpiryBadge` reads the value live and renders correctly for past, soon-expiring, and far-future expiry dates.
10. **i18n complete.** Every new UI string has keys in `ru`, `en`, `hy` namespaces. No hardcoded Russian strings in JSX.
11. **Firestore rules pass `@firebase/rules-unit-testing` against the emulator** for: brand CRUD, model CRUD, license-secret read denials, license-secret successful read for super_admin / tech_admin, notification-settings range validation.
12. **`npm run build` and `npm test -- --run` pass cleanly.** No new warnings.
13. **Audit log integrity:** every state-changing write goes through `withAudit`, including license-key set/update, but the entry never contains the key string.
14. **No regression** in the existing flows out of scope (assignment events, employee CRUD, /me page, Storage, asset import/export remain unchanged).

---

## 9. Out of scope

The following are deliberately deferred:

- **Email notifications for expiring licenses** (Phase 2). This redesign establishes the threshold setting but only renders an in-app badge in Phase 1.
- **Scheduled Cloud Function** that scans for soon-to-expire licenses. Phase 2.
- **Separate `/licenses` collection.** Licenses stay under `/assets`; this is a deliberate design decision per §3.
- **Brand or Model import/export.** Operators add brands/models manually for now. Phase 2 for bulk.
- **License-key rotation history.** We keep only the current key. Past keys are intentionally not retained.
- **Issue-and-return flow changes.** Existing assignment-event machinery is unchanged. License assignment uses the same `assignedTo` discriminated union (already supports `kind: 'asset'` for "license attached to a parent device").
- **Asset Admin / Tech Admin separate task lists.** Their dashboards are not touched by this redesign.
- **Storage uploads.** Acts-of-acceptance scans / license PDFs remain a Phase 2 concern.
- **Phase 2 dynamic per-category attributes.** Brand / Model are first-class fields, not dynamic attributes.
- **Renaming or splitting the `license` seed category.** It stays a single category; sub-types under it carry the variant (Annual, Perpetual, etc.).

---

## 10. Open questions

None blocking. The user has confirmed:
- Two dates per license (`subscribedAt`, `expiresAt`).
- Super-admin-tunable expiry threshold via `/settings/notifications.licenseExpiryWarningDays`, default 30, range 1..365.
- License key never visible to Asset Admin, hidden in `/assets/{aid}/secrets/key`.
- Audit logs never carry the key value.

Items the implementer may decide without re-asking the user (delegated authority):
- Exact maximum length of `licenseKey.value` (spec proposes 4096, reasonable for any modern key).
- Whether the Brands and Models management pages live under `/settings/brands` and `/settings/models` or under `/admin/...`. Spec defaults to `/settings/...` to match existing conventions in `SubtypeManagementPage`.
- Date-input precision: day-precision in UI, stored as `Timestamp` at 00:00:00 in the operator's local timezone. (We do not introduce a `Date`-only type.)

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| License key leaks via React DevTools / Redux DevTools state inspection. | Key state lives only inside `LicenseKeyField` / `LicenseKeyDialog` local state, never in a Context. The masked-display default means even an over-the-shoulder glance shows `•••••`. |
| Operator pastes the key into the `notes` field. | Notes is rendered to all admins. Mitigation is documentation in the form's helper text under the License block: "Не вставляйте ключ в Заметки — для этого есть отдельное защищённое поле". No automated detection. |
| `expiresAt` set in the past silently. | Form-level validation: `expiresAt > now` warns (not blocks — the operator may be backfilling an already-expired license for record-keeping). Validation in `validateAssetInput` enforces only `expiresAt > subscribedAt`. |
| Brand/Model dropdowns get unusably long. | Use shadcn/ui `Combobox` with type-ahead filter. Same pattern as the existing `EmployeeSelect`. |
| Super Admin disables `assignsInventoryCode` on a non-license category that already has assets. | Category form blocks the toggle with an error if the category has any asset. Same pattern as `CategoryInUseError`. |
| Two operators race on creating a license whose key write succeeds but parent asset write fails. | `firestoreAssetRepository.create` runs the parent write and the secret write inside one `runTransaction`. If either fails, the whole thing rolls back. |
