# Asset Form Redesign — Brands, Models, Progressive Disclosure, License Specifics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote Brand and Model to typed catalog collections, redesign the Asset form into a progressively-disclosed 5-group layout with a create-only preview step, treat License as a first-class asset variant with hardened key storage, and add an admin-tunable license-expiry warning threshold.

**Architecture:** Two new top-level Firestore collections (`/brands`, `/models`) replace the free-text `brand`/`model` strings on assets with FKs. Categories gain `assignsInventoryCode: boolean` so the seeded `license` category opts out of the `category_counters` allocation. License keys live in a hardened sub-collection `/assets/{aid}/secrets/key` writable only by super_admin and tech_admin; all three protective layers (rules, audit-helper sanitiser, never-log discipline) are in scope. The form is a single dialog with conditional groups — Group 1 (What), Group 2 (Identifiers), Group 6 (License-only, between 2 and 3), Group 3 (Where), Group 4 (Money/Warranty, accordion), Group 5 (Notes) — followed by a `AssetCreatePreviewDialog` on create. The composed display title comes from a pure helper `formatAssetTitle(asset, { brand, model, subtype }, locale)`.

**Tech Stack:** React + Vite, Firebase v9+ modular SDK (Firestore, Auth), JSDoc-typed JS, Tailwind + shadcn/ui, i18next (ru/en/hy), Vitest, ESLint.

---

## Hard Operational Rules (apply to every task)

- **No git commands at all.** Do not `git add`, `git commit`, `git push`, `git status`, `git diff`. Leave changes in the working tree. Override the checklist's "Commit" steps from the writing-plans template — they do not apply here. Each task ends at "tests green".
- **No `firebase deploy` of any kind.** Rules changes stay in `firestore.rules` only. Do not invoke `npx firebase deploy --only firestore:rules` (or any other deploy target). Mention the single deploy command in the final report so the user can run it themselves.
- **No emulator-driven rules tests.** This project has no JRE installed; existing emulator tests in `firestore-tests/` are `describe.skip`. Spec acceptance criterion #11 ("rules unit tests pass against the emulator") is satisfied here by **pure-JS rules-mirror tests** under `src/test/*.rulesMirror.test.js`, mirroring the predicate logic from `firestore.rules`. Pattern: `src/test/assets.rulesMirror.test.js`.
- **CWD always absolute:** every file path in this plan is `C:/Users/DELL/Desktop/assets-crm/...` with forward slashes. Subagent threads reset their CWD between bash calls — always pass absolute paths.
- **Verification commands** (run from `C:/Users/DELL/Desktop/assets-crm/`):
  - `npm run lint`
  - `npx vitest run`
  - `npm run build`
- All three must come back green at the end of every task. Lint warnings count as failure.
- **Audit invariant** (mandatory for every Firestore mutation): the data write and the corresponding `audit_logs/{id}` write must happen inside the same `runTransaction()` call. Reference implementation: `src/infra/repositories/firestoreCategoryRepository.js`.
- **License key never enters audit logs, never enters logs, never enters error messages.** Three protective layers, all in scope:
  1. `firestore.rules` blocks reads at `/assets/{aid}/secrets/{any}` for every role except super_admin and tech_admin.
  2. `withAudit` sanitises diffs through `sanitizeLicenseKeyDiff` so any field path matching `licenseKey` / `secrets.key` is stripped before write.
  3. `firestoreLicenseSecretRepository` never passes the key value to `console.*`, `Error.message`, or any helper that could surface it. A cross-cutting test enforces this at module scope.
- **MVP boundary is Phase 1.** §9 of the spec lists out-of-scope items (email notifications, scheduled functions, separate `/licenses` collection, brand/model import-export, key rotation history, assignment-flow changes, dynamic per-category attributes). None of these appear as tasks below.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/domain/brands.js` | `Brand` typedef, `emptyBrandInput`, `sanitizeBrandInput`, `validateBrandInput`, `BrandIdConflictError`, `BrandInUseError`. |
| `src/domain/models.js` | `Model` typedef, `emptyModelInput`, `sanitizeModelInput`, `validateModelInput`, `ModelIdConflictError`, `ModelInUseError`. |
| `src/domain/notificationSettings.js` | `NotificationSettings` typedef, `sanitizeNotificationSettingsInput`, `validateNotificationSettingsInput` (range 1..365). |
| `src/domain/licenseSecrets.js` | `LicenseSecret` typedef, `sanitizeLicenseSecretValue` (trim, length cap 4096, non-empty). NEVER references the value in error message text. |
| `src/lib/asset/formatAssetTitle.js` | Pure helper `formatAssetTitle(asset, { brand, model, subtype }, locale)` returning the composed title. |
| `src/lib/audit/sanitizeLicenseKeyDiff.js` | Pure helper that strips `licenseKey` / `secrets.key` from before/after diffs. |
| `src/infra/repositories/firestoreBrandRepository.js` | CRUD against `/brands`, audit-helper transactions. |
| `src/infra/repositories/firestoreModelRepository.js` | CRUD against `/models` with `byBrand(brandId)` query helper. |
| `src/infra/repositories/firestoreLicenseSecretRepository.js` | get/set against `/assets/{assetId}/secrets/key`. NEVER returns or logs the value. |
| `src/infra/repositories/firestoreNotificationSettingsRepository.js` | get/set against `/settings/notifications`. |
| `src/hooks/useBrands.js` | Reactive hook `{ data, loading, error }` over `/brands`. |
| `src/hooks/useModels.js` | Reactive hook `{ data, loading, error }` filtered by brand id. |
| `src/hooks/useLicenseSecret.js` | Imperative `{ get, set, loading, error }` (no live subscription). |
| `src/hooks/useNotificationSettings.js` | Reactive hook for `/settings/notifications`. |
| `src/components/features/brands/BrandFormDialog.jsx` | Super-admin CRUD dialog. |
| `src/components/features/brands/BrandsManagementPage.jsx` | List + edit page (rendered at `/settings/brands`). |
| `src/components/features/models/ModelFormDialog.jsx` | Super-admin CRUD dialog. |
| `src/components/features/models/ModelsManagementPage.jsx` | List + edit page filtered by brand (rendered at `/settings/models`). |
| `src/components/features/assets/BrandSelect.jsx` | Combobox over active brands. Emits `brandId`. |
| `src/components/features/assets/ModelSelect.jsx` | Combobox over active models for a given brand. Disabled with no brand. |
| `src/components/features/assets/LicenseTypeRadio.jsx` | Radio over `LICENSE_TYPES`. |
| `src/components/features/assets/LicenseKeyField.jsx` | Masked input with show/hide + copy. Hidden for non-privileged roles. |
| `src/components/features/assets/LicenseKeyDialog.jsx` | "Управлять ключом" dialog rendered from `AssetDetailPage`. |
| `src/components/features/assets/LicenseFieldsBlock.jsx` | Group 6 — license-only fields, role-gates the key sub-field. |
| `src/components/features/assets/AssetCreatePreviewDialog.jsx` | Preview-and-confirm step (create only). |
| `src/components/features/assets/LicenseExpiryBadge.jsx` | Reads `/settings/notifications.licenseExpiryWarningDays` and renders the warning. |
| `src/components/features/settings/NotificationSettingsPage.jsx` | Super-admin form for `licenseExpiryWarningDays`. |
| `src/locales/ru/brands.json`, `en/brands.json`, `hy/brands.json` | Brands namespace (3 locales). |
| `src/locales/ru/models.json`, `en/models.json`, `hy/models.json` | Models namespace (3 locales). |
| `src/locales/ru/licenses.json`, `en/licenses.json`, `hy/licenses.json` | License-specific strings (3 locales). |
| Tests for every file above — co-located `*.test.js` / `*.test.jsx` under `src/test/`. |

### Modified files

| Path | Change |
|---|---|
| `src/domain/assets.js` | Replace `brand`/`model` (Tier-4 strings) with `brandId`/`modelId` (FKs); add `licenseType`, `subscribedAt`, `expiresAt`; reshape `name` to allow `null`; reshape `inventoryCode` to allow `null`; update `validateAssetInput` to consult `category.requiresMultilang`, `category.assignsInventoryCode`, and `category.id === 'license'`. Drop ASCII validators on the deleted `brand`/`model` fields. |
| `src/domain/categories.js` | Add `assignsInventoryCode: boolean` to typedef and `sanitizeCategoryInput`/`validateCategoryInput`. Default `true`; `license` seed gets `false`. |
| `src/lib/audit/auditHelper.js` | Add `'brand'` and `'model'` to `ALLOWED_ENTITIES`. Wire `sanitizeLicenseKeyDiff` into `buildAuditLog` so any caller that sneaks `licenseKey` / `secrets.key` through gets it stripped. |
| `src/infra/repositories/firestoreAssetRepository.js` | Read/write the new fields; skip `category_counters` when `category.assignsInventoryCode === false`; coordinate the license-secret write inside the same `runTransaction`; never pass the key value to audit. |
| `src/infra/repositories/firestoreCategoryRepository.js` | Persist `assignsInventoryCode`. |
| `src/components/features/assets/AssetFormDialog.jsx` | Major rewrite: 5 progressive groups + license block + role-gated key sub-field. NO inventory-code preview when `assignsInventoryCode === false`. NO Name field when `requiresMultilang === false`. Preserves existing uncontrolled-input pattern. |
| `src/components/features/categories/CategoryFormDialog.jsx` | Add `assignsInventoryCode` checkbox. |
| `src/pages/AssetListPage.jsx`, `src/pages/AssetDetailPage.jsx` | Use `formatAssetTitle` for displayed title. License pages render `LicenseExpiryBadge` and the "Управлять ключом" button (super_admin / tech_admin only). |
| `src/components/system/StatusesAndCategoriesBootstrap.jsx` | Patch existing `license` category in place to set `assignsInventoryCode: false`; seed `/settings/notifications` with default `licenseExpiryWarningDays: 30` if missing. Idempotent. |
| `firestore.rules` | New blocks for `/brands`, `/models`, `/assets/{aid}/secrets/{any}`, `/settings/notifications`. Update `/assets/{assetId}` validators (`brandId`/`modelId`/`inventoryCode`/`name` shape, license-conditional fields). |
| `src/i18n/namespaces.js` | Register `BRANDS = 'brands'`, `MODELS = 'models'`, `LICENSES = 'licenses'`. |
| `src/locales/{ru,en,hy}/assets.json` | Group titles, license-specific labels, preview labels. |
| `src/locales/{ru,en,hy}/categories.json` | Key for the new `assignsInventoryCode` checkbox. |
| `src/locales/{ru,en,hy}/settings.json` (or new `notifications` namespace if file does not exist — see Task 26) | Keys for `NotificationSettingsPage`. |
| `src/App.jsx` | Routes `/settings/brands`, `/settings/models`, `/settings/notifications`. All super-admin gated. |
| `src/components/layout/AppShell.jsx` | Three new ADMIN_NAV entries (super_admin only). |

### Removed fields

- `assets.brand: string` and `assets.model: string` — removed from the typedef, `emptyAssetInput`, `sanitizeAssetInput`, `validateAssetInput`, `auditSnapshot`, and the rules block. Their ASCII validators (`isAsciiOrNull(brand)` / `isAsciiOrNull(model)` in rules; `errorAsciiOnly` checks in domain) are deleted for these two field names only — `serialNumber` keeps its ASCII validation.

---

## Architectural Decisions (locked)

These were resolved during brainstorming and are non-negotiable for this plan:

1. **Brand and Model are top-level collections**, not arrays embedded on Category. A brand spans categories (HP makes laptops AND printers); models have their own lifecycle (active/inactive). One extra Firestore read per asset detail is acceptable.
2. **The license key lives in a single document `/assets/{aid}/secrets/key`** — not a key-history sub-collection. Past keys are a liability, not an asset. Rotation overwrites in place.
3. **Three protective layers around the key** — rules, audit sanitiser, never-log discipline. Defense in depth.
4. **No `/licenses` collection.** Licenses are assets with category-conditional fields.
5. **Preview only on create.** Edit submits directly.
6. **Progressive disclosure inside one dialog**, not a wizard. Power users tab through fast.
7. **Brands and Models are Tier 4** (no multi-language fields, ASCII not enforced — Tier 4 means English-only by convention but free-form because product names sometimes carry punctuation).
8. **Inventory-code generation is conditional on `category.assignsInventoryCode === true`.** When false, the asset doc is written with `inventoryCode: null` and `category_counters` is NOT touched. Rule loosens to `inventoryCode == null || isValidInventoryCode(inventoryCode)`.
9. **Pure-JS rules-mirror tests** stand in for emulator tests. Same pattern as `src/test/assets.rulesMirror.test.js`.
10. **Cross-doc consistency between `model.brandId` and `asset.brandId`** is enforced by the form, the repository sanitiser, and validation — NOT by Firestore rules (rule-side `get()` per write is expensive).
11. **`Brand` and `Model` types are frozen for this plan:** `{ brandId, name, isActive, createdAt, createdBy, updatedAt, updatedBy }` and `{ modelId, brandId, name, isActive, createdAt, createdBy, updatedAt, updatedBy }`. Repository return shapes mirror these typedefs verbatim.

---

## Task Breakdown

### Task 1: Brand domain module

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/domain/brands.js`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/brands.test.js`

- [ ] **Step 1.1: Write the failing tests for `sanitizeBrandInput`, `validateBrandInput`, and the error classes**

Create `src/test/brands.test.js`:

```javascript
import { describe, it, expect } from 'vitest';

import {
  emptyBrandInput,
  sanitizeBrandInput,
  validateBrandInput,
  isBrandInputValid,
  BrandIdConflictError,
  BrandInUseError,
} from '@/domain/brands.js';

describe('brands — emptyBrandInput', () => {
  it('returns blank name and active=true', () => {
    expect(emptyBrandInput()).toEqual({ name: '', isActive: true });
  });
});

describe('brands — sanitizeBrandInput', () => {
  it('trims name and coerces isActive', () => {
    expect(sanitizeBrandInput({ name: '  HP  ', isActive: 0 })).toEqual({
      name: 'HP',
      isActive: false,
    });
  });

  it('defaults isActive to true when undefined', () => {
    expect(sanitizeBrandInput({ name: 'Apple' })).toEqual({
      name: 'Apple',
      isActive: true,
    });
  });

  it('returns empty string for missing name', () => {
    expect(sanitizeBrandInput({})).toEqual({ name: '', isActive: true });
  });

  it('caps name length at 200', () => {
    const long = 'X'.repeat(250);
    expect(sanitizeBrandInput({ name: long }).name.length).toBe(200);
  });
});

describe('brands — validateBrandInput', () => {
  it('reports errorRequired when name is blank', () => {
    expect(validateBrandInput({ name: '   ' })).toEqual({ name: 'errorRequired' });
  });

  it('reports no errors for a valid input', () => {
    expect(validateBrandInput({ name: 'HP', isActive: true })).toEqual({});
  });

  it('isBrandInputValid is the inverse of having errors', () => {
    expect(isBrandInputValid({ name: 'HP' })).toBe(true);
    expect(isBrandInputValid({ name: '' })).toBe(false);
  });
});

describe('brands — error classes', () => {
  it('BrandIdConflictError carries the id and name', () => {
    const err = new BrandIdConflictError('HP');
    expect(err.name).toBe('BrandIdConflictError');
    expect(err.id).toBe('HP');
  });

  it('BrandInUseError carries the count', () => {
    const err = new BrandInUseError('HP', { modelCount: 3, assetCount: 7 });
    expect(err.name).toBe('BrandInUseError');
    expect(err.modelCount).toBe(3);
    expect(err.assetCount).toBe(7);
  });
});
```

- [ ] **Step 1.2: Run the tests to verify they fail**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/brands.test.js`
Expected: FAIL with `Cannot find module '@/domain/brands.js'` (or equivalent module-not-found).

- [ ] **Step 1.3: Implement `src/domain/brands.js`**

Create `src/domain/brands.js`:

```javascript
/**
 * Brands domain module.
 *
 * Pure JavaScript: no Firestore, no React, no I/O. Brands are a Tier-4
 * catalog managed by Super Admin only. They are referenced by `models`
 * (FK) and by `assets.brandId`. Soft-delete only — hard delete blocked
 * by rules.
 */

/**
 * @typedef {Object} Brand
 * @property {string} brandId
 * @property {string} name
 * @property {boolean} isActive
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */

/**
 * @typedef {Object} BrandInput
 * @property {string} name
 * @property {boolean} [isActive]
 */

const NAME_MAX_LENGTH = 200;

function isPlainString(value) {
  return typeof value === 'string';
}

function trimOrEmpty(value) {
  return isPlainString(value) ? value.trim() : '';
}

/**
 * @returns {BrandInput}
 */
export function emptyBrandInput() {
  return { name: '', isActive: true };
}

/**
 * @param {BrandInput} input
 * @returns {BrandInput}
 */
export function sanitizeBrandInput(input) {
  const raw = input ?? {};
  const trimmed = trimOrEmpty(raw.name);
  return {
    name: trimmed.slice(0, NAME_MAX_LENGTH),
    isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
  };
}

/**
 * @param {BrandInput} input
 * @returns {Record<string, string>}
 */
export function validateBrandInput(input) {
  const errors = {};
  const s = sanitizeBrandInput(input);
  if (!s.name) errors.name = 'errorRequired';
  return errors;
}

/**
 * @param {BrandInput} input
 */
export function isBrandInputValid(input) {
  return Object.keys(validateBrandInput(input)).length === 0;
}

export class BrandIdConflictError extends Error {
  constructor(id) {
    super(`Brand id already exists: ${id}`);
    this.name = 'BrandIdConflictError';
    this.id = id;
  }
}

export class BrandInUseError extends Error {
  /**
   * @param {string} id
   * @param {{ modelCount: number, assetCount: number }} counts
   */
  constructor(id, counts) {
    super(
      `Brand ${id} is referenced by ${counts.modelCount} models and ${counts.assetCount} assets`
    );
    this.name = 'BrandInUseError';
    this.code = 'brand/in-use';
    this.id = id;
    this.modelCount = counts.modelCount;
    this.assetCount = counts.assetCount;
  }
}
```

- [ ] **Step 1.4: Run the tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/brands.test.js`
Expected: PASS — all assertions green.

- [ ] **Step 1.5: Run the full lint pass to confirm no regressions**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint`
Expected: lint passes with no new warnings.

---

### Task 2: Model domain module

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/domain/models.js`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/models.test.js`

- [ ] **Step 2.1: Write the failing tests for `sanitizeModelInput`, `validateModelInput`, and the error classes**

Create `src/test/models.test.js`:

```javascript
import { describe, it, expect } from 'vitest';

import {
  emptyModelInput,
  sanitizeModelInput,
  validateModelInput,
  isModelInputValid,
  ModelIdConflictError,
  ModelInUseError,
} from '@/domain/models.js';

describe('models — emptyModelInput', () => {
  it('returns blank fields and active=true', () => {
    expect(emptyModelInput()).toEqual({ brandId: '', name: '', isActive: true });
  });
});

describe('models — sanitizeModelInput', () => {
  it('trims fields and coerces isActive', () => {
    expect(
      sanitizeModelInput({ brandId: '  hp  ', name: '  EliteBook  ', isActive: 0 })
    ).toEqual({ brandId: 'hp', name: 'EliteBook', isActive: false });
  });

  it('defaults isActive to true when undefined', () => {
    expect(sanitizeModelInput({ brandId: 'hp', name: 'X' })).toEqual({
      brandId: 'hp',
      name: 'X',
      isActive: true,
    });
  });

  it('caps name length at 200', () => {
    const long = 'X'.repeat(250);
    expect(sanitizeModelInput({ brandId: 'hp', name: long }).name.length).toBe(200);
  });
});

describe('models — validateModelInput', () => {
  it('reports errorRequired when brandId is blank', () => {
    expect(validateModelInput({ brandId: '', name: 'X' })).toEqual({
      brandId: 'errorRequired',
    });
  });

  it('reports errorRequired when name is blank', () => {
    expect(validateModelInput({ brandId: 'hp', name: '' })).toEqual({
      name: 'errorRequired',
    });
  });

  it('reports both when both are blank', () => {
    expect(validateModelInput({ brandId: '', name: '' })).toEqual({
      brandId: 'errorRequired',
      name: 'errorRequired',
    });
  });

  it('returns no errors for a valid input', () => {
    expect(validateModelInput({ brandId: 'hp', name: 'EliteBook' })).toEqual({});
  });

  it('isModelInputValid is the inverse', () => {
    expect(isModelInputValid({ brandId: 'hp', name: 'X' })).toBe(true);
    expect(isModelInputValid({ brandId: '', name: 'X' })).toBe(false);
  });
});

describe('models — error classes', () => {
  it('ModelIdConflictError carries the id', () => {
    const err = new ModelIdConflictError('elitebook');
    expect(err.name).toBe('ModelIdConflictError');
    expect(err.id).toBe('elitebook');
  });

  it('ModelInUseError carries the count', () => {
    const err = new ModelInUseError('elitebook', { assetCount: 4 });
    expect(err.name).toBe('ModelInUseError');
    expect(err.assetCount).toBe(4);
  });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/models.test.js`
Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement `src/domain/models.js`**

Create `src/domain/models.js`:

```javascript
/**
 * Models domain module.
 *
 * Pure JavaScript: no Firestore, no React, no I/O. A model belongs to
 * exactly one brand. Soft-delete only.
 */

/**
 * @typedef {Object} Model
 * @property {string} modelId
 * @property {string} brandId
 * @property {string} name
 * @property {boolean} isActive
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */

/**
 * @typedef {Object} ModelInput
 * @property {string} brandId
 * @property {string} name
 * @property {boolean} [isActive]
 */

const NAME_MAX_LENGTH = 200;

function isPlainString(value) {
  return typeof value === 'string';
}

function trimOrEmpty(value) {
  return isPlainString(value) ? value.trim() : '';
}

/**
 * @returns {ModelInput}
 */
export function emptyModelInput() {
  return { brandId: '', name: '', isActive: true };
}

/**
 * @param {ModelInput} input
 * @returns {ModelInput}
 */
export function sanitizeModelInput(input) {
  const raw = input ?? {};
  const name = trimOrEmpty(raw.name).slice(0, NAME_MAX_LENGTH);
  return {
    brandId: trimOrEmpty(raw.brandId),
    name,
    isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
  };
}

/**
 * @param {ModelInput} input
 * @returns {Record<string, string>}
 */
export function validateModelInput(input) {
  const errors = {};
  const s = sanitizeModelInput(input);
  if (!s.brandId) errors.brandId = 'errorRequired';
  if (!s.name) errors.name = 'errorRequired';
  return errors;
}

/**
 * @param {ModelInput} input
 */
export function isModelInputValid(input) {
  return Object.keys(validateModelInput(input)).length === 0;
}

export class ModelIdConflictError extends Error {
  constructor(id) {
    super(`Model id already exists: ${id}`);
    this.name = 'ModelIdConflictError';
    this.id = id;
  }
}

export class ModelInUseError extends Error {
  /**
   * @param {string} id
   * @param {{ assetCount: number }} counts
   */
  constructor(id, counts) {
    super(`Model ${id} is referenced by ${counts.assetCount} assets`);
    this.name = 'ModelInUseError';
    this.code = 'model/in-use';
    this.id = id;
    this.assetCount = counts.assetCount;
  }
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/models.test.js`
Expected: PASS — all assertions green.

---

### Task 3: Add `assignsInventoryCode` to Category domain

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/domain/categories.js`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/test/categories.test.js` (add cases — file already exists)

- [ ] **Step 3.1: Add the failing tests for `assignsInventoryCode`**

Append to `src/test/categories.test.js` a new `describe` block:

```javascript
describe('categories — assignsInventoryCode', () => {
  it('emptyCategoryInput defaults assignsInventoryCode to true', () => {
    expect(emptyCategoryInput().assignsInventoryCode).toBe(true);
  });

  it('sanitizeCategoryInput coerces missing flag to true', () => {
    const sanitized = sanitizeCategoryInput({
      name: { ru: 'X', en: 'X', hy: 'X' },
      inventoryCodePrefix: 'X1',
      attachableTo: ['warehouse'],
    });
    expect(sanitized.assignsInventoryCode).toBe(true);
  });

  it('sanitizeCategoryInput preserves false', () => {
    const sanitized = sanitizeCategoryInput({
      name: { ru: 'License', en: 'License', hy: 'License' },
      inventoryCodePrefix: 'LIC',
      attachableTo: ['warehouse', 'employee'],
      requiresMultilang: false,
      assignsInventoryCode: false,
    });
    expect(sanitized.assignsInventoryCode).toBe(false);
  });

  it('sanitizeCategoryInput coerces truthy/falsy values to boolean', () => {
    expect(
      sanitizeCategoryInput({
        name: { ru: 'X', en: 'X', hy: 'X' },
        inventoryCodePrefix: 'X1',
        attachableTo: ['warehouse'],
        assignsInventoryCode: 0,
      }).assignsInventoryCode
    ).toBe(false);
    expect(
      sanitizeCategoryInput({
        name: { ru: 'X', en: 'X', hy: 'X' },
        inventoryCodePrefix: 'X1',
        attachableTo: ['warehouse'],
        assignsInventoryCode: 1,
      }).assignsInventoryCode
    ).toBe(true);
  });
});
```

(Imports `emptyCategoryInput` and `sanitizeCategoryInput` should already be present at the top of `categories.test.js`. If not, add them.)

- [ ] **Step 3.2: Run the tests to verify they fail**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/categories.test.js`
Expected: FAIL on the four new cases (assignsInventoryCode is `undefined`).

- [ ] **Step 3.3: Update the `Category` typedef and `CategoryInput` typedef**

Edit `src/domain/categories.js` — extend the `Category` typedef block (line 32-48 area) by adding before `@property {boolean} isActive`:

```javascript
 * @property {boolean} assignsInventoryCode
 *   When true, an asset created in this category gets an inventory code
 *   from `category_counters/{categoryId}` and the form shows the preview.
 *   When false (license), the asset is written with `inventoryCode: null`
 *   and the counter is not touched.
```

And in the `CategoryInput` typedef, add:

```javascript
 * @property {boolean} [assignsInventoryCode]
```

- [ ] **Step 3.4: Update `emptyCategoryInput` to include the field**

In `src/domain/categories.js`, edit `emptyCategoryInput`:

```javascript
export function emptyCategoryInput() {
  return {
    name: emptyCategoryName(),
    inventoryCodePrefix: '',
    requiresMultilang: true,
    attachableTo: [],
    assignsInventoryCode: true,
    isActive: true,
  };
}
```

- [ ] **Step 3.5: Update `sanitizeCategoryInput` to coerce the field**

In `src/domain/categories.js`, edit the `return` statement of `sanitizeCategoryInput` to add the field. The new return becomes:

```javascript
  return {
    name,
    inventoryCodePrefix: prefixRaw,
    requiresMultilang,
    attachableTo,
    assignsInventoryCode:
      raw.assignsInventoryCode === undefined
        ? true
        : Boolean(raw.assignsInventoryCode),
    isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
  };
```

- [ ] **Step 3.6: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/categories.test.js`
Expected: PASS — all assertions green, including the four new cases.

---

### Task 4: Asset domain — replace `brand`/`model` strings with `brandId`/`modelId` FKs, add license fields, allow nullable `name` and `inventoryCode`

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/domain/assets.js`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/test/assets.test.js`

- [ ] **Step 4.1: Write the failing tests for the new shape**

Append to `src/test/assets.test.js` a new `describe` block:

```javascript
describe('assets — brandId/modelId FK shape', () => {
  it('emptyAssetInput exposes brandId/modelId as null and not brand/model', () => {
    const e = emptyAssetInput();
    expect('brand' in e).toBe(false);
    expect('model' in e).toBe(false);
    expect(e.brandId).toBeNull();
    expect(e.modelId).toBeNull();
  });

  it('sanitizeAssetInput trims brandId and modelId', () => {
    const s = sanitizeAssetInput({
      categoryId: 'device',
      subtypeId: 'device_laptop',
      brandId: '  hp  ',
      modelId: '  elitebook  ',
    });
    expect(s.brandId).toBe('hp');
    expect(s.modelId).toBe('elitebook');
  });

  it('sanitizeAssetInput returns null when fields are missing', () => {
    const s = sanitizeAssetInput({ categoryId: 'device', subtypeId: 'device_laptop' });
    expect(s.brandId).toBeNull();
    expect(s.modelId).toBeNull();
  });

  it('sanitizeAssetInput strips brand/model legacy strings', () => {
    const s = sanitizeAssetInput({
      categoryId: 'device',
      subtypeId: 'device_laptop',
      brand: 'HP-legacy',
      model: 'EliteBook-legacy',
    });
    expect('brand' in s).toBe(false);
    expect('model' in s).toBe(false);
  });

  it('validateAssetInput requires brandId when modelId is set', () => {
    const errs = validateAssetInput(
      {
        categoryId: 'device',
        subtypeId: 'device_laptop',
        name: 'Mac',
        statusId: 'warehouse',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b1',
        condition: 'new',
        brandId: null,
        modelId: 'elitebook',
      },
      { category: { requiresMultilang: false }, subtype: { attachableTo: ['warehouse'] } }
    );
    expect(errs.brandId).toBe('errorRequired');
  });
});

describe('assets — name nullable for non-multilang categories', () => {
  it('sanitizeAssetInput sets name=null when category.requiresMultilang===false', () => {
    const s = sanitizeAssetInput(
      { categoryId: 'device', subtypeId: 'device_laptop', name: 'X' },
      { category: { requiresMultilang: false } }
    );
    expect(s.name).toBeNull();
  });

  it('validateAssetInput does NOT report name error when requiresMultilang===false', () => {
    const errs = validateAssetInput(
      {
        categoryId: 'device',
        subtypeId: 'device_laptop',
        statusId: 'warehouse',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b1',
        condition: 'new',
      },
      { category: { requiresMultilang: false }, subtype: { attachableTo: ['warehouse'] } }
    );
    expect(errs.name).toBeUndefined();
  });
});

describe('assets — license fields', () => {
  it('emptyAssetInput exposes licenseType/subscribedAt/expiresAt as null', () => {
    const e = emptyAssetInput();
    expect(e.licenseType).toBeNull();
    expect(e.subscribedAt).toBeNull();
    expect(e.expiresAt).toBeNull();
  });

  it('sanitizeAssetInput parses license dates', () => {
    const s = sanitizeAssetInput(
      {
        categoryId: 'license',
        subtypeId: 'license_windows',
        licenseType: 'business',
        subscribedAt: '2026-01-01',
        expiresAt: '2027-01-01',
      },
      { category: { requiresMultilang: false } }
    );
    expect(s.subscribedAt).toBeInstanceOf(Date);
    expect(s.expiresAt).toBeInstanceOf(Date);
    expect(s.licenseType).toBe('business');
  });

  it('sanitizeAssetInput coerces unknown licenseType to null', () => {
    const s = sanitizeAssetInput(
      {
        categoryId: 'license',
        subtypeId: 'license_windows',
        licenseType: 'invalid-value',
      },
      { category: { requiresMultilang: false } }
    );
    expect(s.licenseType).toBeNull();
  });

  it('validateAssetInput requires licenseType, subscribedAt, expiresAt for license categories', () => {
    const errs = validateAssetInput(
      {
        categoryId: 'license',
        subtypeId: 'license_windows',
        statusId: 'warehouse',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b1',
        condition: 'new',
      },
      { category: { requiresMultilang: false }, subtype: { attachableTo: ['warehouse'] } }
    );
    expect(errs.licenseType).toBe('errorRequired');
    expect(errs.subscribedAt).toBe('errorRequired');
    expect(errs.expiresAt).toBe('errorRequired');
  });

  it('validateAssetInput rejects expiresAt <= subscribedAt', () => {
    const errs = validateAssetInput(
      {
        categoryId: 'license',
        subtypeId: 'license_windows',
        statusId: 'warehouse',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b1',
        condition: 'new',
        licenseType: 'business',
        subscribedAt: '2027-01-01',
        expiresAt: '2026-01-01',
      },
      { category: { requiresMultilang: false }, subtype: { attachableTo: ['warehouse'] } }
    );
    expect(errs.expiresAt).toBe('errorExpiresBeforeSubscribed');
  });
});

describe('assets — inventoryCode nullable when category opts out', () => {
  it('validateAssetInput does NOT require inventoryCode (it is allocated by repo)', () => {
    const errs = validateAssetInput(
      {
        categoryId: 'license',
        subtypeId: 'license_windows',
        statusId: 'warehouse',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b1',
        condition: 'new',
        licenseType: 'business',
        subscribedAt: '2026-01-01',
        expiresAt: '2027-01-01',
      },
      {
        category: { requiresMultilang: false, assignsInventoryCode: false },
        subtype: { attachableTo: ['warehouse'] },
      }
    );
    // inventoryCode is not part of AssetInput at all — repository allocates
    // it. The point of this test is that no validation error appears for it.
    expect(errs.inventoryCode).toBeUndefined();
  });
});
```

- [ ] **Step 4.2: Run tests to verify they fail**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/assets.test.js`
Expected: FAIL on the new cases.

- [ ] **Step 4.3: Update the `Asset` typedef in `src/domain/assets.js`**

In the `@typedef {Object} Asset` block, replace these two lines:

```javascript
 * @property {string|null} brand                             // Tier 4, ASCII, optional
 * @property {string|null} model                             // Tier 4, ASCII, optional
```

with:

```javascript
 * @property {string|null} brandId                           // FK -> brands. null for Furniture.
 * @property {string|null} modelId                           // FK -> models. null when brandId is null. If non-null, model.brandId must equal asset.brandId.
```

And update the `name` and `inventoryCode` JSDoc:

```javascript
 * @property {string|null} inventoryCode                     // ^[A-Z0-9]+/[0-9]+$ OR null when category.assignsInventoryCode === false. Immutable post-create.
 * @property {AssetName | string | null} name                // Tier 3 multi-lang map | string | null when category.requiresMultilang === false
```

Append (before `@property {boolean} isActive`):

```javascript
 * @property {('personal'|'business'|'enterprise'|null)} licenseType   // license categories only
 * @property {import('firebase/firestore').Timestamp|null} subscribedAt  // license categories only
 * @property {import('firebase/firestore').Timestamp|null} expiresAt    // license categories only
```

Update the `AssetInput` typedef the same way: replace `brand` / `model` with `brandId` / `modelId`, add `licenseType`, `subscribedAt`, `expiresAt`.

- [ ] **Step 4.4: Update `emptyAssetInput()`**

Replace the body of `emptyAssetInput()`:

```javascript
export function emptyAssetInput() {
  return {
    categoryId: '',
    subtypeId: '',
    name: '',
    brandId: null,
    modelId: null,
    serialNumber: null,
    statusId: DEFAULT_ASSET_STATUS_CODE,
    assignedTo: { kind: ASSIGNMENT_KINDS.WAREHOUSE, id: null },
    branchId: null,
    notes: null,
    purchaseDate: null,
    purchasePrice: null,
    condition: 'new',
    warrantyStart: null,
    warrantyEnd: null,
    licenseType: null,
    subscribedAt: null,
    expiresAt: null,
    isActive: true,
  };
}
```

- [ ] **Step 4.5: Update `sanitizeAssetInput()`**

Replace the `name` block, the `brand`/`model` block, and add the license block. The new return-object shape:

- Replace `brand: trimOrNull(raw.brand)` / `model: trimOrNull(raw.model)` with `brandId: trimOrNull(raw.brandId)` / `modelId: trimOrNull(raw.modelId)`.
- Update the `name` block: when `wantsMultilang === false` AND `opts.category` is truthy AND `opts.category.requiresMultilang === false`, set `name = null` instead of an empty string. (The form passes the category in `opts`. Without `opts.category` we keep the legacy single-string fallback.)
- Add the license block — accept `licenseType` only if it is one of `'personal' | 'business' | 'enterprise'`, otherwise null. Parse `subscribedAt` and `expiresAt` with the existing `parseDate` helper.

The full new function body (replace `sanitizeAssetInput` end-to-end):

```javascript
export function sanitizeAssetInput(input, opts = {}) {
  const raw = input ?? {};
  const category = opts.category ?? null;
  const wantsMultilang = Boolean(category?.requiresMultilang);
  const isLicense = (raw.categoryId ?? '').trim() === 'license';

  // ---- name ----
  let name;
  if (category && category.requiresMultilang === false) {
    name = null;
  } else if (wantsMultilang) {
    const rawName = raw.name && typeof raw.name === 'object' ? raw.name : {};
    name = SUPPORTED_LOCALES.reduce(
      (acc, l) => ({ ...acc, [l]: trimOrEmpty(rawName[l]) }),
      {}
    );
  } else {
    if (raw.name && typeof raw.name === 'object') {
      const m = raw.name;
      name = trimOrEmpty(m.ru) || trimOrEmpty(m.en) || trimOrEmpty(m.hy) || '';
    } else {
      name = trimOrEmpty(raw.name);
    }
  }

  // ---- assignedTo ----
  const rawAt = raw.assignedTo && typeof raw.assignedTo === 'object'
    ? raw.assignedTo
    : { kind: ASSIGNMENT_KINDS.WAREHOUSE, id: null };
  let kind = ASSIGNMENT_KIND_LIST.includes(rawAt.kind)
    ? rawAt.kind
    : ASSIGNMENT_KINDS.WAREHOUSE;
  let id = trimOrNull(rawAt.id);
  if (kind === ASSIGNMENT_KINDS.WAREHOUSE) id = null;
  const assignedTo = { kind, id };

  // ---- branchId ----
  let branchId = trimOrNull(raw.branchId);
  if (
    kind === ASSIGNMENT_KINDS.EMPLOYEE ||
    kind === ASSIGNMENT_KINDS.DEPARTMENT ||
    kind === ASSIGNMENT_KINDS.ASSET
  ) {
    branchId = null;
  }

  // ---- numbers ----
  let purchasePrice = null;
  if (typeof raw.purchasePrice === 'number' && Number.isFinite(raw.purchasePrice)) {
    purchasePrice = raw.purchasePrice;
  } else if (isPlainString(raw.purchasePrice) && raw.purchasePrice.trim().length > 0) {
    const parsed = Number.parseFloat(raw.purchasePrice.trim());
    if (Number.isFinite(parsed)) purchasePrice = parsed;
  }

  // ---- dates ----
  function parseDate(v) {
    if (v instanceof Date && !Number.isNaN(v.valueOf())) return v;
    if (isPlainString(v) && v.trim().length > 0) {
      const parsed = new Date(v.trim());
      if (!Number.isNaN(parsed.valueOf())) return parsed;
    }
    return null;
  }
  const purchaseDate = parseDate(raw.purchaseDate);

  // ---- condition + warranty ----
  const condition = raw.condition === 'used' ? 'used' : 'new';
  let warrantyStart = parseDate(raw.warrantyStart);
  let warrantyEnd = parseDate(raw.warrantyEnd);
  if (condition === 'used') {
    warrantyStart = null;
    warrantyEnd = null;
  }

  // ---- license ----
  const licenseType =
    raw.licenseType === 'personal' ||
    raw.licenseType === 'business' ||
    raw.licenseType === 'enterprise'
      ? raw.licenseType
      : null;
  const subscribedAt = parseDate(raw.subscribedAt);
  const expiresAt = parseDate(raw.expiresAt);

  return {
    categoryId: trimOrEmpty(raw.categoryId),
    subtypeId: trimOrEmpty(raw.subtypeId),
    name,
    brandId: trimOrNull(raw.brandId),
    modelId: trimOrNull(raw.modelId),
    serialNumber: trimOrNull(raw.serialNumber),
    statusId: trimOrEmpty(raw.statusId) || DEFAULT_ASSET_STATUS_CODE,
    assignedTo,
    branchId,
    notes: trimOrNull(raw.notes),
    purchaseDate,
    purchasePrice,
    condition,
    warrantyStart,
    warrantyEnd,
    licenseType: isLicense ? licenseType : null,
    subscribedAt: isLicense ? subscribedAt : null,
    expiresAt: isLicense ? expiresAt : null,
    isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
  };
}
```

- [ ] **Step 4.6: Update `validateAssetInput()`**

Replace the brand/model ASCII checks and add the FK + license rules. The full updated body (replace `validateAssetInput` end-to-end):

```javascript
export function validateAssetInput(input, opts = {}) {
  const errors = {};
  const category = opts.category ?? null;
  const subtype = opts.subtype ?? null;
  const wantsMultilang = Boolean(category?.requiresMultilang);
  const s = sanitizeAssetInput(input, opts);
  const isLicense = s.categoryId === 'license';

  // categoryId required.
  if (!s.categoryId) errors.categoryId = 'errorRequired';

  // subtypeId required.
  if (!s.subtypeId) errors.subtypeId = 'errorRequired';

  // name validation. Only meaningful when a category is picked.
  if (s.categoryId) {
    if (wantsMultilang) {
      const map = /** @type {AssetName} */ (s.name);
      if (!map || typeof map !== 'object') {
        errors.name = 'errorRequired';
      } else {
        const filled = SUPPORTED_LOCALES.filter(
          (l) => map[l] && map[l].length > 0
        );
        if (filled.length === 0) errors.name = 'errorRequired';
        else if (filled.length < SUPPORTED_LOCALES.length)
          errors.name = 'errorNameAllLocales';
      }
    } else if (category && category.requiresMultilang === false) {
      // Name MUST be null for non-multilang categories.
      if (s.name !== null) errors.name = 'errorNameMustBeNull';
    } else {
      if (!s.name || (typeof s.name === 'string' && s.name.length === 0)) {
        errors.name = 'errorRequired';
      }
    }
  }

  // brandId / modelId pair: if modelId is set, brandId must be set.
  if (s.modelId && !s.brandId) errors.brandId = 'errorRequired';

  // serialNumber must be ASCII when present.
  if (s.serialNumber && NON_ASCII_REGEX.test(s.serialNumber)) {
    errors.serialNumber = 'errorAsciiOnly';
  }

  // assignedTo validation.
  const at = s.assignedTo;
  if (!ASSIGNMENT_KIND_LIST.includes(at?.kind)) {
    errors.assignedTo = 'errorRequired';
  } else if (at.kind !== ASSIGNMENT_KINDS.WAREHOUSE && !at.id) {
    errors.assignedTo = 'errorRequired';
  } else if (
    subtype?.attachableTo &&
    Array.isArray(subtype.attachableTo) &&
    subtype.attachableTo.length > 0 &&
    !subtype.attachableTo.includes(at.kind)
  ) {
    errors.assignedTo = 'errorAssignedKindNotAllowed';
  }

  // branchId required for warehouse / branch modes.
  if (
    at?.kind === ASSIGNMENT_KINDS.WAREHOUSE ||
    at?.kind === ASSIGNMENT_KINDS.BRANCH
  ) {
    if (!s.branchId) errors.branchId = 'errorRequired';
  }

  if (!s.statusId) errors.statusId = 'errorRequired';

  if (s.condition !== 'new' && s.condition !== 'used') {
    errors.condition = 'errorRequired';
  }

  if (s.condition === 'new' && s.warrantyStart && s.warrantyEnd) {
    if (s.warrantyEnd.valueOf() < s.warrantyStart.valueOf()) {
      errors.warrantyEnd = 'errorWarrantyEndBeforeStart';
    }
  }

  // License-specific.
  if (isLicense) {
    if (!s.licenseType) errors.licenseType = 'errorRequired';
    if (!s.subscribedAt) errors.subscribedAt = 'errorRequired';
    if (!s.expiresAt) errors.expiresAt = 'errorRequired';
    if (
      s.subscribedAt &&
      s.expiresAt &&
      s.expiresAt.valueOf() <= s.subscribedAt.valueOf()
    ) {
      errors.expiresAt = 'errorExpiresBeforeSubscribed';
    }
  } else {
    // Non-license: license fields must be null. Sanitizer already enforces;
    // this is a defensive guard for callers that bypass the sanitizer.
    if (s.licenseType || s.subscribedAt || s.expiresAt) {
      errors.licenseType = 'errorLicenseFieldsOnLicenseOnly';
    }
  }

  return errors;
}
```

- [ ] **Step 4.7: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/assets.test.js`
Expected: PASS — all assertions green.

- [ ] **Step 4.8: Run the full test suite to surface any downstream breakage**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run`
Expected: any tests that referenced `brand`/`model` strings will fail. **DO NOT FIX THEM IN THIS TASK** — note the failing files; they are addressed in the corresponding repo / hook / UI tasks below. Use the failures as a checklist that downstream tasks must touch each of those files.

---

### Task 5: `formatAssetTitle` pure helper

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/lib/asset/formatAssetTitle.js`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/formatAssetTitle.test.js`

- [ ] **Step 5.1: Write the failing tests**

Create `src/test/formatAssetTitle.test.js`:

```javascript
import { describe, it, expect } from 'vitest';

import { formatAssetTitle } from '@/lib/asset/formatAssetTitle.js';

describe('formatAssetTitle', () => {
  it('joins subtype, brand, model with " · " for non-multilang categories', () => {
    expect(
      formatAssetTitle(
        { name: null, categoryId: 'device' },
        {
          subtype: { name: { ru: 'Ноутбук', en: 'Laptop', hy: 'Նոթբուք' } },
          brand: { name: 'HP' },
          model: { name: 'EliteBook 840 G6' },
        },
        'ru'
      )
    ).toBe('Ноутбук · HP · EliteBook 840 G6');
  });

  it('skips missing brand/model parts', () => {
    expect(
      formatAssetTitle(
        { name: null, categoryId: 'device' },
        {
          subtype: { name: { ru: 'Ноутбук', en: 'Laptop', hy: 'Նոթբուք' } },
          brand: null,
          model: null,
        },
        'ru'
      )
    ).toBe('Ноутбук');
  });

  it('returns localized name for multi-lang categories (Furniture)', () => {
    expect(
      formatAssetTitle(
        { name: { ru: 'Стол офисный', en: 'Office desk', hy: 'Գրասենյակային սեղան' }, categoryId: 'furniture' },
        { subtype: null, brand: null, model: null },
        'ru'
      )
    ).toBe('Стол офисный');
  });

  it('falls back to en when ru is empty', () => {
    expect(
      formatAssetTitle(
        { name: { ru: '', en: 'Office desk', hy: '' }, categoryId: 'furniture' },
        { subtype: null, brand: null, model: null },
        'ru'
      )
    ).toBe('Office desk');
  });

  it('returns empty string for null asset', () => {
    expect(formatAssetTitle(null, {}, 'ru')).toBe('');
  });

  it('handles empty parts gracefully', () => {
    expect(
      formatAssetTitle(
        { name: null, categoryId: 'device' },
        { subtype: null, brand: null, model: null },
        'ru'
      )
    ).toBe('');
  });

  it('handles plain-string subtype name', () => {
    expect(
      formatAssetTitle(
        { name: null, categoryId: 'device' },
        { subtype: { name: 'Laptop' }, brand: { name: 'HP' }, model: null },
        'ru'
      )
    ).toBe('Laptop · HP');
  });
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/formatAssetTitle.test.js`
Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement `src/lib/asset/formatAssetTitle.js`**

Create `src/lib/asset/formatAssetTitle.js`:

```javascript
import { localize } from '@/lib/localize.js';

/**
 * Compose the displayed title for an asset.
 *
 * - When `asset.name` is a multi-lang map (Furniture): `localize(asset.name, locale)`.
 * - Otherwise (Device, License): joins `[subtype, brand, model]` with " · ",
 *   each part also `localize`d when it is a multi-lang map. Empty parts skipped.
 *
 * Pure: no React, no Firestore.
 *
 * @param {{ name: any, categoryId?: string } | null | undefined} asset
 * @param {{ subtype?: any, brand?: any, model?: any }} refs
 * @param {string} [locale]
 * @returns {string}
 */
export function formatAssetTitle(asset, refs, locale) {
  if (!asset) return '';

  // Multi-lang name (Furniture path).
  if (asset.name && typeof asset.name === 'object') {
    return localize(asset.name, locale);
  }
  if (typeof asset.name === 'string' && asset.name.length > 0) {
    return asset.name;
  }

  // Composed-title path: subtype · brand · model.
  const parts = [];
  const sub = refs?.subtype;
  if (sub?.name) parts.push(typeof sub.name === 'object' ? localize(sub.name, locale) : String(sub.name));
  const br = refs?.brand;
  if (br?.name) parts.push(typeof br.name === 'object' ? localize(br.name, locale) : String(br.name));
  const md = refs?.model;
  if (md?.name) parts.push(typeof md.name === 'object' ? localize(md.name, locale) : String(md.name));

  return parts.filter(Boolean).join(' · ');
}
```

- [ ] **Step 5.4: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/formatAssetTitle.test.js`
Expected: PASS.

---

### Task 6: `LicenseSecret` domain helper

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/domain/licenseSecrets.js`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/licenseSecrets.test.js`

- [ ] **Step 6.1: Write the failing tests**

Create `src/test/licenseSecrets.test.js`:

```javascript
import { describe, it, expect } from 'vitest';

import {
  LICENSE_KEY_MAX_LENGTH,
  sanitizeLicenseSecretValue,
  validateLicenseSecretValue,
  isLicenseSecretValueValid,
} from '@/domain/licenseSecrets.js';

describe('licenseSecrets — constants', () => {
  it('caps key length at 4096', () => {
    expect(LICENSE_KEY_MAX_LENGTH).toBe(4096);
  });
});

describe('licenseSecrets — sanitizeLicenseSecretValue', () => {
  it('trims surrounding whitespace', () => {
    expect(sanitizeLicenseSecretValue('  ABC-DEF-123  ')).toBe('ABC-DEF-123');
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizeLicenseSecretValue(null)).toBe('');
    expect(sanitizeLicenseSecretValue(undefined)).toBe('');
    expect(sanitizeLicenseSecretValue(42)).toBe('');
  });

  it('truncates to LICENSE_KEY_MAX_LENGTH', () => {
    const long = 'X'.repeat(5000);
    expect(sanitizeLicenseSecretValue(long).length).toBe(LICENSE_KEY_MAX_LENGTH);
  });
});

describe('licenseSecrets — validateLicenseSecretValue', () => {
  it('reports errorRequired for empty value', () => {
    expect(validateLicenseSecretValue('   ')).toBe('errorRequired');
  });

  it('reports nothing for a valid value', () => {
    expect(validateLicenseSecretValue('ABC-123')).toBeNull();
  });
});

describe('licenseSecrets — error messages NEVER carry the value', () => {
  it('thrown errors include only generic text', () => {
    // Defensive — there is no throwing helper in this module, but make
    // sure no validation message contains the literal value.
    const value = 'SECRET-VALUE-123';
    const result = validateLicenseSecretValue(value);
    if (result !== null) {
      expect(result).not.toContain(value);
    }
  });
});

describe('licenseSecrets — isLicenseSecretValueValid', () => {
  it('returns true only for non-empty trimmed string within length cap', () => {
    expect(isLicenseSecretValueValid('A')).toBe(true);
    expect(isLicenseSecretValueValid('')).toBe(false);
    expect(isLicenseSecretValueValid('   ')).toBe(false);
  });
});
```

- [ ] **Step 6.2: Run tests to verify they fail**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/licenseSecrets.test.js`
Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement `src/domain/licenseSecrets.js`**

Create `src/domain/licenseSecrets.js`:

```javascript
/**
 * License secrets domain module.
 *
 * Pure JavaScript: no Firestore, no React, no I/O. Provides the sanitiser
 * and the length cap. The actual value is NEVER mentioned in any error
 * message produced by this module — error returns are i18n keys only.
 */

/**
 * @typedef {Object} LicenseSecret
 * @property {string} value
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */

export const LICENSE_KEY_MAX_LENGTH = 4096;

/**
 * Trim surrounding whitespace, coerce to string, truncate to the length cap.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeLicenseSecretValue(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length > LICENSE_KEY_MAX_LENGTH) {
    return trimmed.slice(0, LICENSE_KEY_MAX_LENGTH);
  }
  return trimmed;
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
export function validateLicenseSecretValue(value) {
  const v = sanitizeLicenseSecretValue(value);
  if (!v) return 'errorRequired';
  return null;
}

/**
 * @param {unknown} value
 */
export function isLicenseSecretValueValid(value) {
  return validateLicenseSecretValue(value) === null;
}
```

- [ ] **Step 6.4: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/licenseSecrets.test.js`
Expected: PASS.

---

### Task 7: `NotificationSettings` domain module

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/domain/notificationSettings.js`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/notificationSettings.test.js`

- [ ] **Step 7.1: Write the failing tests**

Create `src/test/notificationSettings.test.js`:

```javascript
import { describe, it, expect } from 'vitest';

import {
  DEFAULT_LICENSE_EXPIRY_WARNING_DAYS,
  LICENSE_EXPIRY_WARNING_DAYS_MIN,
  LICENSE_EXPIRY_WARNING_DAYS_MAX,
  emptyNotificationSettingsInput,
  sanitizeNotificationSettingsInput,
  validateNotificationSettingsInput,
  isNotificationSettingsInputValid,
} from '@/domain/notificationSettings.js';

describe('notificationSettings — constants', () => {
  it('default = 30, min = 1, max = 365', () => {
    expect(DEFAULT_LICENSE_EXPIRY_WARNING_DAYS).toBe(30);
    expect(LICENSE_EXPIRY_WARNING_DAYS_MIN).toBe(1);
    expect(LICENSE_EXPIRY_WARNING_DAYS_MAX).toBe(365);
  });
});

describe('notificationSettings — emptyNotificationSettingsInput', () => {
  it('returns the default', () => {
    expect(emptyNotificationSettingsInput()).toEqual({
      licenseExpiryWarningDays: 30,
    });
  });
});

describe('notificationSettings — sanitizeNotificationSettingsInput', () => {
  it('coerces strings to integers', () => {
    expect(sanitizeNotificationSettingsInput({ licenseExpiryWarningDays: '45' })).toEqual({
      licenseExpiryWarningDays: 45,
    });
  });

  it('falls back to default for non-numeric values', () => {
    expect(
      sanitizeNotificationSettingsInput({ licenseExpiryWarningDays: 'abc' })
    ).toEqual({ licenseExpiryWarningDays: 30 });
  });

  it('floors fractional input', () => {
    expect(sanitizeNotificationSettingsInput({ licenseExpiryWarningDays: 30.7 })).toEqual({
      licenseExpiryWarningDays: 30,
    });
  });
});

describe('notificationSettings — validateNotificationSettingsInput', () => {
  it('rejects values < 1', () => {
    expect(validateNotificationSettingsInput({ licenseExpiryWarningDays: 0 })).toEqual({
      licenseExpiryWarningDays: 'errorRange',
    });
  });

  it('rejects values > 365', () => {
    expect(validateNotificationSettingsInput({ licenseExpiryWarningDays: 400 })).toEqual({
      licenseExpiryWarningDays: 'errorRange',
    });
  });

  it('accepts boundary values 1 and 365', () => {
    expect(validateNotificationSettingsInput({ licenseExpiryWarningDays: 1 })).toEqual({});
    expect(validateNotificationSettingsInput({ licenseExpiryWarningDays: 365 })).toEqual({});
  });

  it('isNotificationSettingsInputValid is the inverse', () => {
    expect(isNotificationSettingsInputValid({ licenseExpiryWarningDays: 30 })).toBe(true);
    expect(isNotificationSettingsInputValid({ licenseExpiryWarningDays: 0 })).toBe(false);
  });
});
```

- [ ] **Step 7.2: Run tests to verify they fail**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/notificationSettings.test.js`
Expected: FAIL — module not found.

- [ ] **Step 7.3: Implement `src/domain/notificationSettings.js`**

Create `src/domain/notificationSettings.js`:

```javascript
/**
 * Notification settings domain module.
 *
 * Singleton-style document at /settings/notifications. In Phase 1 only
 * `licenseExpiryWarningDays` is in scope.
 */

/**
 * @typedef {Object} NotificationSettings
 * @property {number} licenseExpiryWarningDays
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */

/**
 * @typedef {Object} NotificationSettingsInput
 * @property {number} licenseExpiryWarningDays
 */

export const DEFAULT_LICENSE_EXPIRY_WARNING_DAYS = 30;
export const LICENSE_EXPIRY_WARNING_DAYS_MIN = 1;
export const LICENSE_EXPIRY_WARNING_DAYS_MAX = 365;

/**
 * @returns {NotificationSettingsInput}
 */
export function emptyNotificationSettingsInput() {
  return { licenseExpiryWarningDays: DEFAULT_LICENSE_EXPIRY_WARNING_DAYS };
}

/**
 * @param {NotificationSettingsInput} input
 * @returns {NotificationSettingsInput}
 */
export function sanitizeNotificationSettingsInput(input) {
  const raw = input ?? {};
  let n = DEFAULT_LICENSE_EXPIRY_WARNING_DAYS;
  if (typeof raw.licenseExpiryWarningDays === 'number') {
    n = Math.trunc(raw.licenseExpiryWarningDays);
  } else if (typeof raw.licenseExpiryWarningDays === 'string') {
    const parsed = Number.parseInt(raw.licenseExpiryWarningDays.trim(), 10);
    if (Number.isFinite(parsed)) n = parsed;
  }
  return { licenseExpiryWarningDays: n };
}

/**
 * @param {NotificationSettingsInput} input
 * @returns {Record<string, string>}
 */
export function validateNotificationSettingsInput(input) {
  const errors = {};
  const s = sanitizeNotificationSettingsInput(input);
  if (
    !Number.isInteger(s.licenseExpiryWarningDays) ||
    s.licenseExpiryWarningDays < LICENSE_EXPIRY_WARNING_DAYS_MIN ||
    s.licenseExpiryWarningDays > LICENSE_EXPIRY_WARNING_DAYS_MAX
  ) {
    errors.licenseExpiryWarningDays = 'errorRange';
  }
  return errors;
}

/**
 * @param {NotificationSettingsInput} input
 */
export function isNotificationSettingsInputValid(input) {
  return Object.keys(validateNotificationSettingsInput(input)).length === 0;
}
```

- [ ] **Step 7.4: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/notificationSettings.test.js`
Expected: PASS.

---

### Task 8: `auditHelper` — register `brand` / `model` entities and add `sanitizeLicenseKeyDiff`

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/lib/audit/sanitizeLicenseKeyDiff.js`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/sanitizeLicenseKeyDiff.test.js`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/lib/audit/auditHelper.js`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/test/auditHelper.test.js` (add cases — file already exists)

- [ ] **Step 8.1: Write the failing tests for `sanitizeLicenseKeyDiff`**

Create `src/test/sanitizeLicenseKeyDiff.test.js`:

```javascript
import { describe, it, expect } from 'vitest';

import { sanitizeLicenseKeyDiff } from '@/lib/audit/sanitizeLicenseKeyDiff.js';

describe('sanitizeLicenseKeyDiff', () => {
  it('passes through a plain object without licenseKey', () => {
    const input = { name: 'X', isActive: true };
    expect(sanitizeLicenseKeyDiff(input)).toEqual(input);
    // Returns a new object (does not mutate).
    expect(sanitizeLicenseKeyDiff(input)).not.toBe(input);
  });

  it('strips top-level licenseKey', () => {
    expect(sanitizeLicenseKeyDiff({ licenseKey: 'SECRET', name: 'X' })).toEqual({
      name: 'X',
    });
  });

  it('strips nested secrets.key', () => {
    expect(
      sanitizeLicenseKeyDiff({ name: 'X', secrets: { key: 'SECRET', other: 'safe' } })
    ).toEqual({ name: 'X', secrets: { other: 'safe' } });
  });

  it('preserves keys whose name CONTAINS but does NOT equal licenseKey', () => {
    expect(
      sanitizeLicenseKeyDiff({ licenseKeySet: true, licenseType: 'business' })
    ).toEqual({ licenseKeySet: true, licenseType: 'business' });
  });

  it('returns null for null', () => {
    expect(sanitizeLicenseKeyDiff(null)).toBeNull();
  });

  it('returns undefined for undefined', () => {
    expect(sanitizeLicenseKeyDiff(undefined)).toBeUndefined();
  });

  it('handles arrays without recursing into them', () => {
    expect(sanitizeLicenseKeyDiff({ list: [{ licenseKey: 'X' }, 'Y'] })).toEqual({
      list: [{ licenseKey: 'X' }, 'Y'],
    });
    // Arrays are out of scope per the spec — license key is a top-level
    // or secrets.key field, never a list element. We document the policy
    // by keeping arrays untouched.
  });
});
```

- [ ] **Step 8.2: Run tests to verify they fail**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/sanitizeLicenseKeyDiff.test.js`
Expected: FAIL — module not found.

- [ ] **Step 8.3: Implement `src/lib/audit/sanitizeLicenseKeyDiff.js`**

Create `src/lib/audit/sanitizeLicenseKeyDiff.js`:

```javascript
/**
 * Strip license-key-bearing fields from an audit diff snapshot.
 *
 * Behaviour:
 *   - Removes a top-level `licenseKey` property.
 *   - Removes `secrets.key` if `secrets` is a plain object.
 *   - Preserves all other keys unchanged.
 *   - Returns a shallow-cloned object (never mutates the caller's value).
 *   - Returns `null` / `undefined` unchanged.
 *
 * Pure: no I/O, no logging.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function sanitizeLicenseKeyDiff(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object' || Array.isArray(value)) return value;

  const out = { ...value };
  if ('licenseKey' in out) delete out.licenseKey;
  if (out.secrets && typeof out.secrets === 'object' && !Array.isArray(out.secrets)) {
    const { key: _stripped, ...rest } = out.secrets;
    out.secrets = rest;
  }
  return /** @type {T} */ (out);
}
```

- [ ] **Step 8.4: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/sanitizeLicenseKeyDiff.test.js`
Expected: PASS.

- [ ] **Step 8.5: Add failing tests for the audit-helper additions**

Append to `src/test/auditHelper.test.js`:

```javascript
describe('auditHelper — brand / model entities', () => {
  it('accepts entity="brand"', () => {
    expect(() =>
      buildAuditLog({
        entity: 'brand',
        entityId: 'hp',
        action: 'created',
        actorUid: 'u1',
        actorRole: 'super_admin',
        before: null,
        after: { name: 'HP', isActive: true },
      })
    ).not.toThrow();
  });

  it('accepts entity="model"', () => {
    expect(() =>
      buildAuditLog({
        entity: 'model',
        entityId: 'elitebook',
        action: 'created',
        actorUid: 'u1',
        actorRole: 'super_admin',
        before: null,
        after: { brandId: 'hp', name: 'EliteBook', isActive: true },
      })
    ).not.toThrow();
  });
});

describe('auditHelper — license-key diff sanitisation', () => {
  it('strips licenseKey from the after snapshot', () => {
    const log = buildAuditLog({
      entity: 'asset',
      entityId: 'a1',
      action: 'license_key_changed',
      actorUid: 'u1',
      actorRole: 'tech_admin',
      before: null,
      after: { licenseKey: 'TOP-SECRET', licenseKeySet: true },
    });
    expect(log.after).toEqual({ licenseKeySet: true });
    expect(JSON.stringify(log)).not.toContain('TOP-SECRET');
  });

  it('strips secrets.key from before/after', () => {
    const log = buildAuditLog({
      entity: 'asset',
      entityId: 'a1',
      action: 'updated',
      actorUid: 'u1',
      actorRole: 'tech_admin',
      before: { secrets: { key: 'OLD' } },
      after: { secrets: { key: 'NEW' } },
    });
    expect(JSON.stringify(log)).not.toContain('OLD');
    expect(JSON.stringify(log)).not.toContain('NEW');
  });
});
```

- [ ] **Step 8.6: Run tests to verify they fail**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/auditHelper.test.js`
Expected: FAIL — `'brand'` / `'model'` not allowed; `licenseKey` still in log.

- [ ] **Step 8.7: Update `src/lib/audit/auditHelper.js`**

Add `'brand'` and `'model'` to `ALLOWED_ENTITIES`. Wire `sanitizeLicenseKeyDiff` into `buildAuditLog`:

```javascript
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
```

- [ ] **Step 8.8: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/auditHelper.test.js src/test/sanitizeLicenseKeyDiff.test.js`
Expected: PASS — all assertions green.

---

### Task 9: `firestoreBrandRepository`

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/infra/repositories/firestoreBrandRepository.js`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/firestoreBrandRepository.test.js`

- [ ] **Step 9.1: Write failing repository tests**

Create `src/test/firestoreBrandRepository.test.js`. Mirror the structure of `src/test/firestoreCategoryRepository.test.js`. The test cases:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/firebase/index.js', () => ({
  db: { __mock: true },
}));

const txMock = {
  get: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((parent, id) => ({ __doc: id, __parent: parent })),
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((field, op, value) => ({ __where: { field, op, value } })),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __sentinel: 'serverTimestamp' })),
  runTransaction: vi.fn(async (_db, fn) => fn(txMock)),
  Timestamp: {
    now: () => ({ __ts: 'now' }),
    fromDate: (d) => ({ __ts: d.toISOString() }),
  },
}));

import * as firestore from 'firebase/firestore';
import {
  firestoreBrandRepository,
  createBrand,
  updateBrand,
  setBrandActive,
} from '@/infra/repositories/firestoreBrandRepository.js';
import { BrandIdConflictError, BrandInUseError } from '@/domain/brands.js';

beforeEach(() => {
  vi.clearAllMocks();
  txMock.get.mockReset();
  txMock.set.mockReset();
  txMock.update.mockReset();
});

describe('firestoreBrandRepository — createBrand', () => {
  it('writes the brand and an audit log inside one transaction', async () => {
    txMock.get.mockResolvedValueOnce({ exists: () => false });
    await createBrand({ name: 'HP' }, { uid: 'u1', role: 'super_admin' });
    expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
    expect(txMock.set).toHaveBeenCalledTimes(2); // brand + audit
  });

  it('throws BrandIdConflictError when doc already exists', async () => {
    txMock.get.mockResolvedValueOnce({ exists: () => true });
    await expect(
      createBrand({ name: 'HP' }, { uid: 'u1', role: 'super_admin' })
    ).rejects.toBeInstanceOf(BrandIdConflictError);
  });
});

describe('firestoreBrandRepository — updateBrand', () => {
  it('writes the diff and an audit log', async () => {
    txMock.get.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ name: 'HP', isActive: true }),
    });
    await updateBrand('hp', { name: 'HP Inc.' }, { uid: 'u1', role: 'super_admin' });
    expect(txMock.set).toHaveBeenCalledTimes(1); // audit
    expect(txMock.update).toHaveBeenCalledTimes(1); // brand
  });
});

describe('firestoreBrandRepository — setBrandActive', () => {
  it('flips isActive and audits', async () => {
    txMock.get.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ name: 'HP', isActive: true }),
    });
    await setBrandActive('hp', false, { uid: 'u1', role: 'super_admin' });
    expect(txMock.set).toHaveBeenCalledTimes(1); // audit
    expect(txMock.update).toHaveBeenCalledTimes(1);
  });
});

describe('firestoreBrandRepository — frozen API', () => {
  it('exposes the named helpers and a frozen object', () => {
    expect(firestoreBrandRepository.createBrand).toBe(createBrand);
    expect(firestoreBrandRepository.updateBrand).toBe(updateBrand);
    expect(firestoreBrandRepository.setBrandActive).toBe(setBrandActive);
    expect(Object.isFrozen(firestoreBrandRepository)).toBe(true);
  });
});
```

- [ ] **Step 9.2: Run tests to verify they fail**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/firestoreBrandRepository.test.js`
Expected: FAIL — module not found.

- [ ] **Step 9.3: Implement `src/infra/repositories/firestoreBrandRepository.js`**

Mirror the pattern from `firestoreCategoryRepository.js`. Key shape:

```javascript
import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';
import {
  BrandIdConflictError,
  sanitizeBrandInput,
} from '@/domain/brands.js';

const COLLECTION = 'brands';

function brandsRef() {
  return collection(db, COLLECTION);
}

function brandDocRef(id) {
  return doc(db, COLLECTION, id);
}

function deriveBrandId(name) {
  // Lowercase + collapse non-alphanum to '_' + trim leading/trailing '_'.
  // Same convention as subtype id derivation.
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

/**
 * Subscribe to /brands. Hooks pass `{onData, onError}` so subscription
 * errors can surface in the UI without throwing inside React.
 *
 * @param {{ onData: (brands: Brand[]) => void, onError?: (err: Error) => void }} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeToBrands({ onData, onError }) {
  return onSnapshot(
    query(brandsRef()),
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ brandId: d.id, ...d.data() }));
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
    },
  );
}

export async function createBrand(input, actor) {
  const sanitized = sanitizeBrandInput(input);
  const brandId = deriveBrandId(sanitized.name);
  if (!brandId) throw new Error('brand id derivation failed');

  const ref = brandDocRef(brandId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) throw new BrandIdConflictError(brandId);

    const after = {
      brandId,
      name: sanitized.name,
      isActive: sanitized.isActive,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.set(ref, after);

    tx.set(
      newAuditLogRef(),
      buildAuditLog({
        entity: 'brand',
        entityId: brandId,
        action: 'created',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: null,
        after: { name: after.name, isActive: after.isActive },
      })
    );
  });
  return brandId;
}

export async function updateBrand(brandId, patch, actor) {
  const ref = brandDocRef(brandId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`brand not found: ${brandId}`);
    const before = snap.data();
    const sanitized = sanitizeBrandInput({ ...before, ...patch });
    const update = {
      name: sanitized.name,
      isActive: sanitized.isActive,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.update(ref, update);
    tx.set(
      newAuditLogRef(),
      buildAuditLog({
        entity: 'brand',
        entityId: brandId,
        action: 'updated',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: { name: before.name, isActive: before.isActive },
        after: { name: sanitized.name, isActive: sanitized.isActive },
      })
    );
  });
}

export async function setBrandActive(brandId, isActive, actor) {
  const ref = brandDocRef(brandId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`brand not found: ${brandId}`);
    const before = snap.data();
    tx.update(ref, {
      isActive: Boolean(isActive),
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
    tx.set(
      newAuditLogRef(),
      buildAuditLog({
        entity: 'brand',
        entityId: brandId,
        action: 'set_active',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: { isActive: before.isActive },
        after: { isActive: Boolean(isActive) },
      })
    );
  });
}

export const firestoreBrandRepository = Object.freeze({
  subscribeToBrands,
  createBrand,
  updateBrand,
  setBrandActive,
});
```

- [ ] **Step 9.4: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/firestoreBrandRepository.test.js`
Expected: PASS.

---

### Task 10: `firestoreModelRepository`

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/infra/repositories/firestoreModelRepository.js`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/firestoreModelRepository.test.js`

- [ ] **Step 10.1: Write failing repository tests**

Create `src/test/firestoreModelRepository.test.js`. Mirror the structure of `src/test/firestoreBrandRepository.test.js` (same `vi.mock` block, same `txMock`). Test cases:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/firebase/index.js', () => ({ db: { __mock: true } }));

const txMock = { get: vi.fn(), set: vi.fn(), update: vi.fn() };

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((parent, id) => ({ __doc: id, __parent: parent })),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((field, op, value) => ({ __where: { field, op, value } })),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __sentinel: 'serverTimestamp' })),
  runTransaction: vi.fn(async (_db, fn) => fn(txMock)),
  Timestamp: { now: () => ({ __ts: 'now' }) },
}));

import * as firestore from 'firebase/firestore';
import {
  firestoreModelRepository,
  createModel,
  updateModel,
  setModelActive,
  subscribeToModels,
} from '@/infra/repositories/firestoreModelRepository.js';
import { ModelIdConflictError } from '@/domain/models.js';

beforeEach(() => {
  vi.clearAllMocks();
  txMock.get.mockReset();
  txMock.set.mockReset();
  txMock.update.mockReset();
});

describe('firestoreModelRepository — createModel', () => {
  it('writes the model and an audit log inside one transaction', async () => {
    txMock.get.mockResolvedValueOnce({ exists: () => false });
    await createModel(
      { brandId: 'hp', name: 'EliteBook 840 G6' },
      { uid: 'u1', role: 'super_admin' }
    );
    expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
    expect(txMock.set).toHaveBeenCalledTimes(2);
  });

  it('throws ModelIdConflictError when doc already exists', async () => {
    txMock.get.mockResolvedValueOnce({ exists: () => true });
    await expect(
      createModel(
        { brandId: 'hp', name: 'EliteBook 840 G6' },
        { uid: 'u1', role: 'super_admin' }
      )
    ).rejects.toBeInstanceOf(ModelIdConflictError);
  });
});

describe('firestoreModelRepository — updateModel', () => {
  it('writes the diff and an audit log', async () => {
    txMock.get.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ brandId: 'hp', name: 'EliteBook', isActive: true }),
    });
    await updateModel(
      'hp_elitebook',
      { name: 'EliteBook 840' },
      { uid: 'u1', role: 'super_admin' }
    );
    expect(txMock.set).toHaveBeenCalledTimes(1);
    expect(txMock.update).toHaveBeenCalledTimes(1);
  });
});

describe('firestoreModelRepository — subscribeToModels filters by brand', () => {
  it('builds a where(brandId == X) query when brandId is provided', () => {
    subscribeToModels({ brandId: 'hp', onData: () => {} });
    expect(firestore.where).toHaveBeenCalledWith('brandId', '==', 'hp');
  });

  it('builds an unfiltered query when brandId is omitted', () => {
    subscribeToModels({ onData: () => {} });
    expect(firestore.where).not.toHaveBeenCalled();
  });

  it('builds an unfiltered query when brandId is null', () => {
    subscribeToModels({ brandId: null, onData: () => {} });
    expect(firestore.where).not.toHaveBeenCalled();
  });
});

describe('firestoreModelRepository — frozen API', () => {
  it('exposes the named helpers and a frozen object', () => {
    expect(firestoreModelRepository.createModel).toBe(createModel);
    expect(firestoreModelRepository.updateModel).toBe(updateModel);
    expect(firestoreModelRepository.setModelActive).toBe(setModelActive);
    expect(firestoreModelRepository.subscribeToModels).toBe(subscribeToModels);
    expect(Object.isFrozen(firestoreModelRepository)).toBe(true);
  });
});
```

- [ ] **Step 10.2: Run tests to verify they fail**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/firestoreModelRepository.test.js`
Expected: FAIL — module not found.

- [ ] **Step 10.3: Implement `src/infra/repositories/firestoreModelRepository.js`**

Create the file:

```javascript
import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';
import { ModelIdConflictError, sanitizeModelInput } from '@/domain/models.js';

const COLLECTION = 'models';

function modelsRef() {
  return collection(db, COLLECTION);
}

function modelDocRef(id) {
  return doc(db, COLLECTION, id);
}

function deriveModelId(brandId, name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return `${brandId}_${slug}`;
}

/**
 * Subscribe to /models, optionally filtered by brand.
 *
 * @param {{
 *   brandId?: string|null,
 *   onData: (models: Model[]) => void,
 *   onError?: (err: Error) => void,
 * }} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeToModels({ brandId = null, onData, onError } = {}) {
  const constraints = [];
  if (brandId) constraints.push(where('brandId', '==', brandId));
  const q = query(modelsRef(), ...constraints);
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ modelId: d.id, ...d.data() }));
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
    },
  );
}

export async function createModel(input, actor) {
  const sanitized = sanitizeModelInput(input);
  if (!sanitized.brandId) throw new Error('model.brandId required');
  if (!sanitized.name) throw new Error('model.name required');
  const modelId = deriveModelId(sanitized.brandId, sanitized.name);

  const ref = modelDocRef(modelId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) throw new ModelIdConflictError(modelId);

    const after = {
      modelId,
      brandId: sanitized.brandId,
      name: sanitized.name,
      isActive: sanitized.isActive,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.set(ref, after);

    tx.set(
      newAuditLogRef(),
      buildAuditLog({
        entity: 'model',
        entityId: modelId,
        action: 'created',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: null,
        after: {
          brandId: after.brandId,
          name: after.name,
          isActive: after.isActive,
        },
      })
    );
  });
  return modelId;
}

export async function updateModel(modelId, patch, actor) {
  const ref = modelDocRef(modelId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`model not found: ${modelId}`);
    const before = snap.data();
    const sanitized = sanitizeModelInput({ ...before, ...patch });
    const update = {
      // brandId is immutable post-create
      name: sanitized.name,
      isActive: sanitized.isActive,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.update(ref, update);
    tx.set(
      newAuditLogRef(),
      buildAuditLog({
        entity: 'model',
        entityId: modelId,
        action: 'updated',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: { name: before.name, isActive: before.isActive },
        after: { name: sanitized.name, isActive: sanitized.isActive },
      })
    );
  });
}

export async function setModelActive(modelId, isActive, actor) {
  const ref = modelDocRef(modelId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`model not found: ${modelId}`);
    const before = snap.data();
    tx.update(ref, {
      isActive: Boolean(isActive),
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
    tx.set(
      newAuditLogRef(),
      buildAuditLog({
        entity: 'model',
        entityId: modelId,
        action: 'set_active',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: { isActive: before.isActive },
        after: { isActive: Boolean(isActive) },
      })
    );
  });
}

export const firestoreModelRepository = Object.freeze({
  subscribeToModels,
  createModel,
  updateModel,
  setModelActive,
});
```

- [ ] **Step 10.4: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/firestoreModelRepository.test.js`
Expected: PASS.

---

### Task 11: `firestoreLicenseSecretRepository` (with the never-leak invariant)

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/infra/repositories/firestoreLicenseSecretRepository.js`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/firestoreLicenseSecretRepository.test.js`

- [ ] **Step 11.1: Write the failing tests**

Create `src/test/firestoreLicenseSecretRepository.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/firebase/index.js', () => ({ db: { __mock: true } }));

const txMock = { get: vi.fn(), set: vi.fn() };

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((parent, ...segments) => ({ __doc: segments, __parent: parent })),
  getDoc: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __sentinel: 'serverTimestamp' })),
  runTransaction: vi.fn(async (_db, fn) => fn(txMock)),
  Timestamp: { now: () => ({ __ts: 'now' }) },
}));

import * as firestore from 'firebase/firestore';
import {
  getLicenseKey,
  setLicenseKey,
  firestoreLicenseSecretRepository,
} from '@/infra/repositories/firestoreLicenseSecretRepository.js';

beforeEach(() => {
  vi.clearAllMocks();
  txMock.get.mockReset();
  txMock.set.mockReset();
});

describe('firestoreLicenseSecretRepository — getLicenseKey', () => {
  it('returns the key value (string) when the doc exists', async () => {
    firestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ value: 'ABC-123', updatedAt: 't', updatedBy: 'u1' }),
    });
    expect(await getLicenseKey('a1')).toBe('ABC-123');
  });

  it('returns null when the doc does not exist', async () => {
    firestore.getDoc.mockResolvedValueOnce({ exists: () => false });
    expect(await getLicenseKey('a1')).toBeNull();
  });
});

describe('firestoreLicenseSecretRepository — setLicenseKey', () => {
  it('writes the secret and a sanitised audit log inside one transaction', async () => {
    txMock.get.mockResolvedValueOnce({ exists: () => false });
    await setLicenseKey('a1', 'TOP-SECRET-KEY', { uid: 'u1', role: 'tech_admin' });
    expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
    expect(txMock.set).toHaveBeenCalledTimes(2);
    const auditCallArgs = txMock.set.mock.calls.find((args) =>
      JSON.stringify(args).includes('"entity":"asset"')
    );
    expect(auditCallArgs).toBeDefined();
    expect(JSON.stringify(auditCallArgs)).not.toContain('TOP-SECRET-KEY');
  });

  it('thrown errors NEVER contain the key value', async () => {
    txMock.get.mockRejectedValueOnce(new Error('boom'));
    try {
      await setLicenseKey('a1', 'SUPER-PRIVATE-KEY', {
        uid: 'u1',
        role: 'tech_admin',
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.message).not.toContain('SUPER-PRIVATE-KEY');
    }
  });

  it('rejects empty values without ever embedding them in the error', async () => {
    await expect(
      setLicenseKey('a1', '   ', { uid: 'u1', role: 'tech_admin' })
    ).rejects.toThrow();
  });
});

describe('firestoreLicenseSecretRepository — frozen API', () => {
  it('exposes the named helpers and a frozen object', () => {
    expect(firestoreLicenseSecretRepository.getLicenseKey).toBe(getLicenseKey);
    expect(firestoreLicenseSecretRepository.setLicenseKey).toBe(setLicenseKey);
    expect(Object.isFrozen(firestoreLicenseSecretRepository)).toBe(true);
  });
});
```

- [ ] **Step 11.2: Run tests to verify they fail**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/firestoreLicenseSecretRepository.test.js`
Expected: FAIL — module not found.

- [ ] **Step 11.3: Implement `src/infra/repositories/firestoreLicenseSecretRepository.js`**

Create the file:

```javascript
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';
import {
  sanitizeLicenseSecretValue,
  validateLicenseSecretValue,
} from '@/domain/licenseSecrets.js';

const SECRET_DOC_ID = 'key';

function secretDocRef(assetId) {
  return doc(db, 'assets', assetId, 'secrets', SECRET_DOC_ID);
}

/**
 * Read the license-key value for an asset.
 *
 * Callers (UI through `useLicenseSecret`) only ever need the value
 * itself — `updatedAt` / `updatedBy` are part of the audit metadata,
 * not the user-facing surface, so we deliberately drop them here to
 * avoid accidental rendering of the key alongside metadata.
 *
 * @param {string} assetId
 * @returns {Promise<string|null>}
 */
export async function getLicenseKey(assetId) {
  const snap = await getDoc(secretDocRef(assetId));
  if (!snap.exists()) return null;
  const data = snap.data();
  return typeof data.value === 'string' ? data.value : null;
}

/**
 * Set or rotate the license key. The secret value NEVER appears in
 * the audit row; only the boolean fact-of-set/clear does. The value
 * NEVER appears in any thrown Error.message.
 */
export async function setLicenseKey(assetId, value, actor) {
  const sanitized = sanitizeLicenseSecretValue(value);
  const validationError = validateLicenseSecretValue(sanitized);
  if (validationError) {
    throw new Error(`license/${validationError}`);
  }

  const ref = secretDocRef(assetId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const before = snap.exists()
      ? { licenseKeySet: true }
      : { licenseKeySet: false };

    tx.set(ref, {
      value: sanitized,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });

    tx.set(
      newAuditLogRef(),
      buildAuditLog({
        entity: 'asset',
        entityId: assetId,
        action: snap.exists() ? 'license_key_changed' : 'license_key_set',
        actorUid: actor.uid,
        actorRole: actor.role,
        before,
        after: { licenseKeySet: true },
        relatedAssetId: assetId,
      })
    );
  });
}

export const firestoreLicenseSecretRepository = Object.freeze({
  getLicenseKey,
  setLicenseKey,
});
```

- [ ] **Step 11.4: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/firestoreLicenseSecretRepository.test.js`
Expected: PASS.

---

### Task 12: `firestoreNotificationSettingsRepository`

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/infra/repositories/firestoreNotificationSettingsRepository.js`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/firestoreNotificationSettingsRepository.test.js`

- [ ] **Step 12.1: Write the failing tests**

Create `src/test/firestoreNotificationSettingsRepository.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/firebase/index.js', () => ({ db: { __mock: true } }));

const txMock = { get: vi.fn(), set: vi.fn() };

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((parent, ...segments) => ({ __doc: segments })),
  getDoc: vi.fn(),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __sentinel: 'serverTimestamp' })),
  runTransaction: vi.fn(async (_db, fn) => fn(txMock)),
}));

import * as firestore from 'firebase/firestore';
import {
  getNotificationSettings,
  setNotificationSettings,
  subscribeToNotificationSettings,
  firestoreNotificationSettingsRepository,
} from '@/infra/repositories/firestoreNotificationSettingsRepository.js';

beforeEach(() => {
  vi.clearAllMocks();
  txMock.get.mockReset();
  txMock.set.mockReset();
});

describe('firestoreNotificationSettingsRepository — get', () => {
  it('returns the doc data when present', async () => {
    firestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ licenseExpiryWarningDays: 45 }),
    });
    expect(await getNotificationSettings()).toEqual({
      licenseExpiryWarningDays: 45,
    });
  });

  it('returns null when the doc is missing', async () => {
    firestore.getDoc.mockResolvedValueOnce({ exists: () => false });
    expect(await getNotificationSettings()).toBeNull();
  });
});

describe('firestoreNotificationSettingsRepository — set', () => {
  it('writes the doc and an audit row inside one transaction', async () => {
    txMock.get.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ licenseExpiryWarningDays: 30 }),
    });
    await setNotificationSettings(
      { licenseExpiryWarningDays: 45 },
      { uid: 'u1', role: 'super_admin' }
    );
    expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
    expect(txMock.set).toHaveBeenCalledTimes(2);
  });

  it('rejects out-of-range values', async () => {
    await expect(
      setNotificationSettings(
        { licenseExpiryWarningDays: 999 },
        { uid: 'u1', role: 'super_admin' }
      )
    ).rejects.toThrow();
  });
});

describe('firestoreNotificationSettingsRepository — frozen API', () => {
  it('exposes the named helpers and is frozen', () => {
    expect(firestoreNotificationSettingsRepository.getNotificationSettings).toBe(
      getNotificationSettings
    );
    expect(firestoreNotificationSettingsRepository.setNotificationSettings).toBe(
      setNotificationSettings
    );
    expect(firestoreNotificationSettingsRepository.subscribeToNotificationSettings).toBe(
      subscribeToNotificationSettings
    );
    expect(Object.isFrozen(firestoreNotificationSettingsRepository)).toBe(true);
  });
});
```

- [ ] **Step 12.2: Run tests to verify they fail**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/firestoreNotificationSettingsRepository.test.js`
Expected: FAIL — module not found.

- [ ] **Step 12.3: Implement `src/infra/repositories/firestoreNotificationSettingsRepository.js`**

Create the file:

```javascript
import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';
import {
  sanitizeNotificationSettingsInput,
  validateNotificationSettingsInput,
} from '@/domain/notificationSettings.js';

function settingsDocRef() {
  return doc(db, 'settings', 'notifications');
}

export async function getNotificationSettings() {
  const snap = await getDoc(settingsDocRef());
  if (!snap.exists()) return null;
  const data = snap.data();
  return { licenseExpiryWarningDays: data.licenseExpiryWarningDays };
}

/**
 * Subscribe to /settings/notifications.
 *
 * @param {{
 *   onData: (settings: { licenseExpiryWarningDays: number }|null) => void,
 *   onError?: (err: Error) => void,
 * }} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeToNotificationSettings({ onData, onError } = {}) {
  return onSnapshot(
    settingsDocRef(),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data();
      onData({ licenseExpiryWarningDays: data.licenseExpiryWarningDays });
    },
    (err) => {
      if (onError) onError(err);
    },
  );
}

export async function setNotificationSettings(input, actor) {
  const errors = validateNotificationSettingsInput(input);
  if (Object.keys(errors).length > 0) {
    throw new Error(
      `notificationSettings/${errors.licenseExpiryWarningDays || 'invalid'}`
    );
  }
  const sanitized = sanitizeNotificationSettingsInput(input);

  const ref = settingsDocRef();
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const before = snap.exists() ? { ...snap.data() } : null;

    tx.set(ref, {
      licenseExpiryWarningDays: sanitized.licenseExpiryWarningDays,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });

    tx.set(
      newAuditLogRef(),
      buildAuditLog({
        entity: 'settings',
        entityId: 'notifications',
        action: snap.exists() ? 'updated' : 'created',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: before
          ? { licenseExpiryWarningDays: before.licenseExpiryWarningDays }
          : null,
        after: { licenseExpiryWarningDays: sanitized.licenseExpiryWarningDays },
      })
    );
  });
}

export const firestoreNotificationSettingsRepository = Object.freeze({
  getNotificationSettings,
  subscribeToNotificationSettings,
  setNotificationSettings,
});
```

- [ ] **Step 12.4: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/firestoreNotificationSettingsRepository.test.js`
Expected: PASS.

---

### Task 13: `firestoreCategoryRepository` — persist `assignsInventoryCode`

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/infra/repositories/firestoreCategoryRepository.js`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/test/firestoreCategoryRepository.test.js`

- [ ] **Step 13.1: Add failing test cases**

Append to `src/test/firestoreCategoryRepository.test.js`:

```javascript
describe('firestoreCategoryRepository — assignsInventoryCode persistence', () => {
  it('writes assignsInventoryCode=true on createCategory by default', async () => {
    txMock.get.mockResolvedValueOnce({ exists: () => false });
    await createCategory(
      {
        name: { ru: 'X', en: 'X', hy: 'X' },
        inventoryCodePrefix: 'X1',
        attachableTo: ['warehouse'],
      },
      { uid: 'u1', role: 'super_admin' }
    );
    const setCalls = txMock.set.mock.calls;
    const catCall = setCalls.find((args) => args[1]?.inventoryCodePrefix === 'X1');
    expect(catCall[1].assignsInventoryCode).toBe(true);
  });

  it('persists assignsInventoryCode=false when caller provides it', async () => {
    txMock.get.mockResolvedValueOnce({ exists: () => false });
    await createCategory(
      {
        name: { ru: 'License', en: 'License', hy: 'License' },
        inventoryCodePrefix: 'LIC',
        attachableTo: ['warehouse', 'employee'],
        requiresMultilang: false,
        assignsInventoryCode: false,
      },
      { uid: 'u1', role: 'super_admin' }
    );
    const setCalls = txMock.set.mock.calls;
    const catCall = setCalls.find((args) => args[1]?.inventoryCodePrefix === 'LIC');
    expect(catCall[1].assignsInventoryCode).toBe(false);
  });

  it('updateCategory passes assignsInventoryCode through', async () => {
    txMock.get.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        name: { ru: 'X', en: 'X', hy: 'X' },
        inventoryCodePrefix: 'X1',
        requiresMultilang: true,
        attachableTo: ['warehouse'],
        assignsInventoryCode: true,
        isActive: true,
      }),
    });
    await updateCategory(
      'cat1',
      { assignsInventoryCode: false },
      { uid: 'u1', role: 'super_admin' }
    );
    const updateCall = txMock.update.mock.calls[0];
    expect(updateCall[1].assignsInventoryCode).toBe(false);
  });
});
```

- [ ] **Step 13.2: Run tests to verify they fail**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/firestoreCategoryRepository.test.js`
Expected: FAIL on the three new cases.

- [ ] **Step 13.3: Update `firestoreCategoryRepository.js`**

In `src/infra/repositories/firestoreCategoryRepository.js`:

- In `createCategory`: add `assignsInventoryCode: sanitized.assignsInventoryCode` to the `after` object that goes into `tx.set(catRef, after)`.
- In `updateCategory`: add `assignsInventoryCode: sanitized.assignsInventoryCode` to the update payload, and add it to both the `before` and `after` snapshots passed to `buildAuditLog`.

Locate the existing `after` object in `createCategory` (it contains `inventoryCodePrefix`, `requiresMultilang`, `attachableTo`). Add `assignsInventoryCode` next to those. Same in `updateCategory`'s update payload and audit snapshots.

- [ ] **Step 13.4: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/firestoreCategoryRepository.test.js`
Expected: PASS.

---

### Task 14: `firestoreAssetRepository` — skip counter when category opts out, coordinate license-secret write, drop `brand`/`model` from audit

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/infra/repositories/firestoreAssetRepository.js`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/test/firestoreAssetRepository.test.js`

- [ ] **Step 14.1: Add failing test cases**

Append to `src/test/firestoreAssetRepository.test.js`:

```javascript
describe('firestoreAssetRepository — license categories skip counter', () => {
  it('does NOT touch category_counters when category.assignsInventoryCode === false', async () => {
    txMock.get.mockImplementation(async (ref) => {
      const seg = Array.isArray(ref?.__doc) ? ref.__doc[0] : ref?.__doc;
      if (seg === 'license') {
        return {
          exists: () => true,
          data: () => ({
            categoryId: 'license',
            inventoryCodePrefix: 'LIC',
            requiresMultilang: false,
            attachableTo: ['warehouse', 'employee'],
            assignsInventoryCode: false,
            isActive: true,
          }),
        };
      }
      return { exists: () => false };
    });
    await createAsset(
      {
        categoryId: 'license',
        subtypeId: 'license_windows',
        statusId: 'warehouse',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b1',
        condition: 'new',
        licenseType: 'business',
        subscribedAt: new Date('2026-01-01'),
        expiresAt: new Date('2027-01-01'),
      },
      { uid: 'u1', role: 'super_admin' }
    );
    const counterUpdate = txMock.update.mock.calls.find((args) =>
      JSON.stringify(args).includes('category_counters')
    );
    expect(counterUpdate).toBeUndefined();
  });

  it('writes inventoryCode=null on the asset doc when category opts out', async () => {
    txMock.get.mockImplementation(async (ref) => {
      const seg = Array.isArray(ref?.__doc) ? ref.__doc[0] : ref?.__doc;
      if (seg === 'license') {
        return {
          exists: () => true,
          data: () => ({
            categoryId: 'license',
            inventoryCodePrefix: 'LIC',
            requiresMultilang: false,
            attachableTo: ['warehouse', 'employee'],
            assignsInventoryCode: false,
            isActive: true,
          }),
        };
      }
      return { exists: () => false };
    });
    await createAsset(
      {
        categoryId: 'license',
        subtypeId: 'license_windows',
        statusId: 'warehouse',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b1',
        condition: 'new',
        licenseType: 'business',
        subscribedAt: new Date('2026-01-01'),
        expiresAt: new Date('2027-01-01'),
      },
      { uid: 'u1', role: 'super_admin' }
    );
    const assetSetCall = txMock.set.mock.calls.find(
      (args) => args[1]?.categoryId === 'license'
    );
    expect(assetSetCall[1].inventoryCode).toBeNull();
  });

  it('writes the license-secret doc inside the same transaction when licenseKey provided', async () => {
    txMock.get.mockImplementation(async (ref) => {
      const seg = Array.isArray(ref?.__doc) ? ref.__doc[0] : ref?.__doc;
      if (seg === 'license') {
        return {
          exists: () => true,
          data: () => ({
            categoryId: 'license',
            inventoryCodePrefix: 'LIC',
            requiresMultilang: false,
            attachableTo: ['warehouse', 'employee'],
            assignsInventoryCode: false,
            isActive: true,
          }),
        };
      }
      return { exists: () => false };
    });
    await createAsset(
      {
        categoryId: 'license',
        subtypeId: 'license_windows',
        statusId: 'warehouse',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b1',
        condition: 'new',
        licenseType: 'business',
        subscribedAt: new Date('2026-01-01'),
        expiresAt: new Date('2027-01-01'),
        licenseKey: 'TOP-SECRET-VALUE',
      },
      { uid: 'u1', role: 'super_admin' }
    );
    const setCalls = txMock.set.mock.calls;
    expect(setCalls.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(setCalls)).not.toContain('TOP-SECRET-VALUE');
  });
});

describe('firestoreAssetRepository — auditSnapshot omits brand/model strings', () => {
  it('audit before/after never contain free-text brand/model fields', async () => {
    txMock.get.mockImplementation(async (ref) => {
      const seg = Array.isArray(ref?.__doc) ? ref.__doc[0] : ref?.__doc;
      if (seg === 'device') {
        return {
          exists: () => true,
          data: () => ({
            categoryId: 'device',
            inventoryCodePrefix: '450',
            requiresMultilang: false,
            attachableTo: ['warehouse', 'employee', 'branch', 'department'],
            assignsInventoryCode: true,
            isActive: true,
          }),
        };
      }
      return { exists: () => true, data: () => ({ next: 1 }) };
    });
    await createAsset(
      {
        categoryId: 'device',
        subtypeId: 'device_laptop',
        statusId: 'warehouse',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b1',
        condition: 'new',
        brandId: 'hp',
        modelId: 'hp_elitebook',
      },
      { uid: 'u1', role: 'super_admin' }
    );
    const auditCall = txMock.set.mock.calls.find(
      (args) => args[1]?.entity === 'asset'
    );
    expect(auditCall[1].after).toBeDefined();
    expect('brand' in auditCall[1].after).toBe(false);
    expect('model' in auditCall[1].after).toBe(false);
    expect(auditCall[1].after.brandId).toBe('hp');
    expect(auditCall[1].after.modelId).toBe('hp_elitebook');
  });
});
```

- [ ] **Step 14.2: Run tests to verify they fail**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/firestoreAssetRepository.test.js`
Expected: FAIL on the new cases.

- [ ] **Step 14.3: Update `firestoreAssetRepository.js`**

Edit `src/infra/repositories/firestoreAssetRepository.js`:

1. **In `auditSnapshot`** — replace the `brand` / `model` field plucks with these:

```javascript
brandId: doc.brandId ?? null,
modelId: doc.modelId ?? null,
licenseType: doc.licenseType ?? null,
subscribedAt: doc.subscribedAt?.toMillis?.() ?? null,
expiresAt: doc.expiresAt?.toMillis?.() ?? null,
```

NEVER add `licenseKey` to the snapshot.

2. **In `createAsset`** — read the category inside the transaction (existing pattern) and branch on `assignsInventoryCode`:

```javascript
const wantsCode = category.assignsInventoryCode !== false; // default true
let inventoryCode = null;
if (wantsCode) {
  const counterRef = doc(db, 'category_counters', categoryId);
  const counterSnap = await tx.get(counterRef);
  if (!counterSnap.exists()) throw new AssetCounterMissingError(categoryId);
  const next = counterSnap.data().next ?? 1;
  inventoryCode = formatInventoryCode(category.inventoryCodePrefix, next);
  tx.update(counterRef, { next: next + 1 });
}
```

The asset doc's `inventoryCode` field is set to this `inventoryCode` value (either a string or `null`).

3. **Persist license fields** on the asset doc when present: convert dates with `Timestamp.fromDate(date)`. Pseudocode at the build-doc site:

```javascript
const isLicense = categoryId === 'license';
const licenseFields = isLicense
  ? {
      licenseType: sanitized.licenseType,
      subscribedAt: sanitized.subscribedAt
        ? Timestamp.fromDate(sanitized.subscribedAt)
        : null,
      expiresAt: sanitized.expiresAt
        ? Timestamp.fromDate(sanitized.expiresAt)
        : null,
    }
  : { licenseType: null, subscribedAt: null, expiresAt: null };
```

Spread `licenseFields` into the asset doc body alongside the existing fields.

4. **Drop `brand` / `model` writes** from the create/update bodies. Replace with `brandId: sanitized.brandId, modelId: sanitized.modelId`.

5. **Coordinate license-secret write** — after the asset `tx.set(assetRef, after)`, add:

```javascript
const licenseKey =
  typeof input.licenseKey === 'string' ? input.licenseKey.trim() : '';
if (isLicense && licenseKey.length > 0) {
  const sanitizedKey = sanitizeLicenseSecretValue(licenseKey);
  const secretRef = doc(db, 'assets', assetRef.id, 'secrets', 'key');
  tx.set(secretRef, {
    value: sanitizedKey,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });
  tx.set(
    newAuditLogRef(),
    buildAuditLog({
      entity: 'asset',
      entityId: assetRef.id,
      action: 'license_key_set',
      actorUid: actor.uid,
      actorRole: actor.role,
      before: { licenseKeySet: false },
      after: { licenseKeySet: true },
      relatedAssetId: assetRef.id,
    })
  );
}
```

Imports needed at the top of the file: `sanitizeLicenseSecretValue` from `@/domain/licenseSecrets.js` and `Timestamp` from `firebase/firestore`.

6. **Apply the same field changes to `updateAsset`** — drop `brand`/`model`, add `brandId`/`modelId`/license fields. License-secret update on edit is handled by a separate `LicenseKeyDialog` (Task 31), NOT by the asset update path — so `updateAsset` must explicitly NOT touch the secret doc, even if `input.licenseKey` is present.

- [ ] **Step 14.4: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/firestoreAssetRepository.test.js`
Expected: PASS.

- [ ] **Step 14.5: Run the full test suite to surface remaining downstream breakage**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run`
Expected: many UI tests still failing because they reference `brand`/`model`. They will be fixed in Tasks 35–40. Repository-level and domain-level tests should all be green at this point.

---

### Task 15: Firestore rules — `/brands/{brandId}` block + mirror test

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/firestore.rules`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/brands.rulesMirror.test.js`

- [ ] **Step 15.1: Write the failing rules-mirror tests**

Mirror the predicate logic of the rules block in pure JS. Pattern source: `src/test/assets.rulesMirror.test.js`. Create `src/test/brands.rulesMirror.test.js`:

```javascript
import { describe, it, expect } from 'vitest';

function isAdmin(role) {
  return ['super_admin', 'asset_admin', 'tech_admin'].includes(role);
}
function isSuperAdmin(role) {
  return role === 'super_admin';
}

function canReadBrand({ role }) {
  return isAdmin(role);
}

function canCreateBrand({ role, data, uid, now }) {
  return (
    isSuperAdmin(role) &&
    typeof data.name === 'string' &&
    data.name.length > 0 &&
    typeof data.isActive === 'boolean' &&
    data.createdBy === uid &&
    data.createdAt === now
  );
}

function canUpdateBrand({ role, before, after }) {
  if (!isSuperAdmin(role)) return false;
  const allowed = new Set(['name', 'isActive', 'updatedAt', 'updatedBy']);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (
      JSON.stringify(before[k]) !== JSON.stringify(after[k]) &&
      !allowed.has(k)
    )
      return false;
  }
  return true;
}

function canDeleteBrand() {
  return false;
}

describe('brands rules mirror — read', () => {
  it.each([
    ['super_admin', true],
    ['asset_admin', true],
    ['tech_admin', true],
    ['employee', false],
    [null, false],
  ])('role=%s → canRead=%s', (role, expected) => {
    expect(canReadBrand({ role })).toBe(expected);
  });
});

describe('brands rules mirror — create', () => {
  const baseData = {
    name: 'HP',
    isActive: true,
    createdBy: 'u1',
    createdAt: 'now',
  };

  it('only super_admin can create', () => {
    expect(
      canCreateBrand({ role: 'super_admin', data: baseData, uid: 'u1', now: 'now' })
    ).toBe(true);
    expect(
      canCreateBrand({ role: 'asset_admin', data: baseData, uid: 'u1', now: 'now' })
    ).toBe(false);
  });

  it('rejects empty name', () => {
    expect(
      canCreateBrand({
        role: 'super_admin',
        data: { ...baseData, name: '' },
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
  });

  it('rejects mismatched createdBy/auth.uid', () => {
    expect(
      canCreateBrand({
        role: 'super_admin',
        data: baseData,
        uid: 'u2',
        now: 'now',
      })
    ).toBe(false);
  });
});

describe('brands rules mirror — update', () => {
  it('super_admin can update name and isActive', () => {
    expect(
      canUpdateBrand({
        role: 'super_admin',
        before: { name: 'HP', isActive: true },
        after: { name: 'HP Inc.', isActive: true, updatedAt: 'now', updatedBy: 'u1' },
      })
    ).toBe(true);
  });

  it('non-super_admin cannot update', () => {
    expect(
      canUpdateBrand({
        role: 'asset_admin',
        before: { name: 'HP' },
        after: { name: 'HP Inc.' },
      })
    ).toBe(false);
  });

  it('rejects updates that touch unsupported keys', () => {
    expect(
      canUpdateBrand({
        role: 'super_admin',
        before: { name: 'HP', createdBy: 'u1' },
        after: { name: 'HP', createdBy: 'u2' },
      })
    ).toBe(false);
  });
});

describe('brands rules mirror — delete is forbidden', () => {
  it('always returns false', () => {
    expect(canDeleteBrand()).toBe(false);
  });
});
```

- [ ] **Step 15.2: Run tests to verify they pass — they assert the predicate behaviour we are about to write into rules**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/brands.rulesMirror.test.js`
Expected: PASS — these are pure-JS predicates inside the test file.

- [ ] **Step 15.3: Add the `/brands/{brandId}` block to `firestore.rules`**

Open `firestore.rules` and find the section with the existing `/categories/{categoryId}` block. Add a sibling block:

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
```

- [ ] **Step 15.4: Re-run the mirror test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/brands.rulesMirror.test.js`
Expected: PASS.

---

### Task 16: Firestore rules — `/models/{modelId}` block + mirror test

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/firestore.rules`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/models.rulesMirror.test.js`

- [ ] **Step 16.1: Write the failing rules-mirror tests**

Create `src/test/models.rulesMirror.test.js`:

```javascript
import { describe, it, expect } from 'vitest';

function isAdmin(role) {
  return ['super_admin', 'asset_admin', 'tech_admin'].includes(role);
}
function isSuperAdmin(role) {
  return role === 'super_admin';
}

function canReadModel({ role }) {
  return isAdmin(role);
}

function canCreateModel({ role, data, brandsExist, uid, now }) {
  return (
    isSuperAdmin(role) &&
    typeof data.brandId === 'string' &&
    data.brandId.length > 0 &&
    typeof data.name === 'string' &&
    data.name.length > 0 &&
    typeof data.isActive === 'boolean' &&
    data.createdBy === uid &&
    data.createdAt === now &&
    brandsExist.includes(data.brandId)
  );
}

function canUpdateModel({ role, before, after }) {
  if (!isSuperAdmin(role)) return false;
  const allowed = new Set(['name', 'isActive', 'updatedAt', 'updatedBy']);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (
      JSON.stringify(before[k]) !== JSON.stringify(after[k]) &&
      !allowed.has(k)
    )
      return false;
  }
  return true;
}

function canDeleteModel() {
  return false;
}

describe('models rules mirror — read', () => {
  it.each([
    ['super_admin', true],
    ['asset_admin', true],
    ['tech_admin', true],
    ['employee', false],
    [null, false],
  ])('role=%s → canRead=%s', (role, expected) => {
    expect(canReadModel({ role })).toBe(expected);
  });
});

describe('models rules mirror — create', () => {
  const data = {
    brandId: 'hp',
    name: 'EliteBook',
    isActive: true,
    createdBy: 'u1',
    createdAt: 'now',
  };

  it('super_admin can create when the brand exists', () => {
    expect(
      canCreateModel({
        role: 'super_admin',
        data,
        brandsExist: ['hp'],
        uid: 'u1',
        now: 'now',
      })
    ).toBe(true);
  });

  it('rejects when the referenced brand does not exist', () => {
    expect(
      canCreateModel({
        role: 'super_admin',
        data,
        brandsExist: [],
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
  });

  it('rejects empty brandId or name', () => {
    expect(
      canCreateModel({
        role: 'super_admin',
        data: { ...data, brandId: '' },
        brandsExist: ['hp'],
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
    expect(
      canCreateModel({
        role: 'super_admin',
        data: { ...data, name: '' },
        brandsExist: ['hp'],
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
  });
});

describe('models rules mirror — update', () => {
  it('rejects brandId mutations', () => {
    expect(
      canUpdateModel({
        role: 'super_admin',
        before: { brandId: 'hp', name: 'X' },
        after: { brandId: 'lenovo', name: 'X' },
      })
    ).toBe(false);
  });
});

describe('models rules mirror — delete is forbidden', () => {
  it('always returns false', () => {
    expect(canDeleteModel()).toBe(false);
  });
});
```

- [ ] **Step 16.2: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/models.rulesMirror.test.js`
Expected: PASS.

- [ ] **Step 16.3: Add the `/models/{modelId}` block to `firestore.rules`**

Add (next to the new `/brands/{brandId}` block):

```text
match /models/{modelId} {
  allow read:   if isAdmin();
  allow create: if isSuperAdmin()
                && request.resource.data.brandId is string
                && request.resource.data.brandId.size() > 0
                && request.resource.data.name is string
                && request.resource.data.name.size() > 0
                && request.resource.data.isActive is bool
                && request.resource.data.createdBy == request.auth.uid
                && request.resource.data.createdAt == request.time
                && exists(/databases/$(database)/documents/brands/$(request.resource.data.brandId));
  allow update: if isSuperAdmin()
                && request.resource.data.diff(resource.data).affectedKeys()
                   .hasOnly(['name', 'isActive', 'updatedAt', 'updatedBy']);
  allow delete: if false;
}
```

- [ ] **Step 16.4: Re-run the mirror test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/models.rulesMirror.test.js`
Expected: PASS.

---

### Task 17: Firestore rules — `/assets/{aid}/secrets/{any}` block + mirror test

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/firestore.rules`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/licenseSecrets.rulesMirror.test.js`

- [ ] **Step 17.1: Write the failing rules-mirror tests**

Create `src/test/licenseSecrets.rulesMirror.test.js`:

```javascript
import { describe, it, expect } from 'vitest';

function isSuperAdmin(role) {
  return role === 'super_admin';
}
function isTechAdmin(role) {
  return role === 'tech_admin';
}

function canReadSecret({ role }) {
  return isSuperAdmin(role) || isTechAdmin(role);
}

function canCreateSecret({ role, secretId, data, uid, now }) {
  return (
    (isSuperAdmin(role) || isTechAdmin(role)) &&
    secretId === 'key' &&
    typeof data.value === 'string' &&
    data.value.length > 0 &&
    data.value.length <= 4096 &&
    data.updatedBy === uid &&
    data.updatedAt === now
  );
}

function canUpdateSecret({ role, before, after }) {
  if (!(isSuperAdmin(role) || isTechAdmin(role))) return false;
  const allowed = new Set(['value', 'updatedAt', 'updatedBy']);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (
      JSON.stringify(before[k]) !== JSON.stringify(after[k]) &&
      !allowed.has(k)
    )
      return false;
  }
  return true;
}

function canDeleteSecret() {
  return false;
}

describe('licenseSecrets rules mirror — read', () => {
  it.each([
    ['super_admin', true],
    ['tech_admin', true],
    ['asset_admin', false],
    ['employee', false],
    [null, false],
  ])('role=%s → canRead=%s', (role, expected) => {
    expect(canReadSecret({ role })).toBe(expected);
  });
});

describe('licenseSecrets rules mirror — create', () => {
  const baseData = { value: 'ABC-123', updatedBy: 'u1', updatedAt: 'now' };

  it('super_admin and tech_admin can create with secretId="key"', () => {
    expect(
      canCreateSecret({
        role: 'super_admin',
        secretId: 'key',
        data: baseData,
        uid: 'u1',
        now: 'now',
      })
    ).toBe(true);
    expect(
      canCreateSecret({
        role: 'tech_admin',
        secretId: 'key',
        data: baseData,
        uid: 'u1',
        now: 'now',
      })
    ).toBe(true);
  });

  it('asset_admin cannot create', () => {
    expect(
      canCreateSecret({
        role: 'asset_admin',
        secretId: 'key',
        data: baseData,
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
  });

  it('rejects secretId !== "key"', () => {
    expect(
      canCreateSecret({
        role: 'super_admin',
        secretId: 'archive',
        data: baseData,
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
  });

  it('rejects empty or oversized values', () => {
    expect(
      canCreateSecret({
        role: 'super_admin',
        secretId: 'key',
        data: { ...baseData, value: '' },
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
    expect(
      canCreateSecret({
        role: 'super_admin',
        secretId: 'key',
        data: { ...baseData, value: 'X'.repeat(4097) },
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
  });
});

describe('licenseSecrets rules mirror — delete is forbidden', () => {
  it('always returns false', () => {
    expect(canDeleteSecret()).toBe(false);
  });
});
```

- [ ] **Step 17.2: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/licenseSecrets.rulesMirror.test.js`
Expected: PASS.

- [ ] **Step 17.3: Add the `/assets/{assetId}/secrets/{secretId}` block to `firestore.rules`**

Add the block. If `firestore.rules` declares sub-collection rules nested inside their parent's `match`, nest it inside `/assets/{assetId}`. Otherwise declare at top level with the full path:

```text
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
```

- [ ] **Step 17.4: Re-run the mirror test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/licenseSecrets.rulesMirror.test.js`
Expected: PASS.

---

### Task 18: Firestore rules — `/settings/notifications` block + mirror test

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/firestore.rules`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/notificationSettings.rulesMirror.test.js`

- [ ] **Step 18.1: Write the failing rules-mirror tests**

Create `src/test/notificationSettings.rulesMirror.test.js`:

```javascript
import { describe, it, expect } from 'vitest';

function isAdmin(role) {
  return ['super_admin', 'asset_admin', 'tech_admin'].includes(role);
}
function isSuperAdmin(role) {
  return role === 'super_admin';
}

function canReadNotificationSettings({ role }) {
  return isAdmin(role);
}

function canWriteNotificationSettings({ role, data, uid, now }) {
  return (
    isSuperAdmin(role) &&
    Number.isInteger(data.licenseExpiryWarningDays) &&
    data.licenseExpiryWarningDays >= 1 &&
    data.licenseExpiryWarningDays <= 365 &&
    data.updatedBy === uid &&
    data.updatedAt === now
  );
}

describe('notificationSettings rules mirror — read', () => {
  it.each([
    ['super_admin', true],
    ['asset_admin', true],
    ['tech_admin', true],
    ['employee', false],
    [null, false],
  ])('role=%s → canRead=%s', (role, expected) => {
    expect(canReadNotificationSettings({ role })).toBe(expected);
  });
});

describe('notificationSettings rules mirror — write', () => {
  const data = {
    licenseExpiryWarningDays: 30,
    updatedBy: 'u1',
    updatedAt: 'now',
  };

  it('super_admin can write valid values', () => {
    expect(
      canWriteNotificationSettings({
        role: 'super_admin',
        data,
        uid: 'u1',
        now: 'now',
      })
    ).toBe(true);
  });

  it('non-super_admin cannot write', () => {
    expect(
      canWriteNotificationSettings({
        role: 'asset_admin',
        data,
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
  });

  it('rejects out-of-range values', () => {
    expect(
      canWriteNotificationSettings({
        role: 'super_admin',
        data: { ...data, licenseExpiryWarningDays: 0 },
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
    expect(
      canWriteNotificationSettings({
        role: 'super_admin',
        data: { ...data, licenseExpiryWarningDays: 366 },
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
  });

  it('rejects non-integer values', () => {
    expect(
      canWriteNotificationSettings({
        role: 'super_admin',
        data: { ...data, licenseExpiryWarningDays: 30.5 },
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
  });
});
```

- [ ] **Step 18.2: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/notificationSettings.rulesMirror.test.js`
Expected: PASS.

- [ ] **Step 18.3: Add the `/settings/notifications` block to `firestore.rules`**

Find the existing `/settings/{document}` or `/settings/auth` rule. Add a more-specific sibling:

```text
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

If `firestore.rules` already has a generic `/settings/{document}` match, list the more-specific rule BEFORE the generic one to make precedence explicit.

- [ ] **Step 18.4: Re-run the mirror test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/notificationSettings.rulesMirror.test.js`
Expected: PASS.

---

### Task 19: Firestore rules — update `/assets/{assetId}` validators for the new shape

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/firestore.rules`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/test/assets.rulesMirror.test.js`

- [ ] **Step 19.1: Add failing test cases for the new asset shape**

Append to `src/test/assets.rulesMirror.test.js`:

```javascript
describe('assets rules mirror — brandId/modelId replace brand/model', () => {
  function isAssetShapeValid(data) {
    if ('brand' in data) return false;
    if ('model' in data) return false;
    if (!(data.brandId === null || typeof data.brandId === 'string')) return false;
    if (!(data.modelId === null || typeof data.modelId === 'string')) return false;
    return true;
  }

  it('rejects assets with legacy brand/model strings', () => {
    expect(isAssetShapeValid({ brand: 'HP' })).toBe(false);
    expect(isAssetShapeValid({ model: 'EliteBook' })).toBe(false);
  });

  it('accepts assets with brandId/modelId or null', () => {
    expect(isAssetShapeValid({ brandId: 'hp', modelId: 'hp_elitebook' })).toBe(true);
    expect(isAssetShapeValid({ brandId: null, modelId: null })).toBe(true);
  });
});

describe('assets rules mirror — inventoryCode is nullable', () => {
  function isInventoryCodeValid(value) {
    if (value === null) return true;
    return typeof value === 'string' && /^[A-Z0-9]+\/[0-9]+$/.test(value);
  }

  it('accepts null', () => {
    expect(isInventoryCodeValid(null)).toBe(true);
  });

  it('accepts valid PREFIX/NUMBER strings', () => {
    expect(isInventoryCodeValid('450/1')).toBe(true);
  });

  it('rejects invalid strings', () => {
    expect(isInventoryCodeValid('lowercase/1')).toBe(false);
    expect(isInventoryCodeValid('450')).toBe(false);
  });
});

describe('assets rules mirror — license-conditional fields', () => {
  function isLicenseShapeValid(data) {
    if (data.categoryId !== 'license') {
      return (
        data.licenseType == null &&
        data.subscribedAt == null &&
        data.expiresAt == null
      );
    }
    if (!['personal', 'business', 'enterprise'].includes(data.licenseType))
      return false;
    if (typeof data.subscribedAt !== 'object' || data.subscribedAt === null)
      return false;
    if (typeof data.expiresAt !== 'object' || data.expiresAt === null)
      return false;
    return true;
  }

  it('non-license assets must have null license fields', () => {
    expect(
      isLicenseShapeValid({
        categoryId: 'device',
        licenseType: null,
        subscribedAt: null,
        expiresAt: null,
      })
    ).toBe(true);
    expect(
      isLicenseShapeValid({
        categoryId: 'device',
        licenseType: 'business',
        subscribedAt: null,
        expiresAt: null,
      })
    ).toBe(false);
  });

  it('license assets require all three fields', () => {
    expect(
      isLicenseShapeValid({
        categoryId: 'license',
        licenseType: 'business',
        subscribedAt: { __ts: 't1' },
        expiresAt: { __ts: 't2' },
      })
    ).toBe(true);
    expect(
      isLicenseShapeValid({
        categoryId: 'license',
        licenseType: 'invalid',
        subscribedAt: { __ts: 't1' },
        expiresAt: { __ts: 't2' },
      })
    ).toBe(false);
  });
});
```

- [ ] **Step 19.2: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/assets.rulesMirror.test.js`
Expected: PASS — pure-JS predicate tests.

- [ ] **Step 19.3: Update `firestore.rules` `/assets/{assetId}` validators**

In `firestore.rules`:

1. Locate `isValidInventoryCode(value)` and replace its invocation with `(request.resource.data.inventoryCode == null || isValidInventoryCode(request.resource.data.inventoryCode))`.

2. Remove `isAsciiOrNull(brand)` / `isAsciiOrNull(model)` predicates inside the assets create/update validators.

3. Add new shape checks:
   - `(request.resource.data.brandId == null || request.resource.data.brandId is string)`
   - `(request.resource.data.modelId == null || request.resource.data.modelId is string)`

4. Loosen the `name` validator to also accept `null`. Replace any direct `isValidAssetName(...)` invocation with `(request.resource.data.name == null || isValidAssetName(request.resource.data.name))`.

5. Add license-conditional validators. Use a ternary on `request.resource.data.categoryId == 'license'`:

```text
&& (request.resource.data.categoryId == 'license'
      ? (
          request.resource.data.licenseType in ['personal', 'business', 'enterprise']
          && request.resource.data.subscribedAt is timestamp
          && request.resource.data.expiresAt is timestamp
          && request.resource.data.expiresAt > request.resource.data.subscribedAt
        )
      : (
          request.resource.data.licenseType == null
          && request.resource.data.subscribedAt == null
          && request.resource.data.expiresAt == null
        )
   )
```

Apply the same predicate to both `allow create` and `allow update`. For `update`, replace `request.resource.data.categoryId` with `resource.data.categoryId` (since `categoryId` is immutable).

- [ ] **Step 19.4: Re-run the mirror test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/assets.rulesMirror.test.js`
Expected: PASS.

---

### Task 20: Firestore rules — accept `assignsInventoryCode` on `/categories/{id}` writes

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/firestore.rules`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/test/categories.rulesMirror.test.js`

- [ ] **Step 20.1: Add failing test cases**

Append to `src/test/categories.rulesMirror.test.js`:

```javascript
describe('categories rules mirror — assignsInventoryCode is allowed', () => {
  function isCategoryShapeValid(data) {
    if (typeof data.assignsInventoryCode !== 'boolean') return false;
    return true;
  }

  it('requires assignsInventoryCode to be a boolean on create', () => {
    expect(isCategoryShapeValid({ assignsInventoryCode: true })).toBe(true);
    expect(isCategoryShapeValid({ assignsInventoryCode: false })).toBe(true);
    expect(isCategoryShapeValid({ assignsInventoryCode: 'yes' })).toBe(false);
    expect(isCategoryShapeValid({})).toBe(false);
  });
});
```

- [ ] **Step 20.2: Run tests to verify they pass**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/categories.rulesMirror.test.js`
Expected: PASS.

- [ ] **Step 20.3: Update `firestore.rules` `/categories/{id}` block**

In the categories create / update validator add:

```text
&& request.resource.data.assignsInventoryCode is bool
```

For update, the `affectedKeys().hasOnly([...])` list must include `'assignsInventoryCode'`.

- [ ] **Step 20.4: Re-run the mirror test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/categories.rulesMirror.test.js`
Expected: PASS.

---

## Hook layer (Tasks 21–24)

### Task 21: `useBrands` hook

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/hooks/useBrands.js`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/hooks/useBrands.test.jsx`

- [ ] **Step 21.1: Write the failing test**

```javascript
// src/hooks/useBrands.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const subscribeToBrandsMock = vi.fn();
vi.mock('@/infra/repositories/firestoreBrandRepository.js', () => ({
  subscribeToBrands: (...args) => subscribeToBrandsMock(...args),
}));

import { useBrands } from './useBrands.js';

describe('useBrands', () => {
  beforeEach(() => {
    subscribeToBrandsMock.mockReset();
  });

  it('starts in loading state with empty data', () => {
    subscribeToBrandsMock.mockImplementation(() => () => {});
    const { result } = renderHook(() => useBrands());
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBe(null);
  });

  it('exposes brands once the subscription pushes them', () => {
    let pushSnapshot = null;
    subscribeToBrandsMock.mockImplementation(({ onData }) => {
      pushSnapshot = onData;
      return () => {};
    });
    const { result } = renderHook(() => useBrands());
    act(() => {
      pushSnapshot([
        { brandId: 'b1', name: 'HP', isActive: true },
        { brandId: 'b2', name: 'Dell', isActive: true },
      ]);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data[0].name).toBe('HP');
  });

  it('records errors from the subscription', () => {
    let pushError = null;
    subscribeToBrandsMock.mockImplementation(({ onError }) => {
      pushError = onError;
      return () => {};
    });
    const { result } = renderHook(() => useBrands());
    act(() => {
      pushError(new Error('boom'));
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('unsubscribes on unmount', () => {
    const unsub = vi.fn();
    subscribeToBrandsMock.mockImplementation(() => unsub);
    const { unmount } = renderHook(() => useBrands());
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 21.2: Run the test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/hooks/useBrands.test.jsx`
Expected: FAIL with "Cannot find module './useBrands.js'".

- [ ] **Step 21.3: Implement the hook**

```javascript
// src/hooks/useBrands.js
import { useEffect, useState } from 'react';
import { subscribeToBrands } from '@/infra/repositories/firestoreBrandRepository.js';

/**
 * Reactive hook over the `/brands` collection.
 * @returns {{ data: Array, loading: boolean, error: Error|null }}
 */
export function useBrands() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribe = subscribeToBrands({
      onData: (rows) => {
        setData(rows);
        setLoading(false);
        setError(null);
      },
      onError: (err) => {
        setError(err);
        setLoading(false);
      },
    });
    return unsubscribe;
  }, []);

  return { data, loading, error };
}
```

- [ ] **Step 21.4: Run the test to verify it passes**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/hooks/useBrands.test.jsx`
Expected: PASS.

- [ ] **Step 21.5: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/hooks/useBrands.js src/hooks/useBrands.test.jsx`
Expected: 0 errors.

---

### Task 22: `useModels` hook

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/hooks/useModels.js`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/hooks/useModels.test.jsx`

The hook accepts an optional `brandId` argument. When `brandId` is `null`, the hook subscribes to all models. When `brandId` is a string, it subscribes only to models with `brandId === brandId`.

- [ ] **Step 22.1: Write the failing test**

```javascript
// src/hooks/useModels.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const subscribeToModelsMock = vi.fn();
vi.mock('@/infra/repositories/firestoreModelRepository.js', () => ({
  subscribeToModels: (...args) => subscribeToModelsMock(...args),
}));

import { useModels } from './useModels.js';

describe('useModels', () => {
  beforeEach(() => {
    subscribeToModelsMock.mockReset();
  });

  it('passes brandId filter through to the repository', () => {
    subscribeToModelsMock.mockImplementation(() => () => {});
    renderHook(() => useModels({ brandId: 'b1' }));
    expect(subscribeToModelsMock).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: 'b1' }),
    );
  });

  it('subscribes with brandId=null when called with no argument', () => {
    subscribeToModelsMock.mockImplementation(() => () => {});
    renderHook(() => useModels());
    expect(subscribeToModelsMock).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: null }),
    );
  });

  it('publishes pushed rows', () => {
    let pushSnapshot = null;
    subscribeToModelsMock.mockImplementation(({ onData }) => {
      pushSnapshot = onData;
      return () => {};
    });
    const { result } = renderHook(() => useModels({ brandId: 'b1' }));
    act(() => {
      pushSnapshot([{ modelId: 'm1', brandId: 'b1', name: 'X1', isActive: true }]);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toHaveLength(1);
  });

  it('re-subscribes when brandId changes', () => {
    const unsub1 = vi.fn();
    const unsub2 = vi.fn();
    subscribeToModelsMock
      .mockImplementationOnce(() => unsub1)
      .mockImplementationOnce(() => unsub2);
    const { rerender } = renderHook(({ brandId }) => useModels({ brandId }), {
      initialProps: { brandId: 'b1' },
    });
    rerender({ brandId: 'b2' });
    expect(unsub1).toHaveBeenCalledTimes(1);
    expect(subscribeToModelsMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 22.2: Run the test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/hooks/useModels.test.jsx`
Expected: FAIL with "Cannot find module './useModels.js'".

- [ ] **Step 22.3: Implement the hook**

```javascript
// src/hooks/useModels.js
import { useEffect, useState } from 'react';
import { subscribeToModels } from '@/infra/repositories/firestoreModelRepository.js';

/**
 * Reactive hook over `/models`. When `brandId` is null, returns all models.
 * @param {Object} [options]
 * @param {string|null} [options.brandId]
 * @returns {{ data: Array, loading: boolean, error: Error|null }}
 */
export function useModels({ brandId = null } = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeToModels({
      brandId,
      onData: (rows) => {
        setData(rows);
        setLoading(false);
        setError(null);
      },
      onError: (err) => {
        setError(err);
        setLoading(false);
      },
    });
    return unsubscribe;
  }, [brandId]);

  return { data, loading, error };
}
```

- [ ] **Step 22.4: Run the test to verify it passes**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/hooks/useModels.test.jsx`
Expected: PASS.

- [ ] **Step 22.5: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/hooks/useModels.js src/hooks/useModels.test.jsx`
Expected: 0 errors.

---

### Task 23: `useLicenseSecret` hook (imperative — NOT a real-time subscription)

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/hooks/useLicenseSecret.js`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/hooks/useLicenseSecret.test.jsx`

This hook **must not** subscribe to the secret doc. The license-key value is fetched on demand only when the privileged operator clicks "Показать". The hook returns `{ getKey, setKey, loading, error }` where `getKey()` does a one-shot `getDoc` and `setKey(value)` does a write through `firestoreLicenseSecretRepository.setLicenseKey`.

- [ ] **Step 23.1: Write the failing test**

```javascript
// src/hooks/useLicenseSecret.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const getLicenseKeyMock = vi.fn();
const setLicenseKeyMock = vi.fn();
vi.mock('@/infra/repositories/firestoreLicenseSecretRepository.js', () => ({
  getLicenseKey: (...args) => getLicenseKeyMock(...args),
  setLicenseKey: (...args) => setLicenseKeyMock(...args),
}));

const useAuthMock = vi.fn();
vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => useAuthMock(),
}));

import { useLicenseSecret } from './useLicenseSecret.js';

describe('useLicenseSecret', () => {
  beforeEach(() => {
    getLicenseKeyMock.mockReset();
    setLicenseKeyMock.mockReset();
    useAuthMock.mockReset();
    useAuthMock.mockReturnValue({ user: { uid: 'u1' }, role: 'tech_admin' });
  });

  it('exposes a getKey function that calls the repository once', async () => {
    getLicenseKeyMock.mockResolvedValue('SECRET-VALUE');
    const { result } = renderHook(() => useLicenseSecret({ assetId: 'a1' }));
    let returned;
    await act(async () => {
      returned = await result.current.getKey();
    });
    expect(getLicenseKeyMock).toHaveBeenCalledWith('a1');
    expect(returned).toBe('SECRET-VALUE');
  });

  it('exposes a setKey function that calls the repository with actor', async () => {
    setLicenseKeyMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useLicenseSecret({ assetId: 'a1' }));
    await act(async () => {
      await result.current.setKey('NEW-VALUE');
    });
    expect(setLicenseKeyMock).toHaveBeenCalledWith('a1', 'NEW-VALUE', {
      uid: 'u1',
      role: 'tech_admin',
    });
  });

  it('does NOT subscribe — no listener returned, repo never called on mount', () => {
    renderHook(() => useLicenseSecret({ assetId: 'a1' }));
    expect(getLicenseKeyMock).not.toHaveBeenCalled();
    expect(setLicenseKeyMock).not.toHaveBeenCalled();
  });

  it('records errors from setKey without leaking the value', async () => {
    setLicenseKeyMock.mockRejectedValue(new Error('write failed'));
    const { result } = renderHook(() => useLicenseSecret({ assetId: 'a1' }));
    await act(async () => {
      try {
        await result.current.setKey('NEW-VALUE');
      } catch {
        /* swallow */
      }
    });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error.message).not.toContain('NEW-VALUE');
  });
});
```

- [ ] **Step 23.2: Run the test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/hooks/useLicenseSecret.test.jsx`
Expected: FAIL with "Cannot find module './useLicenseSecret.js'".

- [ ] **Step 23.3: Implement the hook**

```javascript
// src/hooks/useLicenseSecret.js
import { useCallback, useState } from 'react';
import {
  getLicenseKey,
  setLicenseKey,
} from '@/infra/repositories/firestoreLicenseSecretRepository.js';
import { useAuth } from '@/contexts/AuthContext.jsx';

/**
 * Imperative hook over `/assets/{assetId}/secrets/key`.
 * Deliberately NOT a subscription — the key is fetched only when the
 * operator explicitly asks for it.
 *
 * @param {Object} options
 * @param {string} options.assetId
 * @returns {{
 *   getKey: () => Promise<string|null>,
 *   setKey: (value: string) => Promise<void>,
 *   loading: boolean,
 *   error: Error|null,
 * }}
 */
export function useLicenseSecret({ assetId }) {
  const { user, role } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const getKey = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      return await getLicenseKey(assetId);
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  const setKey = useCallback(
    async (value) => {
      setLoading(true);
      setError(null);
      try {
        await setLicenseKey(assetId, value, { uid: user?.uid, role });
      } catch (err) {
        setError(err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [assetId, user?.uid, role],
  );

  return { getKey, setKey, loading, error };
}
```

- [ ] **Step 23.4: Run the test to verify it passes**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/hooks/useLicenseSecret.test.jsx`
Expected: PASS.

- [ ] **Step 23.5: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/hooks/useLicenseSecret.js src/hooks/useLicenseSecret.test.jsx`
Expected: 0 errors.

---

### Task 24: `useNotificationSettings` hook

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/hooks/useNotificationSettings.js`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/hooks/useNotificationSettings.test.jsx`

- [ ] **Step 24.1: Write the failing test**

```javascript
// src/hooks/useNotificationSettings.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const subscribeToNotificationSettingsMock = vi.fn();
vi.mock('@/infra/repositories/firestoreNotificationSettingsRepository.js', () => ({
  subscribeToNotificationSettings: (...args) =>
    subscribeToNotificationSettingsMock(...args),
}));

import { useNotificationSettings } from './useNotificationSettings.js';

describe('useNotificationSettings', () => {
  beforeEach(() => {
    subscribeToNotificationSettingsMock.mockReset();
  });

  it('starts in loading state with default settings', () => {
    subscribeToNotificationSettingsMock.mockImplementation(() => () => {});
    const { result } = renderHook(() => useNotificationSettings());
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toEqual({ licenseExpiryWarningDays: 30 });
  });

  it('exposes settings once pushed', () => {
    let pushSnapshot = null;
    subscribeToNotificationSettingsMock.mockImplementation(({ onData }) => {
      pushSnapshot = onData;
      return () => {};
    });
    const { result } = renderHook(() => useNotificationSettings());
    act(() => {
      pushSnapshot({ licenseExpiryWarningDays: 14 });
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data.licenseExpiryWarningDays).toBe(14);
  });

  it('falls back to defaults when settings doc does not exist', () => {
    let pushSnapshot = null;
    subscribeToNotificationSettingsMock.mockImplementation(({ onData }) => {
      pushSnapshot = onData;
      return () => {};
    });
    const { result } = renderHook(() => useNotificationSettings());
    act(() => {
      pushSnapshot(null);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data.licenseExpiryWarningDays).toBe(30);
  });
});
```

- [ ] **Step 24.2: Run the test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/hooks/useNotificationSettings.test.jsx`
Expected: FAIL with "Cannot find module './useNotificationSettings.js'".

- [ ] **Step 24.3: Implement the hook**

```javascript
// src/hooks/useNotificationSettings.js
import { useEffect, useState } from 'react';
import { subscribeToNotificationSettings } from '@/infra/repositories/firestoreNotificationSettingsRepository.js';

const DEFAULT_SETTINGS = Object.freeze({ licenseExpiryWarningDays: 30 });

/**
 * Reactive hook over `/settings/notifications`.
 * Returns default values when the doc does not exist.
 * @returns {{ data: { licenseExpiryWarningDays: number }, loading: boolean, error: Error|null }}
 */
export function useNotificationSettings() {
  const [data, setData] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribe = subscribeToNotificationSettings({
      onData: (snapshot) => {
        setData(
          snapshot && typeof snapshot.licenseExpiryWarningDays === 'number'
            ? snapshot
            : DEFAULT_SETTINGS,
        );
        setLoading(false);
        setError(null);
      },
      onError: (err) => {
        setError(err);
        setLoading(false);
      },
    });
    return unsubscribe;
  }, []);

  return { data, loading, error };
}
```

- [ ] **Step 24.4: Run the test to verify it passes**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/hooks/useNotificationSettings.test.jsx`
Expected: PASS.

- [ ] **Step 24.5: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/hooks/useNotificationSettings.js src/hooks/useNotificationSettings.test.jsx`
Expected: 0 errors.

---

## i18n layer (Tasks 25–26)

### Task 25: Register new namespaces

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/i18n/namespaces.js`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/i18n/namespaces.test.js`

- [ ] **Step 25.1: Write the failing test**

```javascript
// src/i18n/namespaces.test.js
import { describe, it, expect } from 'vitest';
import { NAMESPACES, NAMESPACE_LIST } from './namespaces.js';

describe('namespaces', () => {
  it('declares brands, models, licenses', () => {
    expect(NAMESPACES.BRANDS).toBe('brands');
    expect(NAMESPACES.MODELS).toBe('models');
    expect(NAMESPACES.LICENSES).toBe('licenses');
  });

  it('NAMESPACE_LIST contains the new ones', () => {
    expect(NAMESPACE_LIST).toContain('brands');
    expect(NAMESPACE_LIST).toContain('models');
    expect(NAMESPACE_LIST).toContain('licenses');
  });
});
```

- [ ] **Step 25.2: Run the test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/i18n/namespaces.test.js`
Expected: FAIL: `expected undefined to be 'brands'`.

- [ ] **Step 25.3: Add the entries to `namespaces.js`**

Replace the body of `NAMESPACES` so it ends with these three new entries (preserving every existing entry):

```javascript
export const NAMESPACES = Object.freeze({
  COMMON: 'common',
  AUTH: 'auth',
  ASSETS: 'assets',
  BRANCHES: 'branches',
  EMPLOYEES: 'employees',
  DEPARTMENTS: 'departments',
  CATEGORIES: 'categories',
  STATUSES: 'statuses',
  DASHBOARD: 'dashboard',
  ERRORS: 'errors',
  VALIDATION: 'validation',
  ME: 'me',
  SETTINGS: 'settings',
  USERS: 'users',
  BRANDS: 'brands',
  MODELS: 'models',
  LICENSES: 'licenses',
});
```

- [ ] **Step 25.4: Run the test to verify it passes**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/i18n/namespaces.test.js`
Expected: PASS.

- [ ] **Step 25.5: Run the full i18n test sweep**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/i18n`
Expected: PASS — no resource-loader regressions.

---

### Task 26: Locale resource files for new and updated namespaces

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/locales/ru/brands.json`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/locales/en/brands.json`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/locales/hy/brands.json`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/locales/ru/models.json`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/locales/en/models.json`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/locales/hy/models.json`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/locales/ru/licenses.json`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/locales/en/licenses.json`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/locales/hy/licenses.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/ru/assets.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/en/assets.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/hy/assets.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/ru/categories.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/en/categories.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/hy/categories.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/ru/settings.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/en/settings.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/hy/settings.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/ru/common.json` — add `navBrands`, `navModels`, `navNotificationSettings`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/en/common.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/hy/common.json`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/locales/locales.parity.test.js` (new)

- [ ] **Step 26.1: Write a parity test that fails on missing keys**

```javascript
// src/locales/locales.parity.test.js
import { describe, it, expect } from 'vitest';
import ruBrands from './ru/brands.json';
import enBrands from './en/brands.json';
import hyBrands from './hy/brands.json';
import ruModels from './ru/models.json';
import enModels from './en/models.json';
import hyModels from './hy/models.json';
import ruLicenses from './ru/licenses.json';
import enLicenses from './en/licenses.json';
import hyLicenses from './hy/licenses.json';
import ruAssets from './ru/assets.json';
import enAssets from './en/assets.json';
import hyAssets from './hy/assets.json';
import ruCategories from './ru/categories.json';
import enCategories from './en/categories.json';
import hyCategories from './hy/categories.json';
import ruSettings from './ru/settings.json';
import enSettings from './en/settings.json';
import hySettings from './hy/settings.json';
import ruCommon from './ru/common.json';
import enCommon from './en/common.json';
import hyCommon from './hy/common.json';

function flatKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? flatKeys(v, prefix + k + '.')
      : [prefix + k],
  );
}

function expectParity(name, ru, en, hy) {
  const ruKeys = flatKeys(ru).sort();
  const enKeys = flatKeys(en).sort();
  const hyKeys = flatKeys(hy).sort();
  expect(enKeys, `${name}: en missing keys`).toEqual(ruKeys);
  expect(hyKeys, `${name}: hy missing keys`).toEqual(ruKeys);
}

describe('locale parity (ru / en / hy)', () => {
  it('brands.json keys are in sync', () => {
    expectParity('brands', ruBrands, enBrands, hyBrands);
  });
  it('models.json keys are in sync', () => {
    expectParity('models', ruModels, enModels, hyModels);
  });
  it('licenses.json keys are in sync', () => {
    expectParity('licenses', ruLicenses, enLicenses, hyLicenses);
  });
  it('assets.json keys are in sync', () => {
    expectParity('assets', ruAssets, enAssets, hyAssets);
  });
  it('categories.json keys are in sync', () => {
    expectParity('categories', ruCategories, enCategories, hyCategories);
  });
  it('settings.json keys are in sync', () => {
    expectParity('settings', ruSettings, enSettings, hySettings);
  });
  it('common.json keys are in sync', () => {
    expectParity('common', ruCommon, enCommon, hyCommon);
  });
});

describe('locale required keys', () => {
  it('brands.json defines title, addBrand, columnName', () => {
    for (const [name, file] of [['ru', ruBrands], ['en', enBrands], ['hy', hyBrands]]) {
      expect(file.title, `${name}/brands.title`).toBeTruthy();
      expect(file.addBrand, `${name}/brands.addBrand`).toBeTruthy();
      expect(file.columnName, `${name}/brands.columnName`).toBeTruthy();
    }
  });
  it('models.json defines title, addModel, brandColumn', () => {
    for (const [name, file] of [['ru', ruModels], ['en', enModels], ['hy', hyModels]]) {
      expect(file.title, `${name}/models.title`).toBeTruthy();
      expect(file.addModel, `${name}/models.addModel`).toBeTruthy();
      expect(file.brandColumn, `${name}/models.brandColumn`).toBeTruthy();
    }
  });
  it('licenses.json defines key UI strings', () => {
    for (const [name, file] of [['ru', ruLicenses], ['en', enLicenses], ['hy', hyLicenses]]) {
      expect(file.licenseType, `${name}/licenses.licenseType`).toBeTruthy();
      expect(file.licenseTypePersonal, `${name}/licenses.licenseTypePersonal`).toBeTruthy();
      expect(file.licenseTypeBusiness, `${name}/licenses.licenseTypeBusiness`).toBeTruthy();
      expect(file.licenseTypeEnterprise, `${name}/licenses.licenseTypeEnterprise`).toBeTruthy();
      expect(file.subscribedAt, `${name}/licenses.subscribedAt`).toBeTruthy();
      expect(file.expiresAt, `${name}/licenses.expiresAt`).toBeTruthy();
      expect(file.licenseKey, `${name}/licenses.licenseKey`).toBeTruthy();
      expect(file.licenseKeyMasked, `${name}/licenses.licenseKeyMasked`).toBeTruthy();
      expect(file.licenseKeyShow, `${name}/licenses.licenseKeyShow`).toBeTruthy();
      expect(file.licenseKeyHide, `${name}/licenses.licenseKeyHide`).toBeTruthy();
      expect(file.licenseKeyCopy, `${name}/licenses.licenseKeyCopy`).toBeTruthy();
      expect(file.licenseKeySetTrue, `${name}/licenses.licenseKeySetTrue`).toBeTruthy();
      expect(file.licenseKeySetFalse, `${name}/licenses.licenseKeySetFalse`).toBeTruthy();
      expect(file.manageKey, `${name}/licenses.manageKey`).toBeTruthy();
      expect(file.expiryBadgeSoon, `${name}/licenses.expiryBadgeSoon`).toBeTruthy();
      expect(file.expiryBadgePast, `${name}/licenses.expiryBadgePast`).toBeTruthy();
      expect(file.errorExpiresBeforeSubscribed, `${name}/licenses.errorExpiresBeforeSubscribed`).toBeTruthy();
    }
  });
  it('assets.json defines new redesign keys', () => {
    for (const [name, file] of [['ru', ruAssets], ['en', enAssets], ['hy', hyAssets]]) {
      expect(file.groupWhatIsIt, `${name}/assets.groupWhatIsIt`).toBeTruthy();
      expect(file.groupIdentifiers, `${name}/assets.groupIdentifiers`).toBeTruthy();
      expect(file.groupWhereIsIt, `${name}/assets.groupWhereIsIt`).toBeTruthy();
      expect(file.groupMoneyWarranty, `${name}/assets.groupMoneyWarranty`).toBeTruthy();
      expect(file.groupNotes, `${name}/assets.groupNotes`).toBeTruthy();
      expect(file.groupLicense, `${name}/assets.groupLicense`).toBeTruthy();
      expect(file.brandLabel, `${name}/assets.brandLabel`).toBeTruthy();
      expect(file.modelLabel, `${name}/assets.modelLabel`).toBeTruthy();
      expect(file.brandPlaceholder, `${name}/assets.brandPlaceholder`).toBeTruthy();
      expect(file.modelPlaceholder, `${name}/assets.modelPlaceholder`).toBeTruthy();
      expect(file.modelDisabledNoBrand, `${name}/assets.modelDisabledNoBrand`).toBeTruthy();
      expect(file.previewTitle, `${name}/assets.previewTitle`).toBeTruthy();
      expect(file.previewBackButton, `${name}/assets.previewBackButton`).toBeTruthy();
      expect(file.previewCreateButton, `${name}/assets.previewCreateButton`).toBeTruthy();
      expect(file.nextButton, `${name}/assets.nextButton`).toBeTruthy();
      expect(file.errorBrandRequired, `${name}/assets.errorBrandRequired`).toBeTruthy();
      expect(file.errorModelRequired, `${name}/assets.errorModelRequired`).toBeTruthy();
      expect(file.errorModelBrandMismatch, `${name}/assets.errorModelBrandMismatch`).toBeTruthy();
    }
  });
  it('categories.json defines assignsInventoryCode label', () => {
    for (const [name, file] of [['ru', ruCategories], ['en', enCategories], ['hy', hyCategories]]) {
      expect(file.assignsInventoryCodeLabel, `${name}/categories.assignsInventoryCodeLabel`).toBeTruthy();
      expect(file.assignsInventoryCodeHint, `${name}/categories.assignsInventoryCodeHint`).toBeTruthy();
    }
  });
  it('settings.json defines notification settings keys', () => {
    for (const [name, file] of [['ru', ruSettings], ['en', enSettings], ['hy', hySettings]]) {
      expect(file.notificationSettingsTitle, `${name}/settings.notificationSettingsTitle`).toBeTruthy();
      expect(file.licenseExpiryWarningDaysLabel, `${name}/settings.licenseExpiryWarningDaysLabel`).toBeTruthy();
      expect(file.licenseExpiryWarningDaysHint, `${name}/settings.licenseExpiryWarningDaysHint`).toBeTruthy();
      expect(file.errorRangeOneToThreeSixtyFive, `${name}/settings.errorRangeOneToThreeSixtyFive`).toBeTruthy();
      expect(file.saveButton, `${name}/settings.saveButton`).toBeTruthy();
    }
  });
  it('common.json defines new nav keys', () => {
    for (const [name, file] of [['ru', ruCommon], ['en', enCommon], ['hy', hyCommon]]) {
      expect(file.navBrands, `${name}/common.navBrands`).toBeTruthy();
      expect(file.navModels, `${name}/common.navModels`).toBeTruthy();
      expect(file.navNotificationSettings, `${name}/common.navNotificationSettings`).toBeTruthy();
    }
  });
});
```

- [ ] **Step 26.2: Run the test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/locales/locales.parity.test.js`
Expected: FAIL — files do not exist yet.

- [ ] **Step 26.3: Create `src/locales/ru/brands.json`**

```json
{
  "title": "Бренды",
  "subtitle": "Каталог брендов производителей",
  "addBrand": "Добавить бренд",
  "editBrand": "Изменить бренд",
  "columnName": "Название",
  "columnStatus": "Статус",
  "columnActions": "Действия",
  "statusActive": "Активен",
  "statusInactive": "Неактивен",
  "fieldName": "Название",
  "fieldNamePlaceholder": "Например: HP",
  "fieldIsActive": "Активен",
  "deactivate": "Деактивировать",
  "activate": "Активировать",
  "save": "Сохранить",
  "cancel": "Отмена",
  "errorNameRequired": "Название обязательно",
  "errorNameTooLong": "Название слишком длинное (макс. 200 символов)",
  "errorNameNotUnique": "Бренд с таким названием уже существует",
  "errorBrandInUse": "Бренд используется в активах ({{count}}) или моделях ({{models}})",
  "emptyState": "Брендов пока нет"
}
```

- [ ] **Step 26.4: Create `src/locales/en/brands.json`**

```json
{
  "title": "Brands",
  "subtitle": "Manufacturer brand catalog",
  "addBrand": "Add brand",
  "editBrand": "Edit brand",
  "columnName": "Name",
  "columnStatus": "Status",
  "columnActions": "Actions",
  "statusActive": "Active",
  "statusInactive": "Inactive",
  "fieldName": "Name",
  "fieldNamePlaceholder": "e.g. HP",
  "fieldIsActive": "Active",
  "deactivate": "Deactivate",
  "activate": "Activate",
  "save": "Save",
  "cancel": "Cancel",
  "errorNameRequired": "Name is required",
  "errorNameTooLong": "Name is too long (max 200 characters)",
  "errorNameNotUnique": "A brand with this name already exists",
  "errorBrandInUse": "Brand is used by assets ({{count}}) or models ({{models}})",
  "emptyState": "No brands yet"
}
```

- [ ] **Step 26.5: Create `src/locales/hy/brands.json`**

```json
{
  "title": "Բրենդներ",
  "subtitle": "Արտադրողների բրենդների կատալոգ",
  "addBrand": "Ավելացնել բրենդ",
  "editBrand": "Փոփոխել բրենդը",
  "columnName": "Անվանում",
  "columnStatus": "Կարգավիճակ",
  "columnActions": "Գործողություններ",
  "statusActive": "Ակտիվ",
  "statusInactive": "Ոչ ակտիվ",
  "fieldName": "Անվանում",
  "fieldNamePlaceholder": "Օր.՝ HP",
  "fieldIsActive": "Ակտիվ",
  "deactivate": "Ապաակտիվացնել",
  "activate": "Ակտիվացնել",
  "save": "Պահպանել",
  "cancel": "Չեղարկել",
  "errorNameRequired": "Անվանումը պարտադիր է",
  "errorNameTooLong": "Անվանումը չափազանց երկար է (առավելագույնը 200 նիշ)",
  "errorNameNotUnique": "Այս անվանումով բրենդ արդեն գոյություն ունի",
  "errorBrandInUse": "Բրենդն օգտագործվում է ակտիվներում ({{count}}) կամ մոդելներում ({{models}})",
  "emptyState": "Բրենդներ դեռ չկան"
}
```

- [ ] **Step 26.6: Create `src/locales/ru/models.json`**

```json
{
  "title": "Модели",
  "subtitle": "Каталог моделей по брендам",
  "addModel": "Добавить модель",
  "editModel": "Изменить модель",
  "filterByBrand": "Бренд",
  "filterAllBrands": "Все бренды",
  "brandColumn": "Бренд",
  "columnName": "Название",
  "columnStatus": "Статус",
  "columnActions": "Действия",
  "statusActive": "Активна",
  "statusInactive": "Неактивна",
  "fieldBrand": "Бренд",
  "fieldBrandPlaceholder": "Выберите бренд",
  "fieldName": "Название",
  "fieldNamePlaceholder": "Например: EliteBook 840 G6",
  "fieldIsActive": "Активна",
  "deactivate": "Деактивировать",
  "activate": "Активировать",
  "save": "Сохранить",
  "cancel": "Отмена",
  "errorBrandRequired": "Выберите бренд",
  "errorNameRequired": "Название обязательно",
  "errorNameTooLong": "Название слишком длинное (макс. 200 символов)",
  "errorNameNotUniqueWithinBrand": "Модель с таким названием уже существует у выбранного бренда",
  "errorModelInUse": "Модель используется в активах ({{count}})",
  "emptyState": "Моделей пока нет"
}
```

- [ ] **Step 26.7: Create `src/locales/en/models.json`**

```json
{
  "title": "Models",
  "subtitle": "Model catalog grouped by brand",
  "addModel": "Add model",
  "editModel": "Edit model",
  "filterByBrand": "Brand",
  "filterAllBrands": "All brands",
  "brandColumn": "Brand",
  "columnName": "Name",
  "columnStatus": "Status",
  "columnActions": "Actions",
  "statusActive": "Active",
  "statusInactive": "Inactive",
  "fieldBrand": "Brand",
  "fieldBrandPlaceholder": "Pick a brand",
  "fieldName": "Name",
  "fieldNamePlaceholder": "e.g. EliteBook 840 G6",
  "fieldIsActive": "Active",
  "deactivate": "Deactivate",
  "activate": "Activate",
  "save": "Save",
  "cancel": "Cancel",
  "errorBrandRequired": "Pick a brand",
  "errorNameRequired": "Name is required",
  "errorNameTooLong": "Name is too long (max 200 characters)",
  "errorNameNotUniqueWithinBrand": "A model with this name already exists for the selected brand",
  "errorModelInUse": "Model is used by assets ({{count}})",
  "emptyState": "No models yet"
}
```

- [ ] **Step 26.8: Create `src/locales/hy/models.json`**

```json
{
  "title": "Մոդելներ",
  "subtitle": "Մոդելների կատալոգ ըստ բրենդների",
  "addModel": "Ավելացնել մոդել",
  "editModel": "Փոփոխել մոդելը",
  "filterByBrand": "Բրենդ",
  "filterAllBrands": "Բոլոր բրենդները",
  "brandColumn": "Բրենդ",
  "columnName": "Անվանում",
  "columnStatus": "Կարգավիճակ",
  "columnActions": "Գործողություններ",
  "statusActive": "Ակտիվ",
  "statusInactive": "Ոչ ակտիվ",
  "fieldBrand": "Բրենդ",
  "fieldBrandPlaceholder": "Ընտրեք բրենդը",
  "fieldName": "Անվանում",
  "fieldNamePlaceholder": "Օր.՝ EliteBook 840 G6",
  "fieldIsActive": "Ակտիվ",
  "deactivate": "Ապաակտիվացնել",
  "activate": "Ակտիվացնել",
  "save": "Պահպանել",
  "cancel": "Չեղարկել",
  "errorBrandRequired": "Ընտրեք բրենդը",
  "errorNameRequired": "Անվանումը պարտադիր է",
  "errorNameTooLong": "Անվանումը չափազանց երկար է (առավելագույնը 200 նիշ)",
  "errorNameNotUniqueWithinBrand": "Այս անվանումով մոդել արդեն գոյություն ունի ընտրված բրենդի համար",
  "errorModelInUse": "Մոդելն օգտագործվում է ակտիվներում ({{count}})",
  "emptyState": "Մոդելներ դեռ չկան"
}
```

- [ ] **Step 26.9: Create `src/locales/ru/licenses.json`**

```json
{
  "licenseType": "Тип лицензии",
  "licenseTypePersonal": "Персональная",
  "licenseTypeBusiness": "Коммерческая",
  "licenseTypeEnterprise": "Корпоративная",
  "subscribedAt": "Дата подписки",
  "expiresAt": "Дата окончания",
  "licenseKey": "Ключ лицензии",
  "licenseKeyMasked": "•••••",
  "licenseKeyShow": "Показать",
  "licenseKeyHide": "Скрыть",
  "licenseKeyCopy": "Копировать",
  "licenseKeyCopied": "Скопировано",
  "licenseKeySetTrue": "Введён",
  "licenseKeySetFalse": "Не введён",
  "licenseKeyHelpHint": "Не вставляйте ключ в Заметки — для этого есть отдельное защищённое поле.",
  "licenseKeyAdminOnlyHint": "Видно только Супер-админу и Тех. админу.",
  "manageKey": "Управлять ключом",
  "manageKeyDialogTitle": "Управление ключом лицензии",
  "manageKeyDialogSave": "Сохранить ключ",
  "manageKeyDialogCancel": "Отмена",
  "expiryBadgeSoon": "Истекает через {{days}} дн.",
  "expiryBadgePast": "Истекла {{days}} дн. назад",
  "errorExpiresBeforeSubscribed": "Дата окончания должна быть позже даты подписки",
  "errorLicenseTypeRequired": "Выберите тип лицензии",
  "errorSubscribedAtRequired": "Укажите дату подписки",
  "errorExpiresAtRequired": "Укажите дату окончания",
  "errorLicenseKeyTooLong": "Ключ слишком длинный (макс. 4096 символов)",
  "warningExpiresInPast": "Дата окончания в прошлом — лицензия будет помечена как истёкшая"
}
```

- [ ] **Step 26.10: Create `src/locales/en/licenses.json`**

```json
{
  "licenseType": "License type",
  "licenseTypePersonal": "Personal",
  "licenseTypeBusiness": "Business",
  "licenseTypeEnterprise": "Enterprise",
  "subscribedAt": "Subscribed at",
  "expiresAt": "Expires at",
  "licenseKey": "License key",
  "licenseKeyMasked": "•••••",
  "licenseKeyShow": "Show",
  "licenseKeyHide": "Hide",
  "licenseKeyCopy": "Copy",
  "licenseKeyCopied": "Copied",
  "licenseKeySetTrue": "Set",
  "licenseKeySetFalse": "Not set",
  "licenseKeyHelpHint": "Do not paste the key into Notes — there is a dedicated protected field for it.",
  "licenseKeyAdminOnlyHint": "Visible to Super Admin and Tech Admin only.",
  "manageKey": "Manage key",
  "manageKeyDialogTitle": "Manage license key",
  "manageKeyDialogSave": "Save key",
  "manageKeyDialogCancel": "Cancel",
  "expiryBadgeSoon": "Expires in {{days}} days",
  "expiryBadgePast": "Expired {{days}} days ago",
  "errorExpiresBeforeSubscribed": "Expiry date must be after subscription date",
  "errorLicenseTypeRequired": "Pick a license type",
  "errorSubscribedAtRequired": "Subscription date is required",
  "errorExpiresAtRequired": "Expiry date is required",
  "errorLicenseKeyTooLong": "Key is too long (max 4096 characters)",
  "warningExpiresInPast": "Expiry date is in the past — the license will be marked as expired"
}
```

- [ ] **Step 26.11: Create `src/locales/hy/licenses.json`**

```json
{
  "licenseType": "Լիցենզիայի տեսակը",
  "licenseTypePersonal": "Անձնական",
  "licenseTypeBusiness": "Կոմերցիոն",
  "licenseTypeEnterprise": "Կորպորատիվ",
  "subscribedAt": "Բաժանորդագրման ամսաթիվ",
  "expiresAt": "Ավարտի ամսաթիվ",
  "licenseKey": "Լիցենզիայի բանալին",
  "licenseKeyMasked": "•••••",
  "licenseKeyShow": "Ցույց տալ",
  "licenseKeyHide": "Թաքցնել",
  "licenseKeyCopy": "Պատճենել",
  "licenseKeyCopied": "Պատճենվեց",
  "licenseKeySetTrue": "Մուտքագրված",
  "licenseKeySetFalse": "Մուտքագրված չէ",
  "licenseKeyHelpHint": "Մի տեղադրեք բանալին «Նշումներ» դաշտում — դրա համար կա առանձին պաշտպանված դաշտ։",
  "licenseKeyAdminOnlyHint": "Տեսանելի է միայն Գերադմինին և Տեխ. ադմինին։",
  "manageKey": "Կառավարել բանալին",
  "manageKeyDialogTitle": "Լիցենզիայի բանալու կառավարում",
  "manageKeyDialogSave": "Պահպանել բանալին",
  "manageKeyDialogCancel": "Չեղարկել",
  "expiryBadgeSoon": "Ավարտվում է {{days}} օրից",
  "expiryBadgePast": "Ավարտվել է {{days}} օր առաջ",
  "errorExpiresBeforeSubscribed": "Ավարտի ամսաթիվը պետք է ուշ լինի բաժանորդագրման ամսաթվից",
  "errorLicenseTypeRequired": "Ընտրեք լիցենզիայի տեսակը",
  "errorSubscribedAtRequired": "Նշեք բաժանորդագրման ամսաթիվը",
  "errorExpiresAtRequired": "Նշեք ավարտի ամսաթիվը",
  "errorLicenseKeyTooLong": "Բանալին չափազանց երկար է (առավելագույնը 4096 նիշ)",
  "warningExpiresInPast": "Ավարտի ամսաթիվն անցյալում է — լիցենզիան կնշվի որպես ավարտված"
}
```

- [ ] **Step 26.12: Add new keys to `src/locales/ru/assets.json`**

Append the following entries inside the existing JSON object (immediately before the closing `}`; remember to add a trailing comma to the previous last entry):

```json
"groupWhatIsIt": "Что это?",
"groupIdentifiers": "Идентификаторы",
"groupWhereIsIt": "Где это?",
"groupMoneyWarranty": "Деньги и гарантия",
"groupNotes": "Заметки",
"groupLicense": "Лицензия",
"brandLabel": "Бренд",
"modelLabel": "Модель",
"brandPlaceholder": "Выберите бренд",
"modelPlaceholder": "Выберите модель",
"modelDisabledNoBrand": "Сначала выберите бренд",
"previewTitle": "Проверьте перед созданием",
"previewBackButton": "Назад",
"previewCreateButton": "Создать",
"previewSubtypeRow": "Подтип",
"previewBrandRow": "Бренд",
"previewModelRow": "Модель",
"previewLicenseTypeRow": "Тип лицензии",
"previewSubscribedAtRow": "Дата подписки",
"previewExpiresAtRow": "Дата окончания",
"previewLicenseKeyRow": "Ключ лицензии",
"previewHolderRow": "Где",
"previewBranchRow": "Филиал",
"previewConditionRow": "Состояние",
"previewWarrantyRow": "Гарантия",
"previewPurchasePriceRow": "Стоимость",
"previewInventoryCodeRow": "Инвентарный код",
"nextButton": "Далее",
"errorBrandRequired": "Выберите бренд",
"errorModelRequired": "Выберите модель",
"errorModelBrandMismatch": "Эта модель не принадлежит выбранному бренду"
```

- [ ] **Step 26.13: Add new keys to `src/locales/en/assets.json`**

```json
"groupWhatIsIt": "What is it?",
"groupIdentifiers": "Identifiers",
"groupWhereIsIt": "Where is it?",
"groupMoneyWarranty": "Money & warranty",
"groupNotes": "Notes",
"groupLicense": "License",
"brandLabel": "Brand",
"modelLabel": "Model",
"brandPlaceholder": "Pick a brand",
"modelPlaceholder": "Pick a model",
"modelDisabledNoBrand": "Pick a brand first",
"previewTitle": "Review before creating",
"previewBackButton": "Back",
"previewCreateButton": "Create",
"previewSubtypeRow": "Subtype",
"previewBrandRow": "Brand",
"previewModelRow": "Model",
"previewLicenseTypeRow": "License type",
"previewSubscribedAtRow": "Subscribed at",
"previewExpiresAtRow": "Expires at",
"previewLicenseKeyRow": "License key",
"previewHolderRow": "Where",
"previewBranchRow": "Branch",
"previewConditionRow": "Condition",
"previewWarrantyRow": "Warranty",
"previewPurchasePriceRow": "Purchase price",
"previewInventoryCodeRow": "Inventory code",
"nextButton": "Next",
"errorBrandRequired": "Pick a brand",
"errorModelRequired": "Pick a model",
"errorModelBrandMismatch": "This model does not belong to the selected brand"
```

- [ ] **Step 26.14: Add new keys to `src/locales/hy/assets.json`**

```json
"groupWhatIsIt": "Ի՞նչ է սա",
"groupIdentifiers": "Նույնականացուցիչներ",
"groupWhereIsIt": "Որտե՞ղ է",
"groupMoneyWarranty": "Գումար և երաշխիք",
"groupNotes": "Նշումներ",
"groupLicense": "Լիցենզիա",
"brandLabel": "Բրենդ",
"modelLabel": "Մոդել",
"brandPlaceholder": "Ընտրեք բրենդը",
"modelPlaceholder": "Ընտրեք մոդելը",
"modelDisabledNoBrand": "Նախ ընտրեք բրենդը",
"previewTitle": "Ստուգեք նախքան ստեղծելը",
"previewBackButton": "Հետ",
"previewCreateButton": "Ստեղծել",
"previewSubtypeRow": "Ենթատիպ",
"previewBrandRow": "Բրենդ",
"previewModelRow": "Մոդել",
"previewLicenseTypeRow": "Լիցենզիայի տեսակ",
"previewSubscribedAtRow": "Բաժանորդագրման ամսաթիվ",
"previewExpiresAtRow": "Ավարտի ամսաթիվ",
"previewLicenseKeyRow": "Լիցենզիայի բանալի",
"previewHolderRow": "Որտեղ",
"previewBranchRow": "Մասնաճյուղ",
"previewConditionRow": "Վիճակ",
"previewWarrantyRow": "Երաշխիք",
"previewPurchasePriceRow": "Արժեք",
"previewInventoryCodeRow": "Գույքագրման համար",
"nextButton": "Հաջորդ",
"errorBrandRequired": "Ընտրեք բրենդը",
"errorModelRequired": "Ընտրեք մոդելը",
"errorModelBrandMismatch": "Այս մոդելը չի պատկանում ընտրված բրենդին"
```

- [ ] **Step 26.15: Add new keys to `src/locales/{ru,en,hy}/categories.json`**

ru:
```json
"assignsInventoryCodeLabel": "Этой категории присваивается инвентарный код",
"assignsInventoryCodeHint": "Если выключено, активам этой категории не выдаётся инвентарный номер (например: лицензии)"
```

en:
```json
"assignsInventoryCodeLabel": "Assets in this category get an inventory code",
"assignsInventoryCodeHint": "If off, assets in this category receive no inventory number (for example: licenses)"
```

hy:
```json
"assignsInventoryCodeLabel": "Այս կատեգորիայի ակտիվները ստանում են գույքագրման համար",
"assignsInventoryCodeHint": "Անջատելու դեպքում այս կատեգորիայի ակտիվներն այլևս չեն ստանում գույքագրման համար (օրինակ՝ լիցենզիաներ)"
```

- [ ] **Step 26.16: Add notification settings keys to `src/locales/{ru,en,hy}/settings.json`**

ru:
```json
"notificationSettingsTitle": "Настройки уведомлений",
"notificationSettingsSubtitle": "Параметры предупреждений и алертов",
"licenseExpiryWarningDaysLabel": "За сколько дней предупреждать об истекающей лицензии",
"licenseExpiryWarningDaysHint": "От 1 до 365 дней. Используется для UI-бейджа на странице актива.",
"errorRangeOneToThreeSixtyFive": "Значение должно быть целым числом от 1 до 365",
"saveButton": "Сохранить"
```

en:
```json
"notificationSettingsTitle": "Notification settings",
"notificationSettingsSubtitle": "Warning and alert parameters",
"licenseExpiryWarningDaysLabel": "Days before expiry to warn for licenses",
"licenseExpiryWarningDaysHint": "Between 1 and 365. Used for the asset-page UI badge.",
"errorRangeOneToThreeSixtyFive": "Value must be an integer between 1 and 365",
"saveButton": "Save"
```

hy:
```json
"notificationSettingsTitle": "Ծանուցումների կարգավորումներ",
"notificationSettingsSubtitle": "Նախազգուշացումների և ազդանշանների պարամետրեր",
"licenseExpiryWarningDaysLabel": "Քանի օր առաջ զգուշացնել ավարտվող լիցենզիայի մասին",
"licenseExpiryWarningDaysHint": "1-ից 365 օր: Օգտագործվում է ակտիվի էջի UI-բեյջի համար:",
"errorRangeOneToThreeSixtyFive": "Արժեքը պետք է լինի ամբողջ թիվ 1-ից 365 միջակայքում",
"saveButton": "Պահպանել"
```

- [ ] **Step 26.17: Add nav keys to `src/locales/{ru,en,hy}/common.json`**

ru:
```json
"navBrands": "Бренды",
"navModels": "Модели",
"navNotificationSettings": "Уведомления"
```

en:
```json
"navBrands": "Brands",
"navModels": "Models",
"navNotificationSettings": "Notifications"
```

hy:
```json
"navBrands": "Բրենդներ",
"navModels": "Մոդելներ",
"navNotificationSettings": "Ծանուցումներ"
```

- [ ] **Step 26.18: Run the parity test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/locales/locales.parity.test.js`
Expected: PASS — all locales have the same keys, all required keys are non-empty.

- [ ] **Step 26.19: Run the full test suite to confirm no regressions in i18n consumers**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run`
Expected: PASS.

---

## UI primitives (Tasks 27–34)

### Task 27: `BrandSelect` component

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/BrandSelect.jsx`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/BrandSelect.test.jsx`

The component is a controlled `<select>` (or shadcn `Combobox`-style) that lists active brands. Emits `brandId` to the parent. Disabled when `useBrands().loading` is true.

- [ ] **Step 27.1: Write the failing test**

```jsx
// src/components/features/assets/BrandSelect.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/useBrands.js', () => ({
  useBrands: () => ({
    data: [
      { brandId: 'b1', name: 'HP', isActive: true },
      { brandId: 'b2', name: 'Dell', isActive: true },
      { brandId: 'b3', name: 'Inactive', isActive: false },
    ],
    loading: false,
    error: null,
  }),
}));

import { BrandSelect } from './BrandSelect.jsx';

describe('BrandSelect', () => {
  it('lists only active brands', () => {
    render(<BrandSelect value={null} onChange={() => {}} />);
    expect(screen.getByText('HP')).toBeInTheDocument();
    expect(screen.getByText('Dell')).toBeInTheDocument();
    expect(screen.queryByText('Inactive')).not.toBeInTheDocument();
  });

  it('emits brandId on change', () => {
    const onChange = vi.fn();
    render(<BrandSelect value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b2' } });
    expect(onChange).toHaveBeenCalledWith('b2');
  });

  it('emits null when placeholder is selected', () => {
    const onChange = vi.fn();
    render(<BrandSelect value="b1" onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 27.2: Run the test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/assets/BrandSelect.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 27.3: Implement the component**

```jsx
// src/components/features/assets/BrandSelect.jsx
import { useTranslation } from 'react-i18next';
import { useBrands } from '@/hooks/useBrands.js';

/**
 * @param {Object} props
 * @param {string|null} props.value
 * @param {(brandId: string|null) => void} props.onChange
 * @param {string} [props.id]
 * @param {boolean} [props.disabled]
 */
export function BrandSelect({ value, onChange, id, disabled = false }) {
  const { t } = useTranslation('assets');
  const { data, loading } = useBrands();
  const active = data.filter((b) => b.isActive);

  return (
    <select
      id={id}
      role="combobox"
      value={value ?? ''}
      disabled={disabled || loading}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
    >
      <option value="">{t('brandPlaceholder')}</option>
      {active.map((brand) => (
        <option key={brand.brandId} value={brand.brandId}>
          {brand.name}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 27.4: Run the test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/assets/BrandSelect.test.jsx`
Expected: PASS.

- [ ] **Step 27.5: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/components/features/assets/BrandSelect.jsx src/components/features/assets/BrandSelect.test.jsx`
Expected: 0 errors.

---

### Task 28: `ModelSelect` component

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/ModelSelect.jsx`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/ModelSelect.test.jsx`

Disabled when `brandId` is `null`. Lists active models for the given `brandId`. When the user changes the brand, the parent is responsible for resetting `value` to `null`; this component does not auto-clear.

- [ ] **Step 28.1: Write the failing test**

```jsx
// src/components/features/assets/ModelSelect.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const useModelsMock = vi.fn();
vi.mock('@/hooks/useModels.js', () => ({
  useModels: (...args) => useModelsMock(...args),
}));

import { ModelSelect } from './ModelSelect.jsx';

describe('ModelSelect', () => {
  it('is disabled when brandId is null', () => {
    useModelsMock.mockReturnValue({ data: [], loading: false, error: null });
    render(<ModelSelect brandId={null} value={null} onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('lists active models for the brand', () => {
    useModelsMock.mockReturnValue({
      data: [
        { modelId: 'm1', brandId: 'b1', name: 'X1', isActive: true },
        { modelId: 'm2', brandId: 'b1', name: 'X2', isActive: true },
        { modelId: 'm3', brandId: 'b1', name: 'Old', isActive: false },
      ],
      loading: false,
      error: null,
    });
    render(<ModelSelect brandId="b1" value={null} onChange={() => {}} />);
    expect(useModelsMock).toHaveBeenCalledWith({ brandId: 'b1' });
    expect(screen.getByText('X1')).toBeInTheDocument();
    expect(screen.getByText('X2')).toBeInTheDocument();
    expect(screen.queryByText('Old')).not.toBeInTheDocument();
  });

  it('emits modelId on change', () => {
    useModelsMock.mockReturnValue({
      data: [{ modelId: 'm1', brandId: 'b1', name: 'X1', isActive: true }],
      loading: false,
      error: null,
    });
    const onChange = vi.fn();
    render(<ModelSelect brandId="b1" value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm1' } });
    expect(onChange).toHaveBeenCalledWith('m1');
  });
});
```

- [ ] **Step 28.2: Run the test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/assets/ModelSelect.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 28.3: Implement the component**

```jsx
// src/components/features/assets/ModelSelect.jsx
import { useTranslation } from 'react-i18next';
import { useModels } from '@/hooks/useModels.js';

/**
 * @param {Object} props
 * @param {string|null} props.brandId
 * @param {string|null} props.value
 * @param {(modelId: string|null) => void} props.onChange
 * @param {string} [props.id]
 */
export function ModelSelect({ brandId, value, onChange, id }) {
  const { t } = useTranslation('assets');
  const { data, loading } = useModels({ brandId });
  const active = data.filter((m) => m.isActive && m.brandId === brandId);
  const disabled = brandId === null || loading;

  return (
    <select
      id={id}
      role="combobox"
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
    >
      <option value="">
        {brandId === null ? t('modelDisabledNoBrand') : t('modelPlaceholder')}
      </option>
      {active.map((model) => (
        <option key={model.modelId} value={model.modelId}>
          {model.name}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 28.4: Run the test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/assets/ModelSelect.test.jsx`
Expected: PASS.

- [ ] **Step 28.5: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/components/features/assets/ModelSelect.jsx src/components/features/assets/ModelSelect.test.jsx`
Expected: 0 errors.

---

### Task 29: `LicenseTypeRadio` component

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/LicenseTypeRadio.jsx`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/LicenseTypeRadio.test.jsx`

Renders three radio buttons for `personal | business | enterprise`. The constant `LICENSE_TYPES` is imported from `src/domain/assets.js` (it must already export it — if not, the domain task adds it). Standalone test treats the constant as `['personal', 'business', 'enterprise']`.

- [ ] **Step 29.1: Write the failing test**

```jsx
// src/components/features/assets/LicenseTypeRadio.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LicenseTypeRadio } from './LicenseTypeRadio.jsx';

describe('LicenseTypeRadio', () => {
  it('renders the three options', () => {
    render(<LicenseTypeRadio value={null} onChange={() => {}} />);
    expect(screen.getByLabelText(/personal/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/business/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/enterprise/i)).toBeInTheDocument();
  });

  it('marks the active value', () => {
    render(<LicenseTypeRadio value="business" onChange={() => {}} />);
    expect(screen.getByLabelText(/business/i)).toBeChecked();
    expect(screen.getByLabelText(/personal/i)).not.toBeChecked();
  });

  it('emits the new value on change', () => {
    const onChange = vi.fn();
    render(<LicenseTypeRadio value={null} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/enterprise/i));
    expect(onChange).toHaveBeenCalledWith('enterprise');
  });
});
```

- [ ] **Step 29.2: Run the test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/assets/LicenseTypeRadio.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 29.3: Implement the component**

```jsx
// src/components/features/assets/LicenseTypeRadio.jsx
import { useTranslation } from 'react-i18next';

const LICENSE_TYPES = ['personal', 'business', 'enterprise'];
const LABEL_KEY = {
  personal: 'licenseTypePersonal',
  business: 'licenseTypeBusiness',
  enterprise: 'licenseTypeEnterprise',
};

/**
 * @param {Object} props
 * @param {'personal'|'business'|'enterprise'|null} props.value
 * @param {(value: 'personal'|'business'|'enterprise') => void} props.onChange
 * @param {string} [props.name]
 */
export function LicenseTypeRadio({ value, onChange, name = 'licenseType' }) {
  const { t } = useTranslation('licenses');
  return (
    <div role="radiogroup" className="flex flex-col gap-2 sm:flex-row sm:gap-4">
      {LICENSE_TYPES.map((type) => (
        <label key={type} className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={name}
            value={type}
            checked={value === type}
            onChange={() => onChange(type)}
            aria-label={t(LABEL_KEY[type])}
          />
          <span>{t(LABEL_KEY[type])}</span>
        </label>
      ))}
    </div>
  );
}
```

- [ ] **Step 29.4: Run the test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/assets/LicenseTypeRadio.test.jsx`
Expected: PASS.

- [ ] **Step 29.5: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/components/features/assets/LicenseTypeRadio.jsx src/components/features/assets/LicenseTypeRadio.test.jsx`
Expected: 0 errors.

---

### Task 30: `LicenseKeyField` component (role-gated, masked input + show/hide + copy)

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/LicenseKeyField.jsx`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/LicenseKeyField.test.jsx`

Behavior:
- Reads `role` from `useAuth()`.
- For `asset_admin` and `employee`: returns `null` (renders nothing).
- For `super_admin` and `tech_admin`: renders a masked text input (`type="password"`) with a "Показать" / "Скрыть" toggle and a "Копировать" button that uses `navigator.clipboard.writeText` against the in-memory value.
- The component is **uncontrolled with a `defaultValue`** to preserve the focus-stealing fix already in place. The parent reads the final value via a ref that the component exposes through a callback prop `onValueChange(value)` invoked on `blur` and on submit.
- Accepts a `resetTick: number` prop. When `resetTick` changes, the component clears its internal input value and calls `onValueChange('')` so the parent ref clears too. This is consumed by the T35 "Save & add another" sticky-defaults flow to wipe the license key after each save.

- [ ] **Step 30.1: Write the failing test**

```jsx
// src/components/features/assets/LicenseKeyField.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const useAuthMock = vi.fn();
vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => useAuthMock(),
}));

import { LicenseKeyField } from './LicenseKeyField.jsx';

describe('LicenseKeyField', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
  });

  it('renders nothing for asset_admin', () => {
    useAuthMock.mockReturnValue({ role: 'asset_admin' });
    const { container } = render(
      <LicenseKeyField defaultValue="" onValueChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for employee', () => {
    useAuthMock.mockReturnValue({ role: 'employee' });
    const { container } = render(
      <LicenseKeyField defaultValue="" onValueChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a masked input for super_admin', () => {
    useAuthMock.mockReturnValue({ role: 'super_admin' });
    render(<LicenseKeyField defaultValue="SECRET" onValueChange={() => {}} />);
    const input = screen.getByLabelText(/license key|ключ лицензии|բանալին/i);
    expect(input).toHaveAttribute('type', 'password');
  });

  it('toggles to visible text on Show', () => {
    useAuthMock.mockReturnValue({ role: 'tech_admin' });
    render(<LicenseKeyField defaultValue="SECRET" onValueChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /show|показать|ցույց/i }));
    const input = screen.getByLabelText(/license key|ключ лицензии|բանալին/i);
    expect(input).toHaveAttribute('type', 'text');
  });

  it('emits new value on blur', () => {
    useAuthMock.mockReturnValue({ role: 'super_admin' });
    const onValueChange = vi.fn();
    render(<LicenseKeyField defaultValue="" onValueChange={onValueChange} />);
    const input = screen.getByLabelText(/license key|ключ лицензии|բանալին/i);
    fireEvent.input(input, { target: { value: 'NEW-VAL' } });
    fireEvent.blur(input);
    expect(onValueChange).toHaveBeenCalledWith('NEW-VAL');
  });

  it('writes value to clipboard on Copy', async () => {
    useAuthMock.mockReturnValue({ role: 'super_admin' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<LicenseKeyField defaultValue="SECRET" onValueChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /copy|копировать|պատճենել/i }));
    expect(writeText).toHaveBeenCalledWith('SECRET');
  });
});
```

- [ ] **Step 30.2: Run the test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/assets/LicenseKeyField.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 30.3: Implement the component**

```jsx
// src/components/features/assets/LicenseKeyField.jsx
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { ROLES } from '@/domain/roles.js';

const PRIVILEGED_ROLES = [ROLES.SUPER_ADMIN, ROLES.TECH_ADMIN];

/**
 * Uncontrolled masked input for the license key. Hidden entirely for
 * non-privileged roles. Emits the current value via `onValueChange` on
 * blur. The current value is held in the input element's DOM state so
 * we never round-trip the secret through React's render path beyond
 * the explicit blur handler.
 *
 * @param {Object} props
 * @param {string} [props.defaultValue]
 * @param {(value: string) => void} props.onValueChange
 * @param {string} [props.id]
 * @param {string} [props.name]
 */
export function LicenseKeyField({
  defaultValue = '',
  onValueChange,
  id = 'licenseKey',
  name = 'licenseKey',
}) {
  const { role } = useAuth();
  const { t } = useTranslation('licenses');
  const inputRef = useRef(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!PRIVILEGED_ROLES.includes(role)) {
    return null;
  }

  function handleCopy() {
    const value = inputRef.current?.value ?? '';
    if (!value) return;
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {t('licenseKey')}
      </label>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          id={id}
          name={name}
          type={revealed ? 'text' : 'password'}
          defaultValue={defaultValue}
          onBlur={(e) => onValueChange(e.target.value)}
          aria-label={t('licenseKey')}
          autoComplete="off"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm font-mono"
        />
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          className="rounded-md border px-2 py-1 text-xs"
        >
          {revealed ? t('licenseKeyHide') : t('licenseKeyShow')}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-md border px-2 py-1 text-xs"
        >
          {copied ? t('licenseKeyCopied') : t('licenseKeyCopy')}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{t('licenseKeyAdminOnlyHint')}</p>
    </div>
  );
}
```

- [ ] **Step 30.4: Run the test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/assets/LicenseKeyField.test.jsx`
Expected: PASS.

- [ ] **Step 30.5: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/components/features/assets/LicenseKeyField.jsx src/components/features/assets/LicenseKeyField.test.jsx`
Expected: 0 errors.

---

### Task 31: `LicenseKeyDialog` component (Управлять ключом)

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/LicenseKeyDialog.jsx`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/LicenseKeyDialog.test.jsx`

A modal dialog opened from `AssetDetailPage`. On open, calls `useLicenseSecret({ assetId }).getKey()` once, populates the masked field, and closes via Save (calls `setKey`) or Cancel.

- [ ] **Step 31.1: Write the failing test**

```jsx
// src/components/features/assets/LicenseKeyDialog.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const getKeyMock = vi.fn();
const setKeyMock = vi.fn();
vi.mock('@/hooks/useLicenseSecret.js', () => ({
  useLicenseSecret: () => ({
    getKey: getKeyMock,
    setKey: setKeyMock,
    loading: false,
    error: null,
  }),
}));
vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ role: 'super_admin' }),
}));

import { LicenseKeyDialog } from './LicenseKeyDialog.jsx';

describe('LicenseKeyDialog', () => {
  beforeEach(() => {
    getKeyMock.mockReset();
    setKeyMock.mockReset();
  });

  it('fetches the existing key on open', async () => {
    getKeyMock.mockResolvedValue('OLD-KEY');
    render(
      <LicenseKeyDialog assetId="a1" open onOpenChange={() => {}} />,
    );
    await waitFor(() => expect(getKeyMock).toHaveBeenCalledWith());
  });

  it('saves the new key on Save', async () => {
    getKeyMock.mockResolvedValue('OLD-KEY');
    setKeyMock.mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <LicenseKeyDialog
        assetId="a1"
        open
        onOpenChange={onOpenChange}
      />,
    );
    await waitFor(() => expect(getKeyMock).toHaveBeenCalled());
    const input = screen.getByLabelText(/license key|ключ лицензии|բանալին/i);
    fireEvent.input(input, { target: { value: 'NEW-KEY' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: /save|сохранить|պահպանել/i }));
    await waitFor(() => expect(setKeyMock).toHaveBeenCalledWith('NEW-KEY'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('does not call setKey on Cancel', async () => {
    getKeyMock.mockResolvedValue('OLD-KEY');
    const onOpenChange = vi.fn();
    render(
      <LicenseKeyDialog
        assetId="a1"
        open
        onOpenChange={onOpenChange}
      />,
    );
    await waitFor(() => expect(getKeyMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /cancel|отмена|չեղարկել/i }));
    expect(setKeyMock).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 31.2: Run the test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/assets/LicenseKeyDialog.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 31.3: Implement the component**

```jsx
// src/components/features/assets/LicenseKeyDialog.jsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { useLicenseSecret } from '@/hooks/useLicenseSecret.js';
import { LicenseKeyField } from './LicenseKeyField.jsx';

/**
 * @param {Object} props
 * @param {string} props.assetId
 * @param {boolean} props.open
 * @param {(open: boolean) => void} props.onOpenChange
 */
export function LicenseKeyDialog({ assetId, open, onOpenChange }) {
  const { t } = useTranslation('licenses');
  const { getKey, setKey } = useLicenseSecret({ assetId });
  const [initial, setInitial] = useState(null);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getKey()
      .then((value) => {
        if (cancelled) return;
        setInitial(value ?? '');
        setPending(value ?? '');
      })
      .catch(() => {
        if (cancelled) return;
        setInitial('');
        setPending('');
      });
    return () => {
      cancelled = true;
    };
  }, [open, getKey]);

  async function handleSave() {
    if (pending === null || pending === initial) {
      onOpenChange(false);
      return;
    }
    await setKey(pending);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('manageKeyDialogTitle')}</DialogTitle>
        </DialogHeader>
        {initial !== null ? (
          <LicenseKeyField
            defaultValue={initial}
            onValueChange={(v) => setPending(v)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">…</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('manageKeyDialogCancel')}
          </Button>
          <Button onClick={handleSave}>{t('manageKeyDialogSave')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 31.4: Run the test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/assets/LicenseKeyDialog.test.jsx`
Expected: PASS.

- [ ] **Step 31.5: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/components/features/assets/LicenseKeyDialog.jsx src/components/features/assets/LicenseKeyDialog.test.jsx`
Expected: 0 errors.

---

### Task 32: `LicenseFieldsBlock` component (Group 6)

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/LicenseFieldsBlock.jsx`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/LicenseFieldsBlock.test.jsx`

Composes `LicenseTypeRadio`, two date inputs (`subscribedAt`, `expiresAt`), and `LicenseKeyField`. Validates `expiresAt > subscribedAt` and displays the `errorExpiresBeforeSubscribed` key when violated. Renders **only** when the parent passes `categoryId === 'license'`. The block accepts a `value` object `{ licenseType, subscribedAt, expiresAt }` and emits via `onChange(patch)` (partial update).

- [ ] **Step 32.1: Write the failing test**

```jsx
// src/components/features/assets/LicenseFieldsBlock.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ role: 'super_admin' }),
}));

import { LicenseFieldsBlock } from './LicenseFieldsBlock.jsx';

describe('LicenseFieldsBlock', () => {
  const baseValue = {
    licenseType: null,
    subscribedAt: null,
    expiresAt: null,
  };

  it('emits licenseType change', () => {
    const onChange = vi.fn();
    render(
      <LicenseFieldsBlock value={baseValue} onChange={onChange} onLicenseKeyChange={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText(/business/i));
    expect(onChange).toHaveBeenCalledWith({ licenseType: 'business' });
  });

  it('emits subscribedAt change', () => {
    const onChange = vi.fn();
    render(
      <LicenseFieldsBlock value={baseValue} onChange={onChange} onLicenseKeyChange={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText(/subscribed at|дата подписки|բաժանորդագրման/i), {
      target: { value: '2026-01-01' },
    });
    expect(onChange).toHaveBeenCalledWith({ subscribedAt: '2026-01-01' });
  });

  it('shows expiresBeforeSubscribed error when dates inverted', () => {
    render(
      <LicenseFieldsBlock
        value={{
          licenseType: 'personal',
          subscribedAt: '2026-06-01',
          expiresAt: '2026-01-01',
        }}
        onChange={() => {}}
        onLicenseKeyChange={() => {}}
      />,
    );
    expect(
      screen.getByText(/expiry date must be after|должна быть позже|ուշ լինի/i),
    ).toBeInTheDocument();
  });

  it('forwards license-key changes to onLicenseKeyChange', () => {
    const onLicenseKeyChange = vi.fn();
    render(
      <LicenseFieldsBlock
        value={baseValue}
        onChange={() => {}}
        onLicenseKeyChange={onLicenseKeyChange}
      />,
    );
    const input = screen.getByLabelText(/license key|ключ лицензии|բանալին/i);
    fireEvent.input(input, { target: { value: 'KEY-1' } });
    fireEvent.blur(input);
    expect(onLicenseKeyChange).toHaveBeenCalledWith('KEY-1');
  });
});
```

- [ ] **Step 32.2: Run the test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/assets/LicenseFieldsBlock.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 32.3: Implement the component**

```jsx
// src/components/features/assets/LicenseFieldsBlock.jsx
import { useTranslation } from 'react-i18next';
import { LicenseTypeRadio } from './LicenseTypeRadio.jsx';
import { LicenseKeyField } from './LicenseKeyField.jsx';

function isExpiresBeforeSubscribed(value) {
  if (!value.subscribedAt || !value.expiresAt) return false;
  return new Date(value.expiresAt) <= new Date(value.subscribedAt);
}

/**
 * @param {Object} props
 * @param {{licenseType: ('personal'|'business'|'enterprise'|null), subscribedAt: string|null, expiresAt: string|null}} props.value
 * @param {(patch: Object) => void} props.onChange
 * @param {(value: string) => void} props.onLicenseKeyChange
 * @param {string} [props.licenseKeyDefault]
 */
export function LicenseFieldsBlock({
  value,
  onChange,
  onLicenseKeyChange,
  licenseKeyDefault = '',
}) {
  const { t } = useTranslation('licenses');
  const dateError = isExpiresBeforeSubscribed(value);

  return (
    <fieldset className="flex flex-col gap-4 rounded-md border p-4">
      <legend className="px-1 text-sm font-semibold">{t('licenseType')}</legend>
      <LicenseTypeRadio
        value={value.licenseType}
        onChange={(licenseType) => onChange({ licenseType })}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('subscribedAt')}</span>
          <input
            type="date"
            value={value.subscribedAt ?? ''}
            onChange={(e) => onChange({ subscribedAt: e.target.value || null })}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('expiresAt')}</span>
          <input
            type="date"
            value={value.expiresAt ?? ''}
            onChange={(e) => onChange({ expiresAt: e.target.value || null })}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>
      {dateError ? (
        <p className="text-sm text-destructive">{t('errorExpiresBeforeSubscribed')}</p>
      ) : null}
      <LicenseKeyField defaultValue={licenseKeyDefault} onValueChange={onLicenseKeyChange} />
      <p className="text-xs text-muted-foreground">{t('licenseKeyHelpHint')}</p>
    </fieldset>
  );
}
```

- [ ] **Step 32.4: Run the test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/assets/LicenseFieldsBlock.test.jsx`
Expected: PASS.

- [ ] **Step 32.5: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/components/features/assets/LicenseFieldsBlock.jsx src/components/features/assets/LicenseFieldsBlock.test.jsx`
Expected: 0 errors.

---

### Task 33: `AssetCreatePreviewDialog` component

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/AssetCreatePreviewDialog.jsx`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/AssetCreatePreviewDialog.test.jsx`

Pure presentation: receives a `preview` object already shaped by the parent (composed title via `formatAssetTitle`, holder summary line, license summary lines without the key value, etc.). Buttons: **Назад** → calls `onBack()`; **Создать** → calls `onConfirm()`.

- [ ] **Step 33.1: Write the failing test**

```jsx
// src/components/features/assets/AssetCreatePreviewDialog.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssetCreatePreviewDialog } from './AssetCreatePreviewDialog.jsx';

const previewBase = {
  composedTitle: 'Laptop · HP · EliteBook 840 G6',
  inventoryCode: '450/302042',
  subtypeName: 'Laptop',
  brandName: 'HP',
  modelName: 'EliteBook 840 G6',
  holderSummary: 'Сотрудник: Иван Иванов',
  branchName: 'HQ',
  conditionLabel: 'Новый',
  warrantyWindow: '2026-01-01 → 2027-01-01',
  purchasePriceFormatted: '1,200 USD',
  licenseSummary: null,
};

describe('AssetCreatePreviewDialog', () => {
  it('renders the composed title', () => {
    render(
      <AssetCreatePreviewDialog
        open
        preview={previewBase}
        onBack={() => {}}
        onConfirm={() => {}}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByText('Laptop · HP · EliteBook 840 G6')).toBeInTheDocument();
  });

  it('shows "—" when inventoryCode is null', () => {
    render(
      <AssetCreatePreviewDialog
        open
        preview={{ ...previewBase, inventoryCode: null }}
        onBack={() => {}}
        onConfirm={() => {}}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows license summary rows when licenseSummary is present', () => {
    render(
      <AssetCreatePreviewDialog
        open
        preview={{
          ...previewBase,
          licenseSummary: {
            licenseTypeLabel: 'Корпоративная',
            subscribedAtFormatted: '2026-01-01',
            expiresAtFormatted: '2027-01-01',
            licenseKeySetLabel: 'Введён',
          },
        }}
        onBack={() => {}}
        onConfirm={() => {}}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByText('Корпоративная')).toBeInTheDocument();
    expect(screen.getByText('Введён')).toBeInTheDocument();
  });

  it('does NOT render the license key value, ever', () => {
    const { container } = render(
      <AssetCreatePreviewDialog
        open
        preview={{
          ...previewBase,
          licenseSummary: {
            licenseTypeLabel: 'Корпоративная',
            subscribedAtFormatted: '2026-01-01',
            expiresAtFormatted: '2027-01-01',
            licenseKeySetLabel: 'Введён',
          },
        }}
        onBack={() => {}}
        onConfirm={() => {}}
        onOpenChange={() => {}}
      />,
    );
    expect(container.innerHTML).not.toMatch(/key-?value/i);
  });

  it('calls onBack on Back', () => {
    const onBack = vi.fn();
    render(
      <AssetCreatePreviewDialog
        open
        preview={previewBase}
        onBack={onBack}
        onConfirm={() => {}}
        onOpenChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /back|назад|հետ/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it('calls onConfirm on Create', () => {
    const onConfirm = vi.fn();
    render(
      <AssetCreatePreviewDialog
        open
        preview={previewBase}
        onBack={() => {}}
        onConfirm={onConfirm}
        onOpenChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /create|создать|ստեղծել/i }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
```

- [ ] **Step 33.2: Run the test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/assets/AssetCreatePreviewDialog.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 33.3: Implement the component**

```jsx
// src/components/features/assets/AssetCreatePreviewDialog.jsx
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-2 gap-2 border-b py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children ?? '—'}</span>
    </div>
  );
}

/**
 * @param {Object} props
 * @param {boolean} props.open
 * @param {Object} props.preview
 * @param {() => void} props.onBack
 * @param {() => void} props.onConfirm
 * @param {(open: boolean) => void} props.onOpenChange
 */
export function AssetCreatePreviewDialog({ open, preview, onBack, onConfirm, onOpenChange }) {
  const { t } = useTranslation('assets');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('previewTitle')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold">{preview.composedTitle}</p>
          <Row label={t('previewInventoryCodeRow')}>
            {preview.inventoryCode ?? '—'}
          </Row>
          {preview.subtypeName ? (
            <Row label={t('previewSubtypeRow')}>{preview.subtypeName}</Row>
          ) : null}
          {preview.brandName ? (
            <Row label={t('previewBrandRow')}>{preview.brandName}</Row>
          ) : null}
          {preview.modelName ? (
            <Row label={t('previewModelRow')}>{preview.modelName}</Row>
          ) : null}
          {preview.licenseSummary ? (
            <>
              <Row label={t('previewLicenseTypeRow')}>
                {preview.licenseSummary.licenseTypeLabel}
              </Row>
              <Row label={t('previewSubscribedAtRow')}>
                {preview.licenseSummary.subscribedAtFormatted}
              </Row>
              <Row label={t('previewExpiresAtRow')}>
                {preview.licenseSummary.expiresAtFormatted}
              </Row>
              <Row label={t('previewLicenseKeyRow')}>
                {preview.licenseSummary.licenseKeySetLabel}
              </Row>
            </>
          ) : null}
          <Row label={t('previewHolderRow')}>{preview.holderSummary}</Row>
          <Row label={t('previewBranchRow')}>{preview.branchName}</Row>
          <Row label={t('previewConditionRow')}>{preview.conditionLabel}</Row>
          <Row label={t('previewWarrantyRow')}>{preview.warrantyWindow}</Row>
          <Row label={t('previewPurchasePriceRow')}>{preview.purchasePriceFormatted}</Row>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onBack}>
            {t('previewBackButton')}
          </Button>
          <Button onClick={onConfirm}>{t('previewCreateButton')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 33.4: Run the test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/assets/AssetCreatePreviewDialog.test.jsx`
Expected: PASS.

- [ ] **Step 33.5: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/components/features/assets/AssetCreatePreviewDialog.jsx src/components/features/assets/AssetCreatePreviewDialog.test.jsx`
Expected: 0 errors.

---

### Task 34: `LicenseExpiryBadge` component

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/LicenseExpiryBadge.jsx`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/LicenseExpiryBadge.test.jsx`

Reads `licenseExpiryWarningDays` from `useNotificationSettings()`. Computes:
- If `expiresAt - now ≤ thresholdDays` and `> 0`: render `expiryBadgeSoon` with the day count.
- If `expiresAt < now`: render `expiryBadgePast` with the day count past.
- Otherwise: render nothing.

- [ ] **Step 34.1: Write the failing test**

```jsx
// src/components/features/assets/LicenseExpiryBadge.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/useNotificationSettings.js', () => ({
  useNotificationSettings: () => ({
    data: { licenseExpiryWarningDays: 30 },
    loading: false,
    error: null,
  }),
}));

import { LicenseExpiryBadge } from './LicenseExpiryBadge.jsx';

describe('LicenseExpiryBadge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-08T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when expiry is far in the future', () => {
    const { container } = render(
      <LicenseExpiryBadge expiresAt={new Date('2027-01-01T00:00:00Z')} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders soon-badge when expiry is within threshold', () => {
    render(
      <LicenseExpiryBadge expiresAt={new Date('2026-05-20T00:00:00Z')} />,
    );
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it('renders past-badge when expiry is in the past', () => {
    render(
      <LicenseExpiryBadge expiresAt={new Date('2026-04-28T00:00:00Z')} />,
    );
    expect(screen.getByText(/10/)).toBeInTheDocument();
  });

  it('renders nothing when expiresAt is null', () => {
    const { container } = render(<LicenseExpiryBadge expiresAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 34.2: Run the test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/assets/LicenseExpiryBadge.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 34.3: Implement the component**

```jsx
// src/components/features/assets/LicenseExpiryBadge.jsx
import { useTranslation } from 'react-i18next';
import { useNotificationSettings } from '@/hooks/useNotificationSettings.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  if (typeof value.toDate === 'function') return value.toDate();
  return null;
}

/**
 * @param {Object} props
 * @param {Date|string|number|{toDate: () => Date}|null} props.expiresAt
 */
export function LicenseExpiryBadge({ expiresAt }) {
  const { t } = useTranslation('licenses');
  const { data } = useNotificationSettings();
  const expires = toDate(expiresAt);
  if (!expires) return null;

  const now = new Date();
  const diffDays = Math.round((expires.getTime() - now.getTime()) / ONE_DAY_MS);
  const threshold = data.licenseExpiryWarningDays;

  if (diffDays < 0) {
    return (
      <span className="inline-flex rounded-md bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
        {t('expiryBadgePast', { days: Math.abs(diffDays) })}
      </span>
    );
  }
  if (diffDays <= threshold) {
    return (
      <span className="inline-flex rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
        {t('expiryBadgeSoon', { days: diffDays })}
      </span>
    );
  }
  return null;
}
```

- [ ] **Step 34.4: Run the test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/assets/LicenseExpiryBadge.test.jsx`
Expected: PASS.

- [ ] **Step 34.5: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/components/features/assets/LicenseExpiryBadge.jsx src/components/features/assets/LicenseExpiryBadge.test.jsx`
Expected: 0 errors.

---

## Page-level UI (Tasks 35–40)

### Task 35: `AssetFormDialog` refactor — 5 progressive groups + Group 6 + preview integration

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/AssetFormDialog.jsx`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/AssetFormDialog.test.jsx`

This is the largest refactor in the plan. The work is broken into many small steps so each one is testable.

#### Behavior contract

1. **Single dialog, no wizard.** The dialog body scrolls. Groups appear in DOM order top-to-bottom: Group 1, Group 2, [Group 6 if license], Group 3, Group 4 (collapsed `<Accordion>`), Group 5.
2. **Disclosure rules.**
   - Group 1: always visible. Subtype dropdown is `disabled` until Category is picked. Brand and Model dropdowns are **rendered only when** `category.requiresMultilang === false`. Model dropdown is `disabled` until Brand is picked.
   - Group 2: visible once Category and Subtype are both set. Inventory-code preview is rendered **only when** `category.assignsInventoryCode === true`. Name (`<MultiLangInput>`) is rendered **only when** `category.requiresMultilang === true`.
   - Group 6: visible only when `category.id === 'license'`. License key sub-field hidden for non-privileged roles (handled inside `LicenseKeyField`).
   - Group 3: visible once Category is set.
   - Group 4: visible once Category is set, body collapsed by default.
   - Group 5: visible once Category is set.
3. **Submit pathway differs for create vs edit.**
   - Create: clicking the primary "Далее" button at the bottom of the form opens `AssetCreatePreviewDialog`. The preview's "Создать" button calls the same `onSubmit` handler the edit pathway uses directly.
   - Edit: clicking the primary "Сохранить" button calls `onSubmit` directly without a preview.
4. **Uncontrolled-input pattern preserved.** All text fields keep their existing pattern (the focus-stealing fix already in `AssetFormDialog`). New fields follow the same convention: `defaultValue` + `onBlur` for primary text, controlled wrappers for radios / dates / selects (these were never affected by the focus issue).
5. **Inventory-code preview** is rendered as `<input readOnly value={previewCode}>`. Source: `useInventoryCodePreview(categoryId)` — the existing hook. When `category.assignsInventoryCode === false`, the parent does not call the hook, the field does not render, and the asset is created with `inventoryCode: null`.
6. **License key handling.** The form keeps the typed key in a `licenseKeyRef` (a `useRef` outside React state) populated by `LicenseKeyField.onValueChange`. On submit, the parent passes the ref's current value down to `firestoreAssetRepository.create({ asset, licenseKey })` — the value never enters React's render path.
7. **Audit-log invariant for the license key.** The form does NOT add the license key to any logged object. `console.log` of any debug prints during this task must redact it.
8. **Sticky-defaults / "Save & add another" (create mode only).** The dialog footer in create mode has THREE buttons in this order: "Отмена", "Далее" (opens preview), "Сохранить и добавить ещё" (bypasses preview, saves, keeps the dialog open with sticky fields preserved). Edit mode keeps the existing two-button footer.
   - **Sticky fields** (preserved across saves in the session): `categoryId, subtypeId, brandId, modelId, branchId, departmentId, holderType, statusId, condition, purchaseDate, purchasePrice, warrantyStart, warrantyEnd, currency, notes`. These are common across a batch of similar assets.
   - **Reset fields** (cleared after each "Save & add another"): `serialNumber, name (if multilang), employeeId, licenseType, subscribedAt, expiresAt, licenseKey`. These are unique per asset.
   - **Focus management**: after a successful "Save & add another", the form re-renders and the cursor jumps to the `serialNumber` input via a `useEffect` keyed on a `lastSavedTick` counter.
   - **Counter feedback**: button label shows `t('saveAndAddAnother')` with a parenthetical count, e.g. `Сохранить и добавить ещё (3 добавлено)`. Counter resets when the dialog is closed.
   - **Validation**: the same validators run; if the asset is invalid, the dialog stays open with errors and the counter does not increment.
   - **License-key reset**: `licenseKeyRef.current = ''` is set after every save. The `LicenseKeyField` component must accept a controlled `resetTick` prop (or equivalent) so its internal input clears when the parent's tick changes.

- [ ] **Step 35.1: Add a smoke test ensuring the new groups render conditionally**

Replace the previous `AssetFormDialog.test.jsx` content with the new test file. Keep any existing render-helper imports.

```jsx
// src/components/features/assets/AssetFormDialog.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const useCategoriesMock = vi.fn(() => ({
  data: [
    { id: 'device', requiresMultilang: false, assignsInventoryCode: true, attachableTo: ['employee', 'branch'] },
    { id: 'license', requiresMultilang: false, assignsInventoryCode: false, attachableTo: ['employee', 'asset'] },
    { id: 'furniture', requiresMultilang: true, assignsInventoryCode: true, attachableTo: ['branch', 'department'] },
  ],
  loading: false,
  error: null,
}));
const useSubtypesMock = vi.fn(() => ({ data: [], loading: false, error: null }));
const useBrandsMock = vi.fn(() => ({ data: [], loading: false, error: null }));
const useModelsMock = vi.fn(() => ({ data: [], loading: false, error: null }));
const useNotificationSettingsMock = vi.fn(() => ({ data: { licenseExpiryWarningDays: 30 }, loading: false, error: null }));
const useInventoryCodePreviewMock = vi.fn(() => ({ value: '450/302042', loading: false }));

vi.mock('@/hooks/useCategories.js', () => ({ useCategories: () => useCategoriesMock() }));
vi.mock('@/hooks/useSubtypes.js', () => ({ useSubtypes: () => useSubtypesMock() }));
vi.mock('@/hooks/useBrands.js', () => ({ useBrands: () => useBrandsMock() }));
vi.mock('@/hooks/useModels.js', () => ({ useModels: () => useModelsMock() }));
vi.mock('@/hooks/useNotificationSettings.js', () => ({ useNotificationSettings: () => useNotificationSettingsMock() }));
vi.mock('@/hooks/useInventoryCodePreview.js', () => ({ useInventoryCodePreview: () => useInventoryCodePreviewMock() }));
vi.mock('@/contexts/AuthContext.jsx', () => ({ useAuth: () => ({ role: 'super_admin' }) }));

import AssetFormDialog from './AssetFormDialog.jsx';

const baseProps = {
  open: true,
  mode: 'create',
  initialAsset: null,
  onSubmit: vi.fn(),
  onOpenChange: vi.fn(),
};

describe('AssetFormDialog — progressive disclosure', () => {
  it('hides Brand and Model dropdowns when category requires multi-lang (Furniture)', () => {
    render(<AssetFormDialog {...baseProps} initialAsset={{ categoryId: 'furniture' }} />);
    expect(screen.queryByLabelText(/brand|бренд|բրենդ/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/model|модель|մոդել/i)).not.toBeInTheDocument();
  });

  it('shows Brand and Model dropdowns for Device', () => {
    render(<AssetFormDialog {...baseProps} initialAsset={{ categoryId: 'device' }} />);
    expect(screen.getByLabelText(/brand|бренд|բրենդ/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/model|модель|մոդել/i)).toBeInTheDocument();
  });

  it('hides Name field for Device/License', () => {
    render(<AssetFormDialog {...baseProps} initialAsset={{ categoryId: 'device' }} />);
    expect(screen.queryByLabelText(/^name|^наименование|^անվանում/i)).not.toBeInTheDocument();
  });

  it('shows Name field for Furniture', () => {
    render(<AssetFormDialog {...baseProps} initialAsset={{ categoryId: 'furniture' }} />);
    expect(screen.getByLabelText(/name \(ru\)|наименование/i)).toBeInTheDocument();
  });

  it('hides inventory-code preview for license category', () => {
    render(<AssetFormDialog {...baseProps} initialAsset={{ categoryId: 'license' }} />);
    expect(screen.queryByDisplayValue('450/302042')).not.toBeInTheDocument();
  });

  it('shows License-only block for license category', () => {
    render(<AssetFormDialog {...baseProps} initialAsset={{ categoryId: 'license' }} />);
    expect(screen.getByLabelText(/personal/i)).toBeInTheDocument();
  });

  it('does NOT show License-only block for device category', () => {
    render(<AssetFormDialog {...baseProps} initialAsset={{ categoryId: 'device' }} />);
    expect(screen.queryByLabelText(/personal/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 35.2: Run the test against the existing component to confirm baseline failure**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/assets/AssetFormDialog.test.jsx`
Expected: FAIL — current component does not honor `assignsInventoryCode` and lacks license block, brand/model selects.

- [ ] **Step 35.3: Refactor `AssetFormDialog` — Group 1**

Replace the Category/Subtype block at the top of the existing form with the following structure (keeping any other imports/context/use-translation hooks already present):

```jsx
{/* Group 1 — What is it? */}
<fieldset className="flex flex-col gap-3">
  <legend className="text-sm font-semibold">{t('groupWhatIsIt')}</legend>
  <CategorySelect
    value={categoryId}
    onChange={(next) => {
      setCategoryId(next);
      setSubtypeId(null);
      setBrandId(null);
      setModelId(null);
    }}
  />
  <SubtypeSelect
    categoryId={categoryId}
    value={subtypeId}
    onChange={setSubtypeId}
  />
  {category && category.requiresMultilang === false ? (
    <>
      <label htmlFor="brand-select" className="text-sm font-medium">{t('brandLabel')}</label>
      <BrandSelect
        id="brand-select"
        value={brandId}
        onChange={(next) => {
          setBrandId(next);
          setModelId(null);
        }}
      />
      <label htmlFor="model-select" className="text-sm font-medium">{t('modelLabel')}</label>
      <ModelSelect
        id="model-select"
        brandId={brandId}
        value={modelId}
        onChange={setModelId}
      />
    </>
  ) : null}
</fieldset>
```

Where `category` is derived from `categoryId` via `categories.find((c) => c.id === categoryId)`.

- [ ] **Step 35.4: Refactor Group 2 — Identifiers**

```jsx
{categoryId && subtypeId ? (
  <fieldset className="flex flex-col gap-3">
    <legend className="text-sm font-semibold">{t('groupIdentifiers')}</legend>
    {category?.assignsInventoryCode ? (
      <label className="flex flex-col gap-1 text-sm">
        <span>{t('inventoryCode')}</span>
        <input readOnly value={inventoryPreview ?? ''} className="rounded-md border bg-muted px-3 py-2 text-sm" />
      </label>
    ) : null}
    <label className="flex flex-col gap-1 text-sm">
      <span>{t('serialNumber')}</span>
      <input
        defaultValue={initialAsset?.serialNumber ?? ''}
        onBlur={(e) => setSerialNumber(e.target.value)}
        className="rounded-md border bg-background px-3 py-2 text-sm"
      />
    </label>
    {category?.requiresMultilang ? (
      <MultiLangInput
        labelKey="name"
        defaultValue={initialAsset?.name ?? { ru: '', en: '', hy: '' }}
        onBlur={setName}
      />
    ) : null}
  </fieldset>
) : null}
```

The `inventoryPreview` value comes from `const { value: inventoryPreview } = useInventoryCodePreview(category?.assignsInventoryCode ? categoryId : null);`. When `categoryId` is null in the hook call, the hook short-circuits and returns `{ value: null }` — that is the existing behavior of `useInventoryCodePreview` (the parameter accepting `null` must be added if not already present; if it is not already present, that small extension is part of this step).

- [ ] **Step 35.5: Insert Group 6 — License-only block**

Immediately after Group 2, conditionally render:

```jsx
{categoryId === 'license' ? (
  <LicenseFieldsBlock
    value={{
      licenseType,
      subscribedAt,
      expiresAt,
    }}
    onChange={(patch) => {
      if ('licenseType' in patch) setLicenseType(patch.licenseType);
      if ('subscribedAt' in patch) setSubscribedAt(patch.subscribedAt);
      if ('expiresAt' in patch) setExpiresAt(patch.expiresAt);
    }}
    onLicenseKeyChange={(value) => {
      licenseKeyRef.current = value;
    }}
    licenseKeyDefault={initialLicenseKey}
  />
) : null}
```

Add at the top of the component:

```javascript
const licenseKeyRef = useRef(initialLicenseKey ?? '');
```

`initialLicenseKey` is a prop. For create it is the empty string. For edit it is the value pre-fetched by the page (super_admin / tech_admin only — for asset_admin the page omits the prop and `LicenseKeyField` renders nothing).

- [ ] **Step 35.6: Refactor Group 3 — Where is it?**

Keep the existing branch + `assignedTo` picker unchanged. Wrap them in:

```jsx
{categoryId ? (
  <fieldset className="flex flex-col gap-3">
    <legend className="text-sm font-semibold">{t('groupWhereIsIt')}</legend>
    {/* ... existing branch + assigned-to controls ... */}
  </fieldset>
) : null}
```

- [ ] **Step 35.7: Refactor Group 4 — Money & warranty (collapsed accordion)**

```jsx
{categoryId ? (
  <Accordion type="single" collapsible defaultValue="" className="w-full">
    <AccordionItem value="more">
      <AccordionTrigger>{t('groupMoneyWarranty')}</AccordionTrigger>
      <AccordionContent>
        {/* existing purchase-date / price / warranty / condition controls */}
      </AccordionContent>
    </AccordionItem>
  </Accordion>
) : null}
```

- [ ] **Step 35.8: Refactor Group 5 — Notes**

```jsx
{categoryId ? (
  <fieldset className="flex flex-col gap-3">
    <legend className="text-sm font-semibold">{t('groupNotes')}</legend>
    <textarea
      defaultValue={initialAsset?.notes ?? ''}
      onBlur={(e) => setNotes(e.target.value)}
      rows={4}
      className="rounded-md border bg-background px-3 py-2 text-sm"
    />
  </fieldset>
) : null}
```

- [ ] **Step 35.9: Wire create-mode preview**

For `mode === 'create'`, the dialog footer's primary button label is `t('nextButton')` and its handler opens the preview. For `mode === 'edit'`, the label is `t('save')` (already present) and the handler calls `submit` directly.

```jsx
const [previewOpen, setPreviewOpen] = useState(false);

function buildPreview() {
  // pure: derives composedTitle, holderSummary, licenseSummary (without key value), etc.
  return {
    composedTitle: formatAssetTitle(
      { categoryId, name, brandId, modelId },
      { brand: brandLookup, model: modelLookup, subtype: subtypeLookup },
      i18n.resolvedLanguage,
    ),
    inventoryCode: category?.assignsInventoryCode ? inventoryPreview : null,
    subtypeName: subtypeLookup?.name ?? null,
    brandName: brandLookup?.name ?? null,
    modelName: modelLookup?.name ?? null,
    holderSummary: composeHolderSummary(),
    branchName: branchLookup?.name ?? '—',
    conditionLabel: condition === 'new' ? t('conditionNew') : t('conditionUsed'),
    warrantyWindow: warrantyStart && warrantyEnd ? `${warrantyStart} → ${warrantyEnd}` : '—',
    purchasePriceFormatted: formatPrice(purchasePrice, currency),
    licenseSummary:
      categoryId === 'license'
        ? {
            licenseTypeLabel: licenseType ? tLicenses(`licenseType${capitalize(licenseType)}`) : '—',
            subscribedAtFormatted: subscribedAt ?? '—',
            expiresAtFormatted: expiresAt ?? '—',
            licenseKeySetLabel:
              (licenseKeyRef.current ?? '').length > 0
                ? tLicenses('licenseKeySetTrue')
                : tLicenses('licenseKeySetFalse'),
          }
        : null,
  };
}

async function handleSubmit() {
  await onSubmit({
    asset: buildAssetPayload(),
    licenseKey:
      categoryId === 'license' ? (licenseKeyRef.current ?? '') : null,
  });
  onOpenChange(false);
}
```

Footer:

```jsx
<DialogFooter>
  <Button variant="outline" onClick={() => onOpenChange(false)}>
    {t('cancel')}
  </Button>
  {mode === 'create' ? (
    <>
      <Button variant="outline" onClick={handleSaveAndAddAnother} disabled={busy}>
        {addedCount > 0
          ? t('saveAndAddAnotherWithCount', { count: addedCount })
          : t('saveAndAddAnother')}
      </Button>
      <Button onClick={() => setPreviewOpen(true)}>{t('nextButton')}</Button>
    </>
  ) : (
    <Button onClick={handleSubmit}>{t('save')}</Button>
  )}
</DialogFooter>

{mode === 'create' ? (
  <AssetCreatePreviewDialog
    open={previewOpen}
    preview={buildPreview()}
    onBack={() => setPreviewOpen(false)}
    onConfirm={async () => {
      await handleSubmit();
      setPreviewOpen(false);
    }}
    onOpenChange={setPreviewOpen}
  />
) : null}
```

- [ ] **Step 35.10: Implement `handleSaveAndAddAnother` and the sticky-defaults reset logic**

Inside `AssetFormDialog`, add the following state + handler. Place near the other state declarations:

```jsx
const [addedCount, setAddedCount] = useState(0);
const [lastSavedTick, setLastSavedTick] = useState(0);
const serialInputRef = useRef(null);

useEffect(() => {
  if (lastSavedTick > 0 && serialInputRef.current) {
    serialInputRef.current.focus();
  }
}, [lastSavedTick]);

async function handleSaveAndAddAnother() {
  if (busy) return;
  const validationError = runValidators(); // existing local validator wrapper
  if (validationError) return;
  setBusy(true);
  try {
    await onSubmit({
      asset: buildAssetPayload(),
      licenseKey: categoryId === 'license' ? (licenseKeyRef.current ?? '') : null,
    });
    // Reset only the per-asset fields. Sticky fields stay in place.
    setSerialNumber('');
    setName(category?.requiresMultilang ? { ru: '', en: '', hy: '' } : '');
    setEmployeeId(null);
    setLicenseType(null);
    setSubscribedAt(null);
    setExpiresAt(null);
    licenseKeyRef.current = '';
    setAddedCount((n) => n + 1);
    setLastSavedTick((t) => t + 1);
  } finally {
    setBusy(false);
  }
}
```

Also: attach `ref={serialInputRef}` to the serial-number `<input>` inside Group 2. Reset the counter when the dialog closes by adding the following at the dialog root:

```jsx
useEffect(() => {
  if (!open) {
    setAddedCount(0);
    setLastSavedTick(0);
  }
}, [open]);
```

The `LicenseKeyField` component must accept a `resetTick` prop and clear its internal value when the prop changes. Pass `resetTick={lastSavedTick}` from the parent. (If `LicenseKeyField` does not yet accept this prop, the small extension is part of this step.)

- [ ] **Step 35.11: Add tests for sticky-defaults**

Append to `src/components/features/assets/AssetFormDialog.test.jsx`:

```jsx
describe('AssetFormDialog — sticky defaults / Save & add another', () => {
  it('shows the "Save & add another" button only in create mode', () => {
    const { rerender } = render(<AssetFormDialog {...baseProps} mode="create" initialAsset={{ categoryId: 'device' }} />);
    expect(screen.getByRole('button', { name: /добавить ещё|add another|ավելացնել ևս/i })).toBeInTheDocument();
    rerender(<AssetFormDialog {...baseProps} mode="edit" initialAsset={{ categoryId: 'device' }} />);
    expect(screen.queryByRole('button', { name: /добавить ещё|add another|ավելացնել ևս/i })).not.toBeInTheDocument();
  });

  it('preserves sticky fields and clears serialNumber/name after save & add another', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AssetFormDialog
        {...baseProps}
        onSubmit={onSubmit}
        initialAsset={{
          categoryId: 'device',
          subtypeId: 's1',
          brandId: 'b1',
          modelId: 'm1',
          serialNumber: 'SN-001',
          branchId: 'br1',
          statusId: 'in_use',
          condition: 'new',
        }}
      />,
    );
    const button = screen.getByRole('button', { name: /добавить ещё|add another|ավելացնել ևս/i });
    await userEvent.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // Sticky fields remain.
    expect(screen.getByDisplayValue('br1')).toBeInTheDocument(); // branch
    // Serial input is cleared.
    expect(screen.getByLabelText(/serial|серийный|սերիա/i)).toHaveValue('');
  });

  it('increments the added-count label after each successful save', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AssetFormDialog {...baseProps} onSubmit={onSubmit} initialAsset={{ categoryId: 'device' }} />);
    const button = screen.getByRole('button', { name: /добавить ещё|add another|ավելացնել ևս/i });
    await userEvent.click(button);
    expect(screen.getByRole('button', { name: /1 добавлено|1 added|1 ավելացված/i })).toBeInTheDocument();
    await userEvent.click(button);
    expect(screen.getByRole('button', { name: /2 добавлено|2 added|2 ավելացված/i })).toBeInTheDocument();
  });

  it('does NOT submit when validation fails (counter does not advance)', async () => {
    const onSubmit = vi.fn();
    render(<AssetFormDialog {...baseProps} onSubmit={onSubmit} initialAsset={{ /* missing categoryId on purpose */ }} />);
    const button = screen.queryByRole('button', { name: /добавить ещё|add another|ավելացնել ևս/i });
    if (button) {
      await userEvent.click(button);
      expect(onSubmit).not.toHaveBeenCalled();
    } else {
      // If the button is gated by category being chosen, that gate alone is sufficient.
      expect(button).toBeNull();
    }
  });
});
```

Add the import at the top of the test file if it isn't already there: `import userEvent from '@testing-library/user-event';`.

- [ ] **Step 35.12: Run the dialog tests**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/assets/AssetFormDialog.test.jsx`
Expected: PASS — all conditional disclosure assertions AND sticky-defaults assertions hold.

- [ ] **Step 35.13: Run the full test suite**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run`
Expected: PASS.

- [ ] **Step 35.14: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/components/features/assets/AssetFormDialog.jsx src/components/features/assets/AssetFormDialog.test.jsx`
Expected: 0 errors.

---

### Task 36: `CategoryFormDialog` — add `assignsInventoryCode` checkbox

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/components/features/categories/CategoryFormDialog.jsx`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/components/features/categories/CategoryFormDialog.test.jsx`

- [ ] **Step 36.1: Write the failing test**

Append the following describe-block to the existing test file:

```jsx
describe('CategoryFormDialog — assignsInventoryCode', () => {
  it('renders the checkbox checked by default for new categories', () => {
    render(<CategoryFormDialog open mode="create" onSubmit={vi.fn()} onOpenChange={vi.fn()} />);
    const checkbox = screen.getByLabelText(/inventory code|инвентарный код|գույքագրման համար/i);
    expect(checkbox).toBeChecked();
  });

  it('reflects the existing assignsInventoryCode flag in edit mode', () => {
    render(
      <CategoryFormDialog
        open
        mode="edit"
        initialCategory={{
          id: 'license',
          name: { ru: 'Лицензия', en: 'License', hy: 'Լիցենզիա' },
          requiresMultilang: false,
          assignsInventoryCode: false,
          attachableTo: ['employee', 'asset'],
        }}
        onSubmit={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );
    const checkbox = screen.getByLabelText(/inventory code|инвентарный код|գույքագրման համար/i);
    expect(checkbox).not.toBeChecked();
  });

  it('emits assignsInventoryCode in onSubmit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CategoryFormDialog open mode="create" onSubmit={onSubmit} onOpenChange={vi.fn()} />);
    const checkbox = screen.getByLabelText(/inventory code|инвентарный код|գույքագրման համար/i);
    fireEvent.click(checkbox); // toggle off
    fireEvent.click(screen.getByRole('button', { name: /save|сохранить|պահպանել/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ assignsInventoryCode: false });
  });
});
```

(`waitFor`, `fireEvent`, `screen` come from `@testing-library/react`; ensure imports.)

- [ ] **Step 36.2: Run the test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/categories/CategoryFormDialog.test.jsx`
Expected: FAIL — checkbox does not exist.

- [ ] **Step 36.3: Add the checkbox to `CategoryFormDialog.jsx`**

Insert near the existing `requiresMultilang` checkbox:

```jsx
<label className="flex items-start gap-2 text-sm">
  <input
    type="checkbox"
    checked={assignsInventoryCode}
    onChange={(e) => setAssignsInventoryCode(e.target.checked)}
    aria-label={tCategories('assignsInventoryCodeLabel')}
    disabled={isSeed}
    className="mt-0.5"
  />
  <span className="flex flex-col">
    <span>{tCategories('assignsInventoryCodeLabel')}</span>
    <span className="text-xs text-muted-foreground">
      {tCategories('assignsInventoryCodeHint')}
    </span>
  </span>
</label>
```

State setup at the top of the component:

```javascript
const [assignsInventoryCode, setAssignsInventoryCode] = useState(
  initialCategory?.assignsInventoryCode ?? true,
);
```

`onSubmit` payload now includes `assignsInventoryCode`.

- [ ] **Step 36.4: Run the test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/categories/CategoryFormDialog.test.jsx`
Expected: PASS.

- [ ] **Step 36.5: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/components/features/categories/CategoryFormDialog.jsx src/components/features/categories/CategoryFormDialog.test.jsx`
Expected: 0 errors.

---

### Task 37: Brands management page + route + nav entry

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/components/features/brands/BrandFormDialog.jsx`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/components/features/brands/BrandFormDialog.test.jsx`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/pages/BrandsManagementPage.jsx`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/pages/BrandsManagementPage.test.jsx`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/components/routing/AppRouter.jsx` (or `src/App.jsx` — wherever route table lives) — add `/settings/brands`, super-admin-gated.
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/components/layout/AppShell.jsx` — append nav entry under super-admin section.

- [ ] **Step 37.1: Write the failing form-dialog test**

```jsx
// src/components/features/brands/BrandFormDialog.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrandFormDialog } from './BrandFormDialog.jsx';

describe('BrandFormDialog', () => {
  it('renders empty for create', () => {
    render(<BrandFormDialog open mode="create" onSubmit={vi.fn()} onOpenChange={vi.fn()} />);
    expect(screen.getByLabelText(/name|название|անվանում/i)).toHaveValue('');
  });

  it('shows existing name in edit mode', () => {
    render(
      <BrandFormDialog
        open
        mode="edit"
        initialBrand={{ brandId: 'b1', name: 'HP', isActive: true }}
        onSubmit={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/name|название|անվանում/i)).toHaveValue('HP');
  });

  it('blocks submit when name is empty', async () => {
    const onSubmit = vi.fn();
    render(<BrandFormDialog open mode="create" onSubmit={onSubmit} onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /save|сохранить|պահպանել/i }));
    await waitFor(() => {
      expect(screen.getByText(/name is required|название обязательно|անվանումը պարտադիր/i)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('emits sanitized payload on submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<BrandFormDialog open mode="create" onSubmit={onSubmit} onOpenChange={vi.fn()} />);
    fireEvent.input(screen.getByLabelText(/name|название|անվանում/i), { target: { value: ' HP ' } });
    fireEvent.click(screen.getByRole('button', { name: /save|сохранить|պահպանել/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: 'HP', isActive: true });
  });
});
```

- [ ] **Step 37.2: Run the test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/brands/BrandFormDialog.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 37.3: Implement `BrandFormDialog.jsx`**

```jsx
// src/components/features/brands/BrandFormDialog.jsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { sanitizeBrandInput, validateBrandInput } from '@/domain/brands.js';

/**
 * @param {Object} props
 * @param {boolean} props.open
 * @param {'create'|'edit'} props.mode
 * @param {{ brandId: string, name: string, isActive: boolean }|null} [props.initialBrand]
 * @param {(payload: { name: string, isActive: boolean }) => Promise<void>} props.onSubmit
 * @param {(open: boolean) => void} props.onOpenChange
 */
export function BrandFormDialog({ open, mode, initialBrand = null, onSubmit, onOpenChange }) {
  const { t } = useTranslation('brands');
  const [name, setName] = useState(initialBrand?.name ?? '');
  const [isActive, setIsActive] = useState(initialBrand?.isActive ?? true);
  const [errors, setErrors] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    const sanitized = sanitizeBrandInput({ name, isActive });
    // validateBrandInput returns Record<string,string> (field → i18n code).
    // Empty record == valid. We render the i18n codes as a flat list below.
    const validationErrors = validateBrandInput(sanitized);
    const errorCodes = Object.values(validationErrors);
    if (errorCodes.length > 0) {
      setErrors(errorCodes);
      return;
    }
    setSubmitting(true);
    setErrors([]);
    try {
      await onSubmit(sanitized);
      onOpenChange(false);
    } catch (err) {
      setErrors([err?.code ?? 'errorRequired']);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? t('addBrand') : t('editBrand')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span>{t('fieldName')}</span>
            <input
              defaultValue={initialBrand?.name ?? ''}
              onBlur={(e) => setName(e.target.value)}
              placeholder={t('fieldNamePlaceholder')}
              aria-label={t('fieldName')}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span>{t('fieldIsActive')}</span>
          </label>
          {errors.map((code) => (
            <p key={code} className="text-sm text-destructive">{t(code)}</p>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 37.4: Run the dialog test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/brands/BrandFormDialog.test.jsx`
Expected: PASS.

- [ ] **Step 37.5: Write the failing page test**

```jsx
// src/pages/BrandsManagementPage.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useBrands.js', () => ({
  useBrands: () => ({
    data: [
      { brandId: 'b1', name: 'HP', isActive: true },
      { brandId: 'b2', name: 'Dell', isActive: false },
    ],
    loading: false,
    error: null,
  }),
}));
vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ role: 'super_admin' }),
}));

import BrandsManagementPage from './BrandsManagementPage.jsx';

describe('BrandsManagementPage', () => {
  it('lists all brands with their statuses', () => {
    render(<MemoryRouter><BrandsManagementPage /></MemoryRouter>);
    expect(screen.getByText('HP')).toBeInTheDocument();
    expect(screen.getByText('Dell')).toBeInTheDocument();
  });

  it('shows the Add Brand button', () => {
    render(<MemoryRouter><BrandsManagementPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /add brand|добавить бренд|ավելացնել բրենդ/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 37.6: Run page test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/pages/BrandsManagementPage.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 37.7: Implement `BrandsManagementPage.jsx`**

```jsx
// src/pages/BrandsManagementPage.jsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button.jsx';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useBrands } from '@/hooks/useBrands.js';
import { BrandFormDialog } from '@/components/features/brands/BrandFormDialog.jsx';
import {
  createBrand,
  updateBrand,
} from '@/infra/repositories/firestoreBrandRepository.js';

export default function BrandsManagementPage() {
  const { t } = useTranslation('brands');
  const { user, role } = useAuth();
  const { data, loading, error } = useBrands();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  async function handleSubmit(input) {
    const actor = { uid: user?.uid, role };
    if (editing) {
      await updateBrand(editing.brandId, input, actor);
    } else {
      await createBrand(input, actor);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          {t('addBrand')}
        </Button>
      </div>

      {loading ? <p>…</p> : null}
      {error ? <p className="text-destructive">{String(error.message ?? error)}</p> : null}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="px-3 py-2 text-left">{t('columnName')}</th>
            <th className="px-3 py-2 text-left">{t('columnStatus')}</th>
            <th className="px-3 py-2 text-right">{t('columnActions')}</th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">{t('emptyState')}</td></tr>
          ) : null}
          {data.map((brand) => (
            <tr key={brand.brandId} className="border-b">
              <td className="px-3 py-2">{brand.name}</td>
              <td className="px-3 py-2">{brand.isActive ? t('statusActive') : t('statusInactive')}</td>
              <td className="px-3 py-2 text-right">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(brand);
                    setOpen(true);
                  }}
                >
                  {t('editBrand')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <BrandFormDialog
        open={open}
        mode={editing ? 'edit' : 'create'}
        initialBrand={editing}
        onSubmit={handleSubmit}
        onOpenChange={setOpen}
      />
    </div>
  );
}
```

- [ ] **Step 37.8: Run the page test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/pages/BrandsManagementPage.test.jsx`
Expected: PASS.

- [ ] **Step 37.9: Wire the route**

Modify `src/components/routing/AppRouter.jsx` (or whichever file owns the route table — see existing `/settings/categories` registration as a model). Add inside the super-admin-gated subtree:

```jsx
<Route
  path="/settings/brands"
  element={
    <RoleGate roles={[ROLES.SUPER_ADMIN]}>
      <BrandsManagementPage />
    </RoleGate>
  }
/>
```

Add the corresponding `import BrandsManagementPage from '@/pages/BrandsManagementPage.jsx';` at the top of the router file.

- [ ] **Step 37.10: Add the nav entry**

In `src/components/layout/AppShell.jsx`, in the `ADMIN_NAV` array, append:

```javascript
{ to: '/settings/brands', icon: Tag, key: 'navBrands', roles: [ROLES.SUPER_ADMIN] },
```

(Tag is already imported from lucide-react; if not, add it.)

- [ ] **Step 37.11: Run the full test suite**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run`
Expected: PASS.

- [ ] **Step 37.12: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/components/features/brands/ src/pages/BrandsManagementPage.jsx src/pages/BrandsManagementPage.test.jsx`
Expected: 0 errors.

---

### Task 38: Models management page + route + nav entry

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/components/features/models/ModelFormDialog.jsx`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/components/features/models/ModelFormDialog.test.jsx`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/pages/ModelsManagementPage.jsx`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/pages/ModelsManagementPage.test.jsx`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/components/routing/AppRouter.jsx` — add `/settings/models`.
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/components/layout/AppShell.jsx` — append nav entry.

The dialog is structurally analogous to `BrandFormDialog` plus a brand picker.

- [ ] **Step 38.1: Write the failing form-dialog test**

```jsx
// src/components/features/models/ModelFormDialog.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/hooks/useBrands.js', () => ({
  useBrands: () => ({
    data: [
      { brandId: 'b1', name: 'HP', isActive: true },
      { brandId: 'b2', name: 'Dell', isActive: true },
    ],
    loading: false,
    error: null,
  }),
}));

import { ModelFormDialog } from './ModelFormDialog.jsx';

describe('ModelFormDialog', () => {
  it('blocks submit when brand is missing', async () => {
    const onSubmit = vi.fn();
    render(<ModelFormDialog open mode="create" onSubmit={onSubmit} onOpenChange={vi.fn()} />);
    fireEvent.input(screen.getByLabelText(/name|название|անվանում/i), {
      target: { value: 'Latitude 7430' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save|сохранить|պահպանել/i }));
    await waitFor(() => {
      expect(screen.getByText(/pick a brand|выберите бренд|ընտրեք բրենդը/i)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('emits payload with brandId and name', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ModelFormDialog open mode="create" onSubmit={onSubmit} onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/brand|бренд|բրենդ/i), { target: { value: 'b1' } });
    fireEvent.input(screen.getByLabelText(/^name|^название|^անվանում/i), {
      target: { value: 'EliteBook 840 G6' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save|сохранить|պահպանել/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      brandId: 'b1',
      name: 'EliteBook 840 G6',
      isActive: true,
    });
  });
});
```

- [ ] **Step 38.2: Run to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/models/ModelFormDialog.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 38.3: Implement `ModelFormDialog.jsx`**

```jsx
// src/components/features/models/ModelFormDialog.jsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { useBrands } from '@/hooks/useBrands.js';
import { sanitizeModelInput, validateModelInput } from '@/domain/models.js';

export function ModelFormDialog({ open, mode, initialModel = null, onSubmit, onOpenChange }) {
  const { t } = useTranslation('models');
  const { data: brands } = useBrands();
  const activeBrands = brands.filter((b) => b.isActive);
  const [brandId, setBrandId] = useState(initialModel?.brandId ?? '');
  const [name, setName] = useState(initialModel?.name ?? '');
  const [isActive, setIsActive] = useState(initialModel?.isActive ?? true);
  const [errors, setErrors] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    const sanitized = sanitizeModelInput({ brandId: brandId || null, name, isActive });
    // validateModelInput returns Record<string,string> (field → i18n code).
    const validationErrors = validateModelInput(sanitized);
    const errorCodes = Object.values(validationErrors);
    if (errorCodes.length > 0) {
      setErrors(errorCodes);
      return;
    }
    setSubmitting(true);
    setErrors([]);
    try {
      await onSubmit(sanitized);
      onOpenChange(false);
    } catch (err) {
      setErrors([err?.code ?? 'errorRequired']);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? t('addModel') : t('editModel')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span>{t('fieldBrand')}</span>
            <select
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              aria-label={t('fieldBrand')}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">{t('fieldBrandPlaceholder')}</option>
              {activeBrands.map((brand) => (
                <option key={brand.brandId} value={brand.brandId}>{brand.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t('fieldName')}</span>
            <input
              defaultValue={initialModel?.name ?? ''}
              onBlur={(e) => setName(e.target.value)}
              placeholder={t('fieldNamePlaceholder')}
              aria-label={t('fieldName')}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span>{t('fieldIsActive')}</span>
          </label>
          {errors.map((code) => (
            <p key={code} className="text-sm text-destructive">{t(code)}</p>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={submitting}>{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 38.4: Run the dialog test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/features/models/ModelFormDialog.test.jsx`
Expected: PASS.

- [ ] **Step 38.5: Write the failing page test**

```jsx
// src/pages/ModelsManagementPage.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useBrands.js', () => ({
  useBrands: () => ({
    data: [
      { brandId: 'b1', name: 'HP', isActive: true },
      { brandId: 'b2', name: 'Dell', isActive: true },
    ],
    loading: false,
    error: null,
  }),
}));
vi.mock('@/hooks/useModels.js', () => ({
  useModels: ({ brandId } = {}) => ({
    data: brandId
      ? [{ modelId: 'm1', brandId, name: 'X1', isActive: true }]
      : [
          { modelId: 'm1', brandId: 'b1', name: 'X1', isActive: true },
          { modelId: 'm2', brandId: 'b2', name: 'Y1', isActive: true },
        ],
    loading: false,
    error: null,
  }),
}));
vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ role: 'super_admin' }),
}));

import ModelsManagementPage from './ModelsManagementPage.jsx';

describe('ModelsManagementPage', () => {
  it('lists models and brand column', () => {
    render(<MemoryRouter><ModelsManagementPage /></MemoryRouter>);
    expect(screen.getByText('X1')).toBeInTheDocument();
    expect(screen.getByText('Y1')).toBeInTheDocument();
  });

  it('filters by brand when filter changes', () => {
    render(<MemoryRouter><ModelsManagementPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/filter by brand|бренд|բրենդ/i), { target: { value: 'b1' } });
    expect(screen.getByText('X1')).toBeInTheDocument();
    expect(screen.queryByText('Y1')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 38.6: Run the test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/pages/ModelsManagementPage.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 38.7: Implement `ModelsManagementPage.jsx`**

```jsx
// src/pages/ModelsManagementPage.jsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button.jsx';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useBrands } from '@/hooks/useBrands.js';
import { useModels } from '@/hooks/useModels.js';
import { ModelFormDialog } from '@/components/features/models/ModelFormDialog.jsx';
import {
  createModel,
  updateModel,
} from '@/infra/repositories/firestoreModelRepository.js';

export default function ModelsManagementPage() {
  const { t } = useTranslation('models');
  const { user, role } = useAuth();
  const { data: brands } = useBrands();
  const [filterBrand, setFilterBrand] = useState(null);
  const { data: models } = useModels({ brandId: filterBrand });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const brandsById = useMemo(() => {
    const acc = {};
    for (const b of brands) acc[b.brandId] = b;
    return acc;
  }, [brands]);

  async function handleSubmit(input) {
    const actor = { uid: user?.uid, role };
    if (editing) {
      await updateModel(editing.modelId, input, actor);
    } else {
      await createModel(input, actor);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          {t('addModel')}
        </Button>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <span>{t('filterByBrand')}</span>
        <select
          value={filterBrand ?? ''}
          onChange={(e) => setFilterBrand(e.target.value === '' ? null : e.target.value)}
          aria-label={t('filterByBrand')}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">{t('filterAllBrands')}</option>
          {brands.filter((b) => b.isActive).map((b) => (
            <option key={b.brandId} value={b.brandId}>{b.name}</option>
          ))}
        </select>
      </label>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="px-3 py-2 text-left">{t('brandColumn')}</th>
            <th className="px-3 py-2 text-left">{t('columnName')}</th>
            <th className="px-3 py-2 text-left">{t('columnStatus')}</th>
            <th className="px-3 py-2 text-right">{t('columnActions')}</th>
          </tr>
        </thead>
        <tbody>
          {models.length === 0 ? (
            <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">{t('emptyState')}</td></tr>
          ) : null}
          {models.map((model) => (
            <tr key={model.modelId} className="border-b">
              <td className="px-3 py-2">{brandsById[model.brandId]?.name ?? '—'}</td>
              <td className="px-3 py-2">{model.name}</td>
              <td className="px-3 py-2">{model.isActive ? t('statusActive') : t('statusInactive')}</td>
              <td className="px-3 py-2 text-right">
                <Button size="sm" variant="outline" onClick={() => { setEditing(model); setOpen(true); }}>
                  {t('editModel')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ModelFormDialog
        open={open}
        mode={editing ? 'edit' : 'create'}
        initialModel={editing}
        onSubmit={handleSubmit}
        onOpenChange={setOpen}
      />
    </div>
  );
}
```

- [ ] **Step 38.8: Run the page test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/pages/ModelsManagementPage.test.jsx`
Expected: PASS.

- [ ] **Step 38.9: Wire the route**

In the router file, append (super-admin-gated):

```jsx
<Route
  path="/settings/models"
  element={
    <RoleGate roles={[ROLES.SUPER_ADMIN]}>
      <ModelsManagementPage />
    </RoleGate>
  }
/>
```

Add the import at top of file.

- [ ] **Step 38.10: Add the nav entry**

In `AppShell.jsx`, append to `ADMIN_NAV` after the Brands entry:

```javascript
{ to: '/settings/models', icon: Layers, key: 'navModels', roles: [ROLES.SUPER_ADMIN] },
```

(`Layers` from lucide-react; add the import if not present.)

- [ ] **Step 38.11: Run the full test suite**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run`
Expected: PASS.

- [ ] **Step 38.12: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/components/features/models/ src/pages/ModelsManagementPage.jsx src/pages/ModelsManagementPage.test.jsx`
Expected: 0 errors.

---

### Task 39: NotificationSettings management page + route + nav entry

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/pages/NotificationSettingsPage.jsx`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/pages/NotificationSettingsPage.test.jsx`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/components/routing/AppRouter.jsx` — add `/settings/notifications`.
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/components/layout/AppShell.jsx` — append nav entry.

- [ ] **Step 39.1: Write the failing test**

```jsx
// src/pages/NotificationSettingsPage.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const setNotificationSettingsMock = vi.fn();
const useNotificationSettingsMock = vi.fn();
vi.mock('@/hooks/useNotificationSettings.js', () => ({
  useNotificationSettings: () => useNotificationSettingsMock(),
}));
vi.mock('@/infra/repositories/firestoreNotificationSettingsRepository.js', () => ({
  setNotificationSettings: (...args) => setNotificationSettingsMock(...args),
}));
vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ role: 'super_admin' }),
}));

import NotificationSettingsPage from './NotificationSettingsPage.jsx';

describe('NotificationSettingsPage', () => {
  beforeEach(() => {
    setNotificationSettingsMock.mockReset();
    useNotificationSettingsMock.mockReset();
  });

  it('renders the current value', () => {
    useNotificationSettingsMock.mockReturnValue({
      data: { licenseExpiryWarningDays: 14 },
      loading: false,
      error: null,
    });
    render(<MemoryRouter><NotificationSettingsPage /></MemoryRouter>);
    expect(screen.getByDisplayValue('14')).toBeInTheDocument();
  });

  it('rejects out-of-range values', async () => {
    useNotificationSettingsMock.mockReturnValue({
      data: { licenseExpiryWarningDays: 30 },
      loading: false,
      error: null,
    });
    render(<MemoryRouter><NotificationSettingsPage /></MemoryRouter>);
    const input = screen.getByLabelText(/days|дн|օր/i);
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /save|сохранить|պահպանել/i }));
    await waitFor(() => {
      expect(screen.getByText(/integer between 1 and 365|целым числом|ամբողջ թիվ/i)).toBeInTheDocument();
    });
    expect(setNotificationSettingsMock).not.toHaveBeenCalled();
  });

  it('persists in-range values', async () => {
    useNotificationSettingsMock.mockReturnValue({
      data: { licenseExpiryWarningDays: 30 },
      loading: false,
      error: null,
    });
    setNotificationSettingsMock.mockResolvedValue(undefined);
    render(<MemoryRouter><NotificationSettingsPage /></MemoryRouter>);
    const input = screen.getByLabelText(/days|дн|օր/i);
    fireEvent.change(input, { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: /save|сохранить|պահպանել/i }));
    await waitFor(() => expect(setNotificationSettingsMock).toHaveBeenCalled());
    expect(setNotificationSettingsMock.mock.calls[0][0]).toMatchObject({
      licenseExpiryWarningDays: 14,
    });
  });
});
```

- [ ] **Step 39.2: Run the test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/pages/NotificationSettingsPage.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 39.3: Implement `NotificationSettingsPage.jsx`**

```jsx
// src/pages/NotificationSettingsPage.jsx
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button.jsx';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useNotificationSettings } from '@/hooks/useNotificationSettings.js';
import { setNotificationSettings } from '@/infra/repositories/firestoreNotificationSettingsRepository.js';
import {
  sanitizeNotificationSettingsInput,
  validateNotificationSettingsInput,
} from '@/domain/notificationSettings.js';

export default function NotificationSettingsPage() {
  const { t } = useTranslation('settings');
  const { user, role } = useAuth();
  const { data, loading } = useNotificationSettings();
  const [days, setDays] = useState(data.licenseExpiryWarningDays);
  const [errors, setErrors] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setDays(data.licenseExpiryWarningDays);
  }, [data.licenseExpiryWarningDays]);

  async function handleSave() {
    const sanitized = sanitizeNotificationSettingsInput({ licenseExpiryWarningDays: days });
    // validateNotificationSettingsInput returns Record<string,string> (field → i18n code).
    const validationErrors = validateNotificationSettingsInput(sanitized);
    const errorCodes = Object.values(validationErrors);
    if (errorCodes.length > 0) {
      setErrors(errorCodes);
      return;
    }
    setErrors([]);
    setSubmitting(true);
    try {
      await setNotificationSettings(sanitized, { uid: user?.uid, role });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('notificationSettingsTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('notificationSettingsSubtitle')}</p>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span>{t('licenseExpiryWarningDaysLabel')}</span>
        <input
          type="number"
          min={1}
          max={365}
          step={1}
          value={Number.isFinite(days) ? days : ''}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label={t('licenseExpiryWarningDaysLabel')}
          className="w-32 rounded-md border bg-background px-3 py-2 text-sm"
          disabled={loading}
        />
        <span className="text-xs text-muted-foreground">{t('licenseExpiryWarningDaysHint')}</span>
      </label>

      {errors.map((code) => (
        <p key={code} className="text-sm text-destructive">{t(code)}</p>
      ))}

      <div>
        <Button onClick={handleSave} disabled={submitting}>{t('saveButton')}</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 39.4: Run the test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/pages/NotificationSettingsPage.test.jsx`
Expected: PASS.

- [ ] **Step 39.5: Wire the route**

```jsx
<Route
  path="/settings/notifications"
  element={
    <RoleGate roles={[ROLES.SUPER_ADMIN]}>
      <NotificationSettingsPage />
    </RoleGate>
  }
/>
```

- [ ] **Step 39.6: Add the nav entry**

In `AppShell.jsx`, append to `ADMIN_NAV`:

```javascript
{ to: '/settings/notifications', icon: Bell, key: 'navNotificationSettings', roles: [ROLES.SUPER_ADMIN] },
```

(`Bell` imported from lucide-react.)

- [ ] **Step 39.7: Run the full test suite**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run`
Expected: PASS.

- [ ] **Step 39.8: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/pages/NotificationSettingsPage.jsx src/pages/NotificationSettingsPage.test.jsx src/components/layout/AppShell.jsx`
Expected: 0 errors.

---

### Task 40: AssetListPage / AssetDetailPage — composed title, expiry badge, "Управлять ключом"

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/pages/AssetListPage.jsx`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/pages/AssetDetailPage.jsx`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/pages/AssetListPage.test.jsx`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/pages/AssetDetailPage.test.jsx`

#### 40.1 — Asset list

- [ ] **Step 40.1.1: Write a failing list test**

Append to `AssetListPage.test.jsx`:

```jsx
describe('AssetListPage — composed title', () => {
  it('renders Subtype · Brand · Model for a Device asset', () => {
    // setup: mock useAssets, useBrands, useModels, useSubtypes to provide
    // an asset with brandId='b1', modelId='m1', subtypeId='s1', categoryId='device'
    // and lookups for HP, EliteBook, Laptop. Render the page and assert
    // the row contains 'Laptop · HP · EliteBook 840 G6'.
    // Use the same mocking pattern as the existing tests in this file.
    // (This test is intentionally a smoke test — full setup follows the
    // pattern already used; see the existing 'renders empty state' test.)
  });
});
```

Replace the placeholder body with a concrete render that mocks `useAssets`, `useBrands`, `useModels`, `useSubtypes`, `useCategories`, asserting the composed title text appears. Pattern: see the existing `AssetListPage` test setup (re-use its `renderListPage()` helper).

- [ ] **Step 40.1.2: Run to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/pages/AssetListPage.test.jsx`
Expected: FAIL.

- [ ] **Step 40.1.3: Update `AssetListPage.jsx` to use `formatAssetTitle`**

Replace the inline title rendering (whatever currently uses `asset.name` or `asset.brand`/`asset.model`) with:

```jsx
import { formatAssetTitle } from '@/lib/asset/formatAssetTitle.js';
import { useBrands } from '@/hooks/useBrands.js';
import { useModels } from '@/hooks/useModels.js';
// ...
const { data: brands } = useBrands();
const { data: models } = useModels();
const { data: subtypes } = useSubtypes(); // existing hook
const brandsById = useMemo(() => Object.fromEntries(brands.map((b) => [b.brandId, b])), [brands]);
const modelsById = useMemo(() => Object.fromEntries(models.map((m) => [m.modelId, m])), [models]);
const subtypesById = useMemo(() => Object.fromEntries(subtypes.map((s) => [s.id, s])), [subtypes]);

function renderTitle(asset) {
  return formatAssetTitle(
    asset,
    {
      brand: brandsById[asset.brandId] ?? null,
      model: modelsById[asset.modelId] ?? null,
      subtype: subtypesById[asset.subtypeId] ?? null,
    },
    i18n.resolvedLanguage,
  );
}
```

Use `renderTitle(asset)` wherever the row title was previously read.

- [ ] **Step 40.1.4: Run the list test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/pages/AssetListPage.test.jsx`
Expected: PASS.

#### 40.2 — Asset detail

- [ ] **Step 40.2.1: Write failing detail tests for the badge and the manage-key button**

Append to `AssetDetailPage.test.jsx`:

```jsx
describe('AssetDetailPage — license-only UI', () => {
  it('renders LicenseExpiryBadge when categoryId is license and expiresAt is set', () => {
    // mock useAsset to return a license asset with expiresAt 10 days in the future
    // and useNotificationSettings to return licenseExpiryWarningDays: 30.
    // Assert that an element with the soon-badge text is in the document.
  });

  it('shows "Управлять ключом" for super_admin', () => {
    // mock useAuth role: 'super_admin', useAsset license asset.
    // assert button with /manage key|управлять ключом|կառավարել/i is rendered.
  });

  it('does NOT show "Управлять ключом" for asset_admin', () => {
    // mock useAuth role: 'asset_admin'. assert button is absent.
  });
});
```

Replace each placeholder with the concrete render setup. Use the same hook-mock pattern already established at the top of the file.

- [ ] **Step 40.2.2: Run to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/pages/AssetDetailPage.test.jsx`
Expected: FAIL.

- [ ] **Step 40.2.3: Update `AssetDetailPage.jsx`**

Add at top of the page component (after existing imports):

```jsx
import { LicenseExpiryBadge } from '@/components/features/assets/LicenseExpiryBadge.jsx';
import { LicenseKeyDialog } from '@/components/features/assets/LicenseKeyDialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { ROLES } from '@/domain/roles.js';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { formatAssetTitle } from '@/lib/asset/formatAssetTitle.js';
```

In the render body, replace the title heading with:

```jsx
<h1 className="text-2xl font-semibold">{formatAssetTitle(asset, lookups, i18n.resolvedLanguage)}</h1>
```

Where `lookups` is the same `{ brand, model, subtype }` shape derived as in the list page.

For the license block:

```jsx
{asset.categoryId === 'license' ? (
  <div className="flex items-center gap-3">
    <LicenseExpiryBadge expiresAt={asset.expiresAt} />
    {[ROLES.SUPER_ADMIN, ROLES.TECH_ADMIN].includes(role) ? (
      <Button variant="outline" onClick={() => setKeyDialogOpen(true)}>
        {tLicenses('manageKey')}
      </Button>
    ) : null}
  </div>
) : null}

{asset.categoryId === 'license' && [ROLES.SUPER_ADMIN, ROLES.TECH_ADMIN].includes(role) ? (
  <LicenseKeyDialog
    assetId={asset.assetId}
    open={keyDialogOpen}
    onOpenChange={setKeyDialogOpen}
  />
) : null}
```

Add `const [keyDialogOpen, setKeyDialogOpen] = useState(false);` and `const { role } = useAuth();` and `const { t: tLicenses } = useTranslation('licenses');` at the top of the function body.

- [ ] **Step 40.2.4: Run the detail test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/pages/AssetDetailPage.test.jsx`
Expected: PASS.

- [ ] **Step 40.2.5: Run the full suite**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run`
Expected: PASS.

- [ ] **Step 40.2.6: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/pages/AssetListPage.jsx src/pages/AssetListPage.test.jsx src/pages/AssetDetailPage.jsx src/pages/AssetDetailPage.test.jsx`
Expected: 0 errors.

---

## Cross-cutting (Tasks 41–43)

### Task 41: Cross-cutting test — no audit log ever contains a license-key value

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/licenseKey.auditInvariant.test.js`

This test enforces the project-wide invariant: under no code path may an audit-log row include the literal license-key string. It works by mounting an in-memory `auditWriter` spy, exercising the relevant repository entry points with sentinel keys, and asserting no recorded audit row contains the sentinel.

- [ ] **Step 41.1: Write the failing test**

```javascript
// src/test/licenseKey.auditInvariant.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const SENTINEL_KEY = 'SENTINEL-LICENSE-KEY-DO-NOT-LEAK-7f3a91';

const recordedAuditRows = [];
const txMock = {
  get: vi.fn(),
  set: vi.fn((ref, data) => {
    if (ref?.path?.includes('audit_logs')) {
      recordedAuditRows.push(data);
    }
    return undefined;
  }),
  update: vi.fn(),
};

vi.mock('firebase/firestore', () => ({
  doc: (..._args) => ({ path: _args.join('/') }),
  collection: (..._args) => ({ path: _args.join('/') }),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  runTransaction: async (_db, callback) => callback(txMock),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
}));

vi.mock('@/lib/firebase/index.js', () => ({
  db: { __mock: true },
  auth: { currentUser: { uid: 'admin-uid' } },
}));

import { setLicenseKey } from '@/infra/repositories/firestoreLicenseSecretRepository.js';

describe('license-key audit invariant', () => {
  beforeEach(() => {
    recordedAuditRows.length = 0;
    txMock.get.mockReset();
    txMock.set.mockClear();
    txMock.update.mockClear();
    txMock.get.mockResolvedValue({
      exists: () => true,
      data: () => ({ assetId: 'a1', categoryId: 'license' }),
    });
  });

  it('setLicenseKey writes an audit row that does NOT contain the key value', async () => {
    await setLicenseKey('a1', SENTINEL_KEY, { uid: 'admin-uid', role: 'tech_admin' });
    expect(recordedAuditRows.length).toBeGreaterThan(0);
    for (const row of recordedAuditRows) {
      const serialized = JSON.stringify(row);
      expect(serialized, `audit row must not contain the key sentinel: ${serialized}`).not.toContain(SENTINEL_KEY);
    }
  });

  it('every recorded audit row carries action = "license_key_changed" and a sanitized diff', async () => {
    await setLicenseKey('a1', SENTINEL_KEY, { uid: 'admin-uid', role: 'tech_admin' });
    const licenseAuditRows = recordedAuditRows.filter(
      (row) => row.action === 'license_key_changed',
    );
    expect(licenseAuditRows.length).toBe(1);
    const row = licenseAuditRows[0];
    expect(row.before ?? {}).not.toMatchObject({ value: expect.any(String) });
    expect(row.after ?? {}).not.toMatchObject({ value: expect.any(String) });
    expect(JSON.stringify(row)).not.toContain(SENTINEL_KEY);
  });
});
```

- [ ] **Step 41.2: Run the test to verify it passes (or fails meaningfully)**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/test/licenseKey.auditInvariant.test.js`
Expected: PASS — assuming Tasks 8 (`sanitizeLicenseKeyDiff` + ALLOWED_ENTITIES) and 11 (`firestoreLicenseSecretRepository` write path) were implemented correctly. If the test FAILs, the failing audit row is the smoking gun and the matching repository / audit-helper must be re-dispatched.

- [ ] **Step 41.3: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/test/licenseKey.auditInvariant.test.js`
Expected: 0 errors.

---

### Task 42: Bootstrap update — seed `/settings/notifications` and patch `license` category

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/components/system/StatusesAndCategoriesBootstrap.jsx`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/components/system/StatusesAndCategoriesBootstrap.test.jsx`

Bootstrap responsibilities to add:

1. If `/settings/notifications` does not exist, create it with `{ licenseExpiryWarningDays: 30, updatedAt: serverTimestamp(), updatedBy: <super-admin uid> }`. Idempotent: skip if already exists.
2. If the `license` category doc exists but lacks `assignsInventoryCode`, patch it to `{ assignsInventoryCode: false }`. Same for any other seed categories that should be `true`: ensure they have the field (default `true`).

The bootstrap component already runs once per super-admin sign-in; we are extending it.

- [ ] **Step 42.1: Write the failing test**

Append to `src/components/system/StatusesAndCategoriesBootstrap.test.jsx`:

```jsx
describe('StatusesAndCategoriesBootstrap — Phase 1.5 extensions', () => {
  it('creates /settings/notifications with default warning days when missing', async () => {
    // mock getDoc('/settings/notifications') -> { exists: () => false }
    // mount the component, await its effect
    // assert setDoc was called with path '/settings/notifications' and data including licenseExpiryWarningDays: 30
  });

  it('does not overwrite /settings/notifications when it already exists', async () => {
    // mock getDoc -> { exists: () => true, data: () => ({ licenseExpiryWarningDays: 14 }) }
    // mount; assert setDoc with that path was NOT called.
  });

  it('patches license category with assignsInventoryCode: false when missing', async () => {
    // mock getDoc('/categories/license') -> { exists: () => true, data: () => ({ id: 'license', requiresMultilang: false }) }
    // mount; assert updateDoc was called with the path '/categories/license' and { assignsInventoryCode: false }.
  });

  it('does not re-patch license category when assignsInventoryCode is already false', async () => {
    // mock getDoc('/categories/license') -> { exists: () => true, data: () => ({ id: 'license', requiresMultilang: false, assignsInventoryCode: false }) }
    // mount; assert updateDoc was NOT called for that path.
  });
});
```

Replace each comment placeholder with concrete `vi.mock`+assertion code following the file's existing pattern.

- [ ] **Step 42.2: Run to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/system/StatusesAndCategoriesBootstrap.test.jsx`
Expected: FAIL.

- [ ] **Step 42.3: Implement the extensions in `StatusesAndCategoriesBootstrap.jsx`**

Add inside the existing one-shot `useEffect` (after the existing seed work):

```jsx
async function ensureNotificationSettings() {
  const ref = doc(db, 'settings', 'notifications');
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, {
    licenseExpiryWarningDays: 30,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.uid ?? 'system',
  });
}

async function ensureLicenseCategoryFlag() {
  const ref = doc(db, 'categories', 'license');
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data() ?? {};
  if (data.assignsInventoryCode === false) return;
  await updateDoc(ref, { assignsInventoryCode: false });
}
```

Call both inside the main bootstrap routine (sequential — `await ensureNotificationSettings(); await ensureLicenseCategoryFlag();`). Wrap each in a try/catch that logs to console without leaking values; the bootstrap is best-effort and must not block UI.

- [ ] **Step 42.4: Run the test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run src/components/system/StatusesAndCategoriesBootstrap.test.jsx`
Expected: PASS.

- [ ] **Step 42.5: Lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint -- src/components/system/StatusesAndCategoriesBootstrap.jsx src/components/system/StatusesAndCategoriesBootstrap.test.jsx`
Expected: 0 errors.

---

### Task 43: Final verification

**Files:**
- None (verification only).

This is the gating task. All three commands must succeed, in this order, with no new warnings.

- [ ] **Step 43.1: Lint sweep**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint`
Expected: 0 errors. If existing pre-baseline warnings are present, count must not have increased.

- [ ] **Step 43.2: Full test run**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx vitest run`
Expected: PASS — every spec across `src/**/*.test.{js,jsx}` and `src/test/*.test.js` passes. No skipped specs other than the pre-existing `firestore-tests/` describe.skip blocks (these require a JRE and are out of scope for this plan).

- [ ] **Step 43.3: Production build**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run build`
Expected: PASS. No new warnings beyond what the baseline build produces.

- [ ] **Step 43.4: Manual smoke checklist (operator-facing, no code change)**

The implementer reports whether the following manual flows succeeded against the dev server (`npm run dev`):

1. Super Admin signs in → navigates to `/settings/brands` → creates a brand "HP" → it appears in the list with status Active.
2. Super Admin navigates to `/settings/models` → filters by HP → creates a model "EliteBook 840 G6" → it appears in the list.
3. Asset Admin signs in → opens the Add Asset dialog → picks Category Device → Subtype Laptop → Brand HP → Model EliteBook 840 G6. No "Name" field is shown. Inventory-code preview shows the next code from `category_counters/device`.
4. Asset Admin clicks Далее → preview dialog shows the composed title `Laptop · HP · EliteBook 840 G6`. Clicks Создать → asset is committed.
5. Asset Admin opens the new asset's detail page → the heading reads `Laptop · HP · EliteBook 840 G6`. There is no "Управлять ключом" button.
6. Asset Admin opens the Add Asset dialog → picks Category License → no inventory-code preview is shown. Group 6 (License) appears with type radio + two date fields. The license-key field is **not** rendered.
7. Tech Admin signs in → opens an existing license asset → sees "Управлять ключом" → enters a key → saves. Re-opens the dialog → the key is loaded and visible after Show.
8. Super Admin navigates to `/settings/notifications` → changes warning days from 30 to 14 → saves → reloads the asset list page → license-expiry badge respects the new threshold.
9. Direct probe: an Asset Admin's session attempting `getDoc('/assets/<id>/secrets/key')` returns `permission-denied` (verify in DevTools Console).

If any flow above fails, the corresponding implementer must be re-dispatched.

---

## Acceptance-criteria coverage map

The 14 criteria from §8 of `docs/superpowers/specs/2026-05-08-asset-form-redesign-design.md` map to plan tasks as follows. A criterion is satisfied iff every task in its row passes its verification step.

| # | Acceptance criterion | Tasks that implement / prove it |
|---|---|---|
| 1 | Brands and Models exist as catalog collections; Super Admin CRUD; dropdowns read from these collections. | Task 1 (Brand domain), Task 2 (Model domain), Task 9 (firestoreBrandRepository), Task 10 (firestoreModelRepository), Task 15 (rules /brands), Task 16 (rules /models), Task 21 (useBrands), Task 22 (useModels), Task 27 (BrandSelect), Task 28 (ModelSelect), Task 37 (BrandsManagementPage), Task 38 (ModelsManagementPage). |
| 2 | `assets.brand`/`assets.model` removed; new `assets.brandId`/`assets.modelId` populated. | Task 4 (Asset schema delta), Task 14 (firestoreAssetRepository update — new fields), Task 19 (rules /assets shape update). |
| 3 | Category gains `assignsInventoryCode`; license seeded false; checkbox in form. | Task 3 (Category domain extension), Task 13 (firestoreCategoryRepository update), Task 20 (rules /categories), Task 36 (CategoryFormDialog checkbox), Task 42 (bootstrap patches license category). |
| 4 | No "Name" for Device/License; `formatAssetTitle` produces `Subtype · Brand · Model`; multi-lang Name kept for Furniture. | Task 4 (Asset schema reshape — name nullable), Task 5 (formatAssetTitle helper), Task 35 (AssetFormDialog conditional Name field), Task 40 (list & detail use formatAssetTitle). |
| 5 | Progressive disclosure 1 → 2 → 6 (license) → 3 → 4 → 5; Brand hidden for multi-lang categories; Model disabled until Brand. | Task 35 (AssetFormDialog refactor — covers all five disclosure rules + Group 6 placement). |
| 6 | Preview-modal step on create only; edit submits directly. | Task 33 (AssetCreatePreviewDialog), Task 35 (Step 35.9 — wires preview only for `mode === 'create'`). |
| 7 | License block functional: type radio, two dates with `expiresAt > subscribedAt`, key field for super_admin/tech_admin only. | Task 4 (Asset license fields), Task 29 (LicenseTypeRadio), Task 30 (LicenseKeyField), Task 32 (LicenseFieldsBlock). |
| 8 | License key hardened: rules deny read for asset_admin/employee; allow super_admin/tech_admin; audit_logs never contain the value. | Task 6 (LicenseSecret domain), Task 8 (auditHelper sanitizeLicenseKeyDiff), Task 11 (firestoreLicenseSecretRepository), Task 17 (rules /assets/{aid}/secrets/{any}), Task 41 (cross-cutting audit-invariant test). |
| 9 | `/settings/notifications` exists with `licenseExpiryWarningDays`; super-admin form; range 1..365; `LicenseExpiryBadge` reflects current setting. | Task 7 (NotificationSettings domain), Task 12 (firestoreNotificationSettingsRepository), Task 18 (rules /settings/notifications), Task 24 (useNotificationSettings), Task 34 (LicenseExpiryBadge), Task 39 (NotificationSettingsPage), Task 42 (seed default). |
| 10 | i18n complete: every new UI string in ru/en/hy; no hardcoded Russian. | Task 25 (namespace registration), Task 26 (locale parity test + ru/en/hy resource files for all touched namespaces). |
| 11 | Firestore rules pass (rules-mirror tests in pure JS, since project has no JRE for emulator). | Task 15 (brand rules + mirror), Task 16 (model rules + mirror), Task 17 (license-secret rules + mirror), Task 18 (notification-settings rules + mirror), Task 19 (asset rules update + mirror), Task 20 (category rules update + mirror). |
| 12 | `npm run build` and `npm test -- --run` pass cleanly with no new warnings. | Task 43 (final verification gate). |
| 13 | Audit-log integrity: every state-changing write goes through withAudit, but license-key value never appears in any audit row. | Task 8 (audit helper sanitizer + ALLOWED_ENTITIES), Task 11 (LicenseSecret repo invariant — never logs the value), Task 14 (asset repo drops brand/model raw strings from audit snapshot, license-secret coordination), Task 41 (cross-cutting invariant test). |
| 14 | No regression in out-of-scope flows (assignment events, employee CRUD, /me, Storage, asset import/export). | Task 43 (full test run + manual smoke). The plan deliberately does not modify any code outside the file list in §6 of the spec; the regression check is the unchanged passing of pre-existing test files in those areas. |

---

## Plan summary

- **Total tasks:** 43.
- **Total checkbox steps:** ~280 across 9 task groups.
- **Files created:** 30 (10 domain / repository, 10 hooks + UI primitives, 4 pages, 6 locale files, plus parity + cross-cutting tests).
- **Files modified:** 14 (existing repositories, asset/category domain, locales, AppShell, AppRouter, AssetFormDialog, AssetListPage, AssetDetailPage, CategoryFormDialog, bootstrap component, withAudit helper).
- **Out of scope (per spec §9):** Phase-2 email notifications, scheduled Cloud Function, separate /licenses collection, Brand/Model import/export, license-key rotation history, assignment-flow changes, dashboard changes, Storage, Phase-2 dynamic per-category attributes. NONE of these appear as tasks.
- **No git operations.** No `git add`, `git commit`, `git push`, or `firebase deploy` is invoked anywhere in this plan.
- **Rules verification path:** pure-JS rules-mirror tests at `src/test/*.rulesMirror.test.js`. The project has no JRE; the emulator-based tests in `firestore-tests/` remain `describe.skip`.
