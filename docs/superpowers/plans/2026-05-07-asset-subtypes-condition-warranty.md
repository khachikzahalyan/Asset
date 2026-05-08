# Asset Sub-types, Condition, and Warranty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Add Asset modal so that picking a Category drives a Sub-type select (pre-seeded per category), require Condition (new/used) with optional warranty period when new, allow assigning licenses to devices via a fifth `asset` assignment kind, and propagate the new fields through Excel I/O, the asset detail page, and the audit trail.

**Architecture:** Sub-types live in a new `/asset_subtypes/{id}` Firestore collection (mirroring `/categories/`), seeded by an extension to `StatusesAndCategoriesBootstrap` with stable doc ids and per-category default catalogs. The discriminated `AssignedTo` union gains `{ kind: 'asset', id: string }` for license-to-device attachment. License sub-types carry an `attachableTo` enum (`'device-only' | 'device-or-employee'`) that drives both UI gating and a domain-level invariant. Warranty is two optional `Date|null` fields stored as Firestore Timestamps, present only when `condition === 'new'`. All mutations go through the existing audit-helper transaction pattern.

**Tech Stack:** React + Vite, Firebase v9+ modular SDK (Firestore, Auth), JSDoc-typed JS, Tailwind + shadcn/ui, i18next (ru/en/hy), Vitest, ESLint.

---

## Hard Operational Rules (apply to every task)

- **No git commands at all.** Do not `git add`, `git commit`, `git push`, `git status`, `git diff`. Leave changes in the working tree. Override the checklist's "Commit" steps — they do not apply here.
- **No `firebase deploy` of any kind.** Rules changes stay in `firestore.rules` and `storage.rules` only. Do not invoke `npx firebase deploy --only firestore:rules` (or any other deploy target). Mention the single deploy command in the final report.
- **CWD always absolute:** every file path in this plan is `C:/Users/DELL/Desktop/assets-crm/...` with forward slashes.
- **Verification commands** (run from `C:/Users/DELL/Desktop/assets-crm/`):
  - `npm run lint`
  - `npx vitest run`
  - `npm run build`
- All three must come back green at the end. Lint warnings count as failure.
- **Audit invariant** (mandatory for every Firestore mutation): the data write and the corresponding `audit_logs/{id}` write must happen inside the same `runTransaction()` call. The repository pattern in `firestoreCategoryRepository.js` is the reference implementation.

---

## File Structure

### New files to create

| Path | Responsibility |
|---|---|
| `src/domain/assetSubtypes.js` | Typedef, sanitize, validate, custom errors, enum constants for `attachableTo`. Pure JS. |
| `src/domain/repositories/AssetSubtypeRepository.js` | Port (interface) for the subtype repository — JSDoc only. |
| `src/infra/repositories/firestoreAssetSubtypeRepository.js` | Firestore adapter — subscribe / get / create / update / setActive. Audit-helper transactions. Mirror `firestoreCategoryRepository.js`. |
| `src/hooks/useAssetSubtypes.js` | `useAssetSubtypes({ categoryId })` hook returning `{ data, loading, error }`. Filters by category id. |
| `src/components/features/assets/AssetSelect.jsx` | Single-asset picker for license→asset assignment. Lists active devices (category=device + isActive). |
| `src/test/assetSubtypes.test.js` | Unit tests for sanitize/validate. |
| `src/test/firestoreAssetSubtypeRepository.test.js` | Repository tests with the existing Firestore mocks. |
| `src/test/assetSubtypes.rulesMirror.test.js` | JS-mirror tests for the `/asset_subtypes/{id}` rules block. |

### Existing files to modify

| Path | Why |
|---|---|
| `src/domain/assets.js` | Add `ASSIGNMENT_KINDS.ASSET`, extend `AssignedTo` union, add `subtypeId`, `condition`, `warrantyStart`, `warrantyEnd` to typedef + `emptyAssetInput()` + `sanitizeAssetInput()` + `validateAssetInput()`. New error keys. |
| `src/lib/audit/auditHelper.js` | Add `'asset_subtype'` to `ALLOWED_ENTITIES`. |
| `firestore.rules` | New `/asset_subtypes/{id}` block; extend `isValidAssignedTo` with `asset` kind; extend `/assets/{id}` create/update predicates with new fields. |
| `src/infra/repositories/firestoreAssetRepository.js` | Persist new fields on create/update; include them in `auditSnapshot()`. Validate `attachableTo` invariant inside the transaction. |
| `src/components/system/StatusesAndCategoriesBootstrap.jsx` | Seed `/asset_subtypes/*` with stable ids when collection is empty. Idempotent. |
| `src/components/features/assets/AssetFormDialog.jsx` | Full redesign: subtype select after category, per-category Куда options, Condition radio, conditional warranty inputs. |
| `src/components/features/assignments/AssignDialog.jsx` | Accept `asset` target kind for license assets, render `<AssetSelect>` when chosen. Filter target kinds by source asset's category (license → warehouse/employee/asset). |
| `src/pages/AssetDetailPage.jsx` | Show subtype label, condition badge, warranty banner with remaining-days. Render `kind === 'asset'` holder row with link to the parent device. |
| `src/lib/excel/columns.js` | Append `subtypeId`, `condition`, `warrantyStart`, `warrantyEnd` to `COLUMN_KEYS` and `COLUMN_LABEL_KEYS`. |
| `src/lib/excel/assetImportService.js` | Parse, validate, normalize new columns. |
| `src/lib/excel/assetExportService.js` | Emit new columns in `rowsToWorkbook`. |
| `src/locales/ru/assets.json` | New keys (subtype labels, condition, warranty, asset assignment kind, errors). |
| `src/locales/en/assets.json` | Same set, English. |
| `src/locales/hy/assets.json` | Same set, Armenian. |
| `src/test/assets.test.js` | New cases for subtype/condition/warranty/asset-kind validation. |
| `src/test/assets.rulesMirror.test.js` | Mirror new rules predicates. |
| `src/test/firestoreAssetRepository.test.js` | Cases for new fields and the windows-license invariant. |
| `src/test/AssetFormDialog.test.jsx` | Subtype select, condition default, warranty conditional inputs, license-mode target picker, windows-license employee disable. |
| `src/test/AssignDialog.test.jsx` | License source → asset target picker, windows-license disables employee. |
| `src/test/columns.test.js` | New column keys present and ordered. |
| `src/test/assetImportService.test.js` | New column validation paths. |
| `src/test/assetExportService.test.js` | New columns emitted. |
| `src/test/assetsLocale.step3.test.js` | New keys present in all three locales. |

---

## Architectural Decisions (locked)

These were resolved during brainstorming and are non-negotiable for this plan:

1. **Sub-types are a Firestore collection** (`/asset_subtypes/{id}`), not a hardcoded enum. Bootstrapped once on first super_admin sign-in via `StatusesAndCategoriesBootstrap`. Stable doc ids of the form `<category>_<slug>` (e.g. `furniture_desk`, `device_laptop`, `license_windows`).
2. **`attachableTo` lives on the subtype, not the category.** Values: `'device-only' | 'device-or-employee'`. `null/undefined` for non-license categories. Enforcement: UI disables the disallowed radio with hint text; domain validator rejects mismatched `assignedTo`; rules check shape only.
3. **`ASSIGNMENT_KINDS.ASSET = 'asset'`** is a fifth kind in the discriminated union. Branch and Department remain unavailable for licenses.
4. **Warranty fields are Firestore Timestamps** (consistent with `purchaseDate`). Domain typedef uses `Date | null`. Sanitizer accepts `Date`, ISO string, `null`, `undefined`.
5. **`condition === 'used'` clears warranty fields in the sanitizer** (forces both to `null`). The form mirrors this UX.
6. **Subtype is REQUIRED for every asset.** No back-fill needed (production has zero assets — fresh deployment).
7. **Audit entity `'asset_subtype'`** added to `auditHelper.ALLOWED_ENTITIES`. Every subtype mutation produces an audit row.
8. **Default seed catalog** is the canonical list in Task 7 below — frozen for this plan; future additions go through the catalog editor (out of scope for this plan).

---

## Task Breakdown

### Task 1: Domain layer for sub-types

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/domain/assetSubtypes.js`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/assetSubtypes.test.js`

- [ ] **Step 1.1: Write the failing tests for `sanitizeAssetSubtypeInput` and `validateAssetSubtypeInput`**

Create `src/test/assetSubtypes.test.js` with the following content:

```javascript
import { describe, it, expect } from 'vitest';

import {
  ATTACHABLE_TO,
  ATTACHABLE_TO_LIST,
  emptyAssetSubtypeInput,
  sanitizeAssetSubtypeInput,
  validateAssetSubtypeInput,
  isAssetSubtypeInputValid,
  AssetSubtypeIdConflictError,
} from '@/domain/assetSubtypes.js';

describe('assetSubtypes — constants', () => {
  it('exposes the locked attachableTo enum', () => {
    expect(ATTACHABLE_TO.DEVICE_ONLY).toBe('device-only');
    expect(ATTACHABLE_TO.DEVICE_OR_EMPLOYEE).toBe('device-or-employee');
    expect(ATTACHABLE_TO_LIST).toEqual(['device-only', 'device-or-employee']);
  });
});

describe('assetSubtypes — emptyAssetSubtypeInput', () => {
  it('returns multilang map and active flag, no attachableTo by default', () => {
    const v = emptyAssetSubtypeInput();
    expect(v.categoryId).toBe('');
    expect(v.name).toEqual({ ru: '', en: '', hy: '' });
    expect(v.requiresMultilang).toBe(false);
    expect(v.attachableTo).toBeNull();
    expect(v.sortOrder).toBe(0);
    expect(v.isActive).toBe(true);
  });
});

describe('assetSubtypes — sanitizeAssetSubtypeInput', () => {
  it('mirrors single-string name into all three locales when requiresMultilang is false', () => {
    const r = sanitizeAssetSubtypeInput({
      categoryId: 'device',
      name: '  Laptop  ',
      requiresMultilang: false,
    });
    expect(r.name).toEqual({ ru: 'Laptop', en: 'Laptop', hy: 'Laptop' });
  });

  it('keeps per-locale strings when requiresMultilang is true', () => {
    const r = sanitizeAssetSubtypeInput({
      categoryId: 'furniture',
      name: { ru: '  Стол  ', en: 'Desk', hy: 'Սեղան' },
      requiresMultilang: true,
    });
    expect(r.name).toEqual({ ru: 'Стол', en: 'Desk', hy: 'Սեղան' });
  });

  it('coerces unknown attachableTo to null', () => {
    const r = sanitizeAssetSubtypeInput({
      categoryId: 'license',
      name: 'Windows OS',
      attachableTo: 'bogus',
    });
    expect(r.attachableTo).toBeNull();
  });

  it('keeps a valid attachableTo verbatim', () => {
    const r = sanitizeAssetSubtypeInput({
      categoryId: 'license',
      name: 'Windows OS',
      attachableTo: 'device-only',
    });
    expect(r.attachableTo).toBe('device-only');
  });

  it('coerces sortOrder to integer', () => {
    expect(sanitizeAssetSubtypeInput({ sortOrder: '7' }).sortOrder).toBe(7);
    expect(sanitizeAssetSubtypeInput({ sortOrder: 3.7 }).sortOrder).toBe(3);
    expect(sanitizeAssetSubtypeInput({ sortOrder: 'NaN' }).sortOrder).toBe(0);
  });
});

describe('assetSubtypes — validateAssetSubtypeInput', () => {
  it('requires categoryId', () => {
    const errors = validateAssetSubtypeInput({});
    expect(errors.categoryId).toBe('errorRequired');
  });

  it('requires at least one filled locale when requiresMultilang is false', () => {
    const errors = validateAssetSubtypeInput({
      categoryId: 'device',
      name: { ru: '', en: '', hy: '' },
      requiresMultilang: false,
    });
    expect(errors.name).toBe('errorRequired');
  });

  it('requires all three locales when requiresMultilang is true', () => {
    const errors = validateAssetSubtypeInput({
      categoryId: 'furniture',
      name: { ru: 'Стол', en: '', hy: '' },
      requiresMultilang: true,
    });
    expect(errors.name).toBe('errorNameAllLocales');
  });

  it('passes for a valid device subtype', () => {
    const errors = validateAssetSubtypeInput({
      categoryId: 'device',
      name: 'Laptop',
      requiresMultilang: false,
    });
    expect(errors).toEqual({});
  });

  it('rejects attachableTo on non-license categories', () => {
    const errors = validateAssetSubtypeInput({
      categoryId: 'device',
      name: 'Laptop',
      attachableTo: 'device-only',
    });
    expect(errors.attachableTo).toBe('errorAttachableOnlyForLicense');
  });

  it('isAssetSubtypeInputValid returns true on no errors', () => {
    expect(
      isAssetSubtypeInputValid({
        categoryId: 'license',
        name: 'Office 365',
        requiresMultilang: false,
        attachableTo: 'device-or-employee',
      })
    ).toBe(true);
  });
});

describe('assetSubtypes — error classes', () => {
  it('AssetSubtypeIdConflictError carries the id', () => {
    const e = new AssetSubtypeIdConflictError('device_laptop');
    expect(e.id).toBe('device_laptop');
    expect(e.code).toBe('asset_subtype/id-conflict');
  });
});
```

- [ ] **Step 1.2: Run the tests and confirm they fail**

Run: `npx vitest run src/test/assetSubtypes.test.js`
Expected: FAIL with module-resolution error (`Cannot find module '@/domain/assetSubtypes.js'`).

- [ ] **Step 1.3: Implement `src/domain/assetSubtypes.js`**

Create `src/domain/assetSubtypes.js` with the following content:

```javascript
/**
 * Asset Sub-types domain module.
 *
 * Sub-types refine a category. Picking "Device" then "Laptop" is far
 * better UX than free-typing "Laptop" into the asset name field every
 * time. The catalog is admin-editable, lives at `/asset_subtypes/{id}`,
 * and is seeded once on first super_admin sign-in by
 * `StatusesAndCategoriesBootstrap`.
 *
 * Schema decisions (Wave 1, Step 4):
 *   - `id` (doc id) is stable: `${categoryId}_${slug}` (e.g. `device_laptop`).
 *   - `name` is Tier 2 multi-lang `{ ru, en, hy }`. For categories where
 *     `requiresMultilang === false` (Device, License) the sanitizer
 *     mirrors the single string into all three locales — same convention
 *     as `firestoreCategoryRepository.js`.
 *   - `attachableTo` is license-only and constrains where a license-asset
 *     can be assigned. `'device-only'` (e.g. Windows OEM) blocks employee
 *     assignment; `'device-or-employee'` allows both. `null` for
 *     non-license categories.
 *   - `isActive` is a soft-delete flag; hard-delete is forbidden by rules.
 *
 * Pure JavaScript: no Firestore, no React. Repository adapter and form
 * layer consume these helpers.
 */

import { SUPPORTED_LOCALES } from '@/i18n/namespaces.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ATTACHABLE_TO = Object.freeze({
  DEVICE_ONLY: 'device-only',
  DEVICE_OR_EMPLOYEE: 'device-or-employee',
});

export const ATTACHABLE_TO_LIST = Object.freeze([
  ATTACHABLE_TO.DEVICE_ONLY,
  ATTACHABLE_TO.DEVICE_OR_EMPLOYEE,
]);

/**
 * The category id strings that are allowed to carry an `attachableTo`
 * value. Today this is just `'license'`. Kept as a list so we can grow
 * without re-coding the validator.
 */
export const ATTACHABLE_TO_CATEGORY_IDS = Object.freeze(['license']);

// ---------------------------------------------------------------------------
// Typedefs
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} AssetSubtypeName
 * @property {string} ru
 * @property {string} en
 * @property {string} hy
 */

/**
 * @typedef {Object} AssetSubtype
 * @property {string} subtypeId                    // mirrors doc id
 * @property {string} categoryId                   // FK -> categories
 * @property {AssetSubtypeName} name               // always stored as 3-locale map
 * @property {boolean} requiresMultilang           // mirrors category convention
 * @property {('device-only'|'device-or-employee'|null)} attachableTo
 * @property {number} sortOrder
 * @property {boolean} isActive
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */

/**
 * @typedef {Object} AssetSubtypeInput
 * @property {string} categoryId
 * @property {AssetSubtypeName | string} [name]
 * @property {boolean} [requiresMultilang]
 * @property {('device-only'|'device-or-employee'|null)} [attachableTo]
 * @property {number} [sortOrder]
 * @property {boolean} [isActive]
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trimOrEmpty(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function emptyName() {
  return SUPPORTED_LOCALES.reduce((acc, l) => ({ ...acc, [l]: '' }), {});
}

/**
 * Form-state seed.
 * @returns {AssetSubtypeInput}
 */
export function emptyAssetSubtypeInput() {
  return {
    categoryId: '',
    name: emptyName(),
    requiresMultilang: false,
    attachableTo: null,
    sortOrder: 0,
    isActive: true,
  };
}

/**
 * Trim, normalize, and reshape into the canonical persistence form. Does
 * not validate.
 *
 * @param {AssetSubtypeInput} input
 * @returns {AssetSubtypeInput}
 */
export function sanitizeAssetSubtypeInput(input) {
  const raw = input ?? {};
  const requiresMultilang = Boolean(raw.requiresMultilang);

  // ---- name ----
  let name;
  if (requiresMultilang) {
    const m = raw.name && typeof raw.name === 'object' ? raw.name : {};
    name = SUPPORTED_LOCALES.reduce(
      (acc, l) => ({ ...acc, [l]: trimOrEmpty(m[l]) }),
      {}
    );
  } else {
    let single;
    if (raw.name && typeof raw.name === 'object') {
      const m = raw.name;
      single = trimOrEmpty(m.ru) || trimOrEmpty(m.en) || trimOrEmpty(m.hy) || '';
    } else {
      single = trimOrEmpty(raw.name);
    }
    name = SUPPORTED_LOCALES.reduce(
      (acc, l) => ({ ...acc, [l]: single }),
      {}
    );
  }

  // ---- attachableTo ----
  let attachableTo = null;
  if (ATTACHABLE_TO_LIST.includes(raw.attachableTo)) {
    attachableTo = raw.attachableTo;
  }

  // ---- sortOrder ----
  let sortOrder = 0;
  if (typeof raw.sortOrder === 'number' && Number.isFinite(raw.sortOrder)) {
    sortOrder = Math.trunc(raw.sortOrder);
  } else if (typeof raw.sortOrder === 'string') {
    const parsed = Number.parseInt(raw.sortOrder.trim(), 10);
    if (Number.isFinite(parsed)) sortOrder = parsed;
  }

  return {
    categoryId: trimOrEmpty(raw.categoryId),
    name,
    requiresMultilang,
    attachableTo,
    sortOrder,
    isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
  };
}

/**
 * Validate sanitized input. Returns `{ field: errorKey }`.
 *
 * Error keys are i18n keys in the `assets` namespace.
 *
 * @param {AssetSubtypeInput} input
 * @returns {Record<string, string>}
 */
export function validateAssetSubtypeInput(input) {
  const errors = {};
  const s = sanitizeAssetSubtypeInput(input);

  if (!s.categoryId) {
    errors.categoryId = 'errorRequired';
  }

  // name
  const map = s.name;
  if (s.requiresMultilang) {
    const filled = SUPPORTED_LOCALES.filter((l) => map[l] && map[l].length > 0);
    if (filled.length === 0) {
      errors.name = 'errorRequired';
    } else if (filled.length < SUPPORTED_LOCALES.length) {
      errors.name = 'errorNameAllLocales';
    }
  } else {
    const anyFilled = SUPPORTED_LOCALES.some(
      (l) => map[l] && map[l].length > 0
    );
    if (!anyFilled) errors.name = 'errorRequired';
  }

  // attachableTo only valid for category ids in ATTACHABLE_TO_CATEGORY_IDS
  if (
    s.attachableTo !== null &&
    !ATTACHABLE_TO_CATEGORY_IDS.includes(s.categoryId)
  ) {
    errors.attachableTo = 'errorAttachableOnlyForLicense';
  }

  return errors;
}

export function isAssetSubtypeInputValid(input) {
  return Object.keys(validateAssetSubtypeInput(input)).length === 0;
}

// ---------------------------------------------------------------------------
// Custom error classes
// ---------------------------------------------------------------------------

export class AssetSubtypeIdConflictError extends Error {
  constructor(id) {
    super(`Asset subtype id already in use: ${id}`);
    this.name = 'AssetSubtypeIdConflictError';
    this.code = 'asset_subtype/id-conflict';
    this.id = id;
  }
}

export class AssetSubtypeInactiveError extends Error {
  constructor(id) {
    super(`Asset subtype ${id} is inactive or missing`);
    this.name = 'AssetSubtypeInactiveError';
    this.code = 'asset_subtype/inactive';
    this.id = id;
  }
}
```

- [ ] **Step 1.4: Run the tests and confirm they pass**

Run: `npx vitest run src/test/assetSubtypes.test.js`
Expected: PASS, all tests green.

- [ ] **Step 1.5: Run lint**

Run: `npm run lint -- src/domain/assetSubtypes.js src/test/assetSubtypes.test.js`
Expected: clean (no warnings).

---

### Task 2: Extend `assets.js` domain with subtype, condition, warranty, and `asset` assignment kind

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/domain/assets.js`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/test/assets.test.js`

- [ ] **Step 2.1: Append failing tests to `src/test/assets.test.js`**

Add the following block at the bottom of `src/test/assets.test.js` (before the final close-brace if any wraps everything; if the file is a flat list of `describe()` calls just append). The new tests reference `ASSIGNMENT_KINDS.ASSET`, the new typedef fields, and new error keys.

```javascript
import { ATTACHABLE_TO } from '@/domain/assetSubtypes.js';

describe('assets — subtype + condition + warranty + asset-kind extensions', () => {
  it('emptyAssetInput seeds new condition + null warranty + empty subtypeId', () => {
    const v = emptyAssetInput();
    expect(v.subtypeId).toBe('');
    expect(v.condition).toBe('new');
    expect(v.warrantyStart).toBeNull();
    expect(v.warrantyEnd).toBeNull();
  });

  it('ASSIGNMENT_KINDS.ASSET is the fifth kind', () => {
    expect(ASSIGNMENT_KINDS.ASSET).toBe('asset');
    expect(ASSIGNMENT_KIND_LIST).toContain('asset');
  });

  it('sanitizeAssetInput passes through subtypeId trimmed', () => {
    const r = sanitizeAssetInput({
      categoryId: 'device',
      subtypeId: '  device_laptop  ',
    });
    expect(r.subtypeId).toBe('device_laptop');
  });

  it('sanitizeAssetInput coerces unknown condition to "new"', () => {
    expect(sanitizeAssetInput({ condition: 'broken' }).condition).toBe('new');
    expect(sanitizeAssetInput({ condition: 'used' }).condition).toBe('used');
    expect(sanitizeAssetInput({ condition: 'new' }).condition).toBe('new');
  });

  it('sanitizeAssetInput nulls warranty fields when condition is used', () => {
    const r = sanitizeAssetInput({
      condition: 'used',
      warrantyStart: new Date('2026-01-01'),
      warrantyEnd: new Date('2027-01-01'),
    });
    expect(r.warrantyStart).toBeNull();
    expect(r.warrantyEnd).toBeNull();
  });

  it('sanitizeAssetInput parses warranty date strings', () => {
    const r = sanitizeAssetInput({
      condition: 'new',
      warrantyStart: '2026-05-07',
      warrantyEnd: '2027-05-07',
    });
    expect(r.warrantyStart).toBeInstanceOf(Date);
    expect(r.warrantyEnd).toBeInstanceOf(Date);
  });

  it('sanitizeAssetInput coerces invalid date string to null', () => {
    const r = sanitizeAssetInput({
      condition: 'new',
      warrantyStart: 'not a date',
    });
    expect(r.warrantyStart).toBeNull();
  });

  it('sanitizeAssetInput accepts assignedTo asset kind', () => {
    const r = sanitizeAssetInput({
      categoryId: 'license',
      assignedTo: { kind: 'asset', id: 'asset-123' },
    });
    expect(r.assignedTo.kind).toBe('asset');
    expect(r.assignedTo.id).toBe('asset-123');
  });

  it('sanitizeAssetInput nulls branchId when assignedTo is asset', () => {
    const r = sanitizeAssetInput({
      assignedTo: { kind: 'asset', id: 'asset-123' },
      branchId: 'branch-7',
    });
    expect(r.branchId).toBeNull();
  });

  it('validateAssetInput requires subtypeId', () => {
    const errors = validateAssetInput({
      categoryId: 'device',
      subtypeId: '',
      name: 'Some name',
    });
    expect(errors.subtypeId).toBe('errorRequired');
  });

  it('validateAssetInput requires condition', () => {
    const errors = validateAssetInput({
      categoryId: 'device',
      subtypeId: 'device_laptop',
      name: 'Some name',
      condition: '',
    });
    expect(errors.condition).toBe('errorRequired');
  });

  it('validateAssetInput rejects warrantyEnd earlier than warrantyStart', () => {
    const errors = validateAssetInput({
      categoryId: 'device',
      subtypeId: 'device_laptop',
      name: 'Some name',
      condition: 'new',
      warrantyStart: new Date('2027-01-01'),
      warrantyEnd: new Date('2026-01-01'),
    });
    expect(errors.warrantyEnd).toBe('errorWarrantyEndBeforeStart');
  });

  it('validateAssetInput accepts equal start and end', () => {
    const errors = validateAssetInput({
      categoryId: 'device',
      subtypeId: 'device_laptop',
      name: 'Some name',
      condition: 'new',
      warrantyStart: new Date('2026-05-07'),
      warrantyEnd: new Date('2026-05-07'),
      assignedTo: { kind: 'warehouse', id: null },
      branchId: 'branch-7',
    });
    expect(errors.warrantyEnd).toBeUndefined();
  });

  it('validateAssetInput rejects employee assignment for windows-style license subtype', () => {
    const errors = validateAssetInput(
      {
        categoryId: 'license',
        subtypeId: 'license_windows',
        name: 'Windows Pro',
        condition: 'new',
        assignedTo: { kind: 'employee', id: 'emp-1' },
      },
      {
        category: { requiresMultilang: false },
        subtype: { attachableTo: ATTACHABLE_TO.DEVICE_ONLY },
      }
    );
    expect(errors.assignedTo).toBe('errorLicenseDeviceOnly');
  });

  it('validateAssetInput accepts asset-kind assignment for any license subtype', () => {
    const errors = validateAssetInput(
      {
        categoryId: 'license',
        subtypeId: 'license_office365',
        name: 'Office 365',
        condition: 'new',
        assignedTo: { kind: 'asset', id: 'asset-abc' },
      },
      {
        category: { requiresMultilang: false },
        subtype: { attachableTo: ATTACHABLE_TO.DEVICE_OR_EMPLOYEE },
      }
    );
    expect(errors.assignedTo).toBeUndefined();
  });

  it('validateAssetInput rejects asset-kind assignment for non-license categories', () => {
    const errors = validateAssetInput(
      {
        categoryId: 'device',
        subtypeId: 'device_laptop',
        name: 'Some laptop',
        condition: 'new',
        assignedTo: { kind: 'asset', id: 'asset-abc' },
      },
      {
        category: { requiresMultilang: false },
        subtype: { attachableTo: null },
      }
    );
    expect(errors.assignedTo).toBe('errorAssetTargetNotLicense');
  });
});
```

- [ ] **Step 2.2: Run tests and verify they fail**

Run: `npx vitest run src/test/assets.test.js`
Expected: 14 new failures referencing missing `ASSIGNMENT_KINDS.ASSET`, missing `subtypeId`, etc.

- [ ] **Step 2.3: Apply edits to `src/domain/assets.js`**

Patch in this exact order:

(a) Replace the `ASSIGNMENT_KINDS` block (around lines 53-58) with:

```javascript
export const ASSIGNMENT_KINDS = Object.freeze({
  WAREHOUSE: 'warehouse',
  EMPLOYEE: 'employee',
  BRANCH: 'branch',
  DEPARTMENT: 'department',
  ASSET: 'asset',
});
```

(b) Update the `AssignedTo` typedef (around line 64-69) to:

```javascript
/**
 * @typedef {{ kind: 'warehouse', id: null }
 *           | { kind: 'employee', id: string }
 *           | { kind: 'branch', id: string }
 *           | { kind: 'department', id: string }
 *           | { kind: 'asset', id: string }} AssignedTo
 */
```

(c) Add to the `Asset` typedef (around lines 79-98), after `serialNumber`:

```javascript
 * @property {string} subtypeId                            // FK -> asset_subtypes
 * @property {('new'|'used')} condition
 * @property {import('firebase/firestore').Timestamp|null} warrantyStart
 * @property {import('firebase/firestore').Timestamp|null} warrantyEnd
```

(d) Add to the `AssetInput` typedef (around lines 100-114), after `serialNumber`:

```javascript
 * @property {string} [subtypeId]
 * @property {('new'|'used')} [condition]
 * @property {Date|null} [warrantyStart]
 * @property {Date|null} [warrantyEnd]
```

(e) Replace `emptyAssetInput()` (around lines 161-176) with:

```javascript
export function emptyAssetInput() {
  return {
    categoryId: '',
    subtypeId: '',
    name: '',
    brand: null,
    model: null,
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
    isActive: true,
  };
}
```

(f) Replace `sanitizeAssetInput()` (around lines 190-266) with:

```javascript
export function sanitizeAssetInput(input, opts = {}) {
  const raw = input ?? {};
  const category = opts.category ?? null;
  const wantsMultilang = Boolean(category?.requiresMultilang);

  // ---- name ----
  let name;
  if (wantsMultilang) {
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
  if (kind === ASSIGNMENT_KINDS.WAREHOUSE) {
    id = null;
  }
  const assignedTo = { kind, id };

  // ---- branchId ----
  // - warehouse / branch modes need a branchId;
  // - employee / department / asset modes don't (the asset is "with someone/something").
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

  // ---- dates: purchaseDate, warrantyStart, warrantyEnd ----
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
  let condition = raw.condition === 'used' ? 'used' : 'new';
  let warrantyStart = parseDate(raw.warrantyStart);
  let warrantyEnd = parseDate(raw.warrantyEnd);
  if (condition === 'used') {
    warrantyStart = null;
    warrantyEnd = null;
  }

  return {
    categoryId: trimOrEmpty(raw.categoryId),
    subtypeId: trimOrEmpty(raw.subtypeId),
    name,
    brand: trimOrNull(raw.brand),
    model: trimOrNull(raw.model),
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
    isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
  };
}
```

(g) Replace `validateAssetInput()` (around lines 278-335) with:

```javascript
export function validateAssetInput(input, opts = {}) {
  const errors = {};
  const category = opts.category ?? null;
  const subtype = opts.subtype ?? null;
  const wantsMultilang = Boolean(category?.requiresMultilang);
  const s = sanitizeAssetInput(input, opts);

  // categoryId required.
  if (!s.categoryId) {
    errors.categoryId = 'errorRequired';
  }

  // subtypeId required.
  if (!s.subtypeId) {
    errors.subtypeId = 'errorRequired';
  }

  // name validation. Only meaningful when a category is picked.
  if (s.categoryId) {
    if (wantsMultilang) {
      const map = /** @type {AssetName} */ (s.name);
      const filled = SUPPORTED_LOCALES.filter((l) => map[l] && map[l].length > 0);
      if (filled.length === 0) {
        errors.name = 'errorRequired';
      } else if (filled.length < SUPPORTED_LOCALES.length) {
        errors.name = 'errorNameAllLocales';
      }
    } else {
      if (!s.name || (typeof s.name === 'string' && s.name.length === 0)) {
        errors.name = 'errorRequired';
      }
    }
  }

  // brand / model / serialNumber must be ASCII when present.
  if (s.brand && NON_ASCII_REGEX.test(s.brand)) errors.brand = 'errorAsciiOnly';
  if (s.model && NON_ASCII_REGEX.test(s.model)) errors.model = 'errorAsciiOnly';
  if (s.serialNumber && NON_ASCII_REGEX.test(s.serialNumber)) {
    errors.serialNumber = 'errorAsciiOnly';
  }

  // assignedTo validation: shape + per-category invariants.
  const at = s.assignedTo;
  if (!ASSIGNMENT_KIND_LIST.includes(at?.kind)) {
    errors.assignedTo = 'errorRequired';
  } else if (at.kind !== ASSIGNMENT_KINDS.WAREHOUSE && !at.id) {
    errors.assignedTo = 'errorRequired';
  } else if (at.kind === ASSIGNMENT_KINDS.ASSET && s.categoryId !== 'license') {
    // Only license assets can be attached to other assets.
    errors.assignedTo = 'errorAssetTargetNotLicense';
  } else if (at.kind === ASSIGNMENT_KINDS.EMPLOYEE && subtype?.attachableTo === 'device-only') {
    // Windows-style license subtypes cannot be assigned to an employee.
    errors.assignedTo = 'errorLicenseDeviceOnly';
  }

  // branchId required for warehouse / branch modes.
  if (
    at?.kind === ASSIGNMENT_KINDS.WAREHOUSE ||
    at?.kind === ASSIGNMENT_KINDS.BRANCH
  ) {
    if (!s.branchId) errors.branchId = 'errorRequired';
  }

  // statusId must be non-empty.
  if (!s.statusId) errors.statusId = 'errorRequired';

  // condition must be a known string.
  if (s.condition !== 'new' && s.condition !== 'used') {
    errors.condition = 'errorRequired';
  }

  // warranty: end >= start when both provided.
  if (s.condition === 'new' && s.warrantyStart && s.warrantyEnd) {
    if (s.warrantyEnd.valueOf() < s.warrantyStart.valueOf()) {
      errors.warrantyEnd = 'errorWarrantyEndBeforeStart';
    }
  }

  return errors;
}
```

- [ ] **Step 2.4: Re-run the full assets test file**

Run: `npx vitest run src/test/assets.test.js`
Expected: PASS, all tests green (existing + new).

- [ ] **Step 2.5: Lint**

Run: `npm run lint -- src/domain/assets.js src/test/assets.test.js`
Expected: clean.

---

### Task 3: Add `'asset_subtype'` to audit allowed entities

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/lib/audit/auditHelper.js`

- [ ] **Step 3.1: Edit `src/lib/audit/auditHelper.js`**

Replace the `ALLOWED_ENTITIES` array (lines 5-17) with:

```javascript
const ALLOWED_ENTITIES = [
  'asset',
  'asset_subtype',
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
```

- [ ] **Step 3.2: Run the existing audit-helper-touching tests**

Run: `npx vitest run src/test/firestoreAuditRepository.test.js src/test/assets.test.js`
Expected: PASS (no regression — `'asset_subtype'` is purely additive).

---

### Task 4: Firestore repository for sub-types

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/domain/repositories/AssetSubtypeRepository.js`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/infra/repositories/firestoreAssetSubtypeRepository.js`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/firestoreAssetSubtypeRepository.test.js`

- [ ] **Step 4.1: Read the reference implementation in full**

Read `C:/Users/DELL/Desktop/assets-crm/src/infra/repositories/firestoreCategoryRepository.js` end-to-end. The new repository mirrors its shape — `subscribe`, `get`, `create({ id })`, `update`, `setActive`, all wrapped in `runTransaction()` with audit-helper writes. The only differences are: collection name `asset_subtypes`, audit entity `'asset_subtype'`, persisted fields per the typedef in `assetSubtypes.js`, and the conflict error class `AssetSubtypeIdConflictError`.

- [ ] **Step 4.2: Read the reference test in full**

Read `C:/Users/DELL/Desktop/assets-crm/src/test/firestoreCategoryRepository.test.js` end-to-end. The new test follows the same `vi.mock('firebase/firestore', ...)` setup and exercises: subscribe on snapshot, create with stable id, create with id conflict throws, update changes name and writes audit, setActive flips flag and writes audit.

- [ ] **Step 4.3: Write the failing tests**

Create `src/test/firestoreAssetSubtypeRepository.test.js`. Mirror `firestoreCategoryRepository.test.js` but adapt:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ----- Firestore mock (identical pattern to firestoreCategoryRepository.test.js) -----
const txnReadDocs = new Map();
const writes = [];

vi.mock('firebase/firestore', () => {
  const collection = vi.fn(() => ({ __type: 'col' }));
  const doc = vi.fn((_db, path, id) => ({
    __type: 'doc',
    path: id ? `${path}/${id}` : path,
    id,
  }));
  const onSnapshot = vi.fn((_q, cb) => {
    const snap = {
      docs: [
        { id: 'device_laptop', data: () => ({ categoryId: 'device', name: { ru: 'Laptop', en: 'Laptop', hy: 'Laptop' }, isActive: true, sortOrder: 1 }) },
      ],
    };
    cb(snap);
    return () => {};
  });
  const orderBy = vi.fn(() => ({ __type: 'orderBy' }));
  const query = vi.fn((c) => c);
  const serverTimestamp = vi.fn(() => ({ __type: 'ts' }));
  const Timestamp = { fromDate: (d) => ({ __ts: d.toISOString() }) };

  async function runTransaction(_db, fn) {
    writes.length = 0;
    const txn = {
      get: vi.fn(async (ref) => {
        const data = txnReadDocs.get(ref.path);
        return {
          exists: () => data !== undefined,
          data: () => data,
          id: ref.id,
        };
      }),
      set: vi.fn((ref, data) => writes.push({ op: 'set', ref, data })),
      update: vi.fn((ref, data) => writes.push({ op: 'update', ref, data })),
    };
    return fn(txn);
  }

  return {
    collection,
    doc,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    Timestamp,
    runTransaction,
  };
});

import {
  firestoreAssetSubtypeRepository,
} from '@/infra/repositories/firestoreAssetSubtypeRepository.js';
import { AssetSubtypeIdConflictError } from '@/domain/assetSubtypes.js';

beforeEach(() => {
  txnReadDocs.clear();
  writes.length = 0;
});

describe('firestoreAssetSubtypeRepository — subscribe', () => {
  it('emits a list when the snapshot fires', async () => {
    const seen = [];
    const unsub = firestoreAssetSubtypeRepository.subscribe((items) => {
      seen.push(items);
    });
    expect(seen).toHaveLength(1);
    expect(seen[0][0].subtypeId).toBe('device_laptop');
    expect(typeof unsub).toBe('function');
  });
});

describe('firestoreAssetSubtypeRepository — create', () => {
  it('creates a new subtype with a stable id and writes an audit row', async () => {
    await firestoreAssetSubtypeRepository.create(
      {
        categoryId: 'device',
        name: 'Server',
        requiresMultilang: false,
      },
      { uid: 'u1', role: 'super_admin' },
      { id: 'device_server' }
    );

    const dataWrites = writes.filter((w) => w.ref.path === 'asset_subtypes/device_server');
    expect(dataWrites).toHaveLength(1);
    const auditWrites = writes.filter((w) => w.ref.path?.startsWith?.('audit_logs/'));
    expect(auditWrites).toHaveLength(1);
    expect(auditWrites[0].data.entity).toBe('asset_subtype');
    expect(auditWrites[0].data.action).toBe('create');
  });

  it('throws AssetSubtypeIdConflictError when the id already exists', async () => {
    txnReadDocs.set('asset_subtypes/device_laptop', { categoryId: 'device' });
    await expect(
      firestoreAssetSubtypeRepository.create(
        { categoryId: 'device', name: 'Laptop' },
        { uid: 'u1', role: 'super_admin' },
        { id: 'device_laptop' }
      )
    ).rejects.toBeInstanceOf(AssetSubtypeIdConflictError);
  });
});

describe('firestoreAssetSubtypeRepository — update', () => {
  it('updates the name and writes audit', async () => {
    txnReadDocs.set('asset_subtypes/device_laptop', {
      categoryId: 'device',
      name: { ru: 'Laptop', en: 'Laptop', hy: 'Laptop' },
      requiresMultilang: false,
      attachableTo: null,
      sortOrder: 0,
      isActive: true,
    });
    await firestoreAssetSubtypeRepository.update(
      'device_laptop',
      { name: 'Notebook' },
      { uid: 'u1', role: 'super_admin' }
    );
    const audit = writes.find((w) => w.ref.path?.startsWith?.('audit_logs/'));
    expect(audit.data.action).toBe('update');
    expect(audit.data.entity).toBe('asset_subtype');
  });
});

describe('firestoreAssetSubtypeRepository — setActive', () => {
  it('flips the flag and writes audit', async () => {
    txnReadDocs.set('asset_subtypes/device_laptop', {
      categoryId: 'device',
      name: { ru: 'Laptop', en: 'Laptop', hy: 'Laptop' },
      requiresMultilang: false,
      attachableTo: null,
      sortOrder: 0,
      isActive: true,
    });
    await firestoreAssetSubtypeRepository.setActive(
      'device_laptop',
      false,
      { uid: 'u1', role: 'super_admin' }
    );
    const audit = writes.find((w) => w.ref.path?.startsWith?.('audit_logs/'));
    expect(audit.data.action).toBe('deactivate');
  });
});
```

- [ ] **Step 4.4: Run the tests and confirm they fail**

Run: `npx vitest run src/test/firestoreAssetSubtypeRepository.test.js`
Expected: FAIL with module-not-found.

- [ ] **Step 4.5: Create the port**

Create `src/domain/repositories/AssetSubtypeRepository.js`:

```javascript
/**
 * AssetSubtypeRepository — port (interface).
 *
 * Adapters live in `src/infra/repositories/`. UI / hooks consume the
 * adapter exclusively; no `firebase/*` imports below this boundary.
 *
 * @typedef {Object} AssetSubtypeRepository
 * @property {(callback: (items: import('../assetSubtypes.js').AssetSubtype[]) => void, onError?: (e: Error) => void) => () => void} subscribe
 * @property {(id: string) => Promise<import('../assetSubtypes.js').AssetSubtype | null>} get
 * @property {(input: import('../assetSubtypes.js').AssetSubtypeInput, actor: { uid: string, role: string }, opts?: { id?: string }) => Promise<string>} create
 * @property {(id: string, patch: import('../assetSubtypes.js').AssetSubtypeInput, actor: { uid: string, role: string }) => Promise<void>} update
 * @property {(id: string, isActive: boolean, actor: { uid: string, role: string }) => Promise<void>} setActive
 */

export {};
```

- [ ] **Step 4.6: Create the Firestore adapter**

Create `src/infra/repositories/firestoreAssetSubtypeRepository.js`. Mirror the structure of `firestoreCategoryRepository.js` (use it as a reference reading material — do not copy/rename mechanically; the persisted shape differs):

```javascript
/**
 * Firestore adapter for AssetSubtypeRepository.
 *
 * Mirrors firestoreCategoryRepository.js: every mutation runs in a single
 * runTransaction() that writes both the data doc AND the audit_logs entry.
 * Components and hooks must NEVER import this adapter directly — they
 * import the hook (`useAssetSubtypes`) which subscribes through here.
 */

import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';
import {
  AssetSubtypeIdConflictError,
  sanitizeAssetSubtypeInput,
} from '@/domain/assetSubtypes.js';

const COLLECTION = 'asset_subtypes';

function snapshotToSubtype(docSnap) {
  const data = docSnap.data() ?? {};
  return {
    subtypeId: docSnap.id,
    categoryId: data.categoryId ?? '',
    name: data.name ?? { ru: '', en: '', hy: '' },
    requiresMultilang: Boolean(data.requiresMultilang),
    attachableTo: data.attachableTo ?? null,
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
    isActive: data.isActive !== false,
    createdAt: data.createdAt ?? null,
    createdBy: data.createdBy ?? '',
    updatedAt: data.updatedAt ?? null,
    updatedBy: data.updatedBy ?? '',
  };
}

function auditSnapshot(data) {
  return {
    categoryId: data.categoryId ?? '',
    name: data.name ?? null,
    requiresMultilang: Boolean(data.requiresMultilang),
    attachableTo: data.attachableTo ?? null,
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
    isActive: data.isActive !== false,
  };
}

export const firestoreAssetSubtypeRepository = {
  subscribe(callback, onError) {
    const q = query(collection(db, COLLECTION), orderBy('sortOrder', 'asc'));
    return onSnapshot(
      q,
      (snap) => {
        const items = [];
        snap.docs.forEach((d) => items.push(snapshotToSubtype(d)));
        callback(items);
      },
      onError
    );
  },

  async get(id) {
    return new Promise((resolve, reject) => {
      const ref = doc(db, COLLECTION, id);
      const unsub = onSnapshot(
        ref,
        (snap) => {
          unsub();
          if (!snap.exists?.()) {
            resolve(null);
            return;
          }
          resolve(snapshotToSubtype(snap));
        },
        (err) => {
          unsub();
          reject(err);
        }
      );
    });
  },

  async create(input, actor, opts = {}) {
    const sanitized = sanitizeAssetSubtypeInput(input);
    const id = (opts.id ?? '').trim();
    if (!id) {
      throw new Error('firestoreAssetSubtypeRepository.create: opts.id required');
    }

    await runTransaction(db, async (txn) => {
      const ref = doc(db, COLLECTION, id);
      const existing = await txn.get(ref);
      if (existing.exists?.()) {
        throw new AssetSubtypeIdConflictError(id);
      }

      const after = {
        categoryId: sanitized.categoryId,
        name: sanitized.name,
        requiresMultilang: sanitized.requiresMultilang,
        attachableTo: sanitized.attachableTo,
        sortOrder: sanitized.sortOrder,
        isActive: sanitized.isActive,
        createdAt: serverTimestamp(),
        createdBy: actor.uid,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      };
      txn.set(ref, after);

      txn.set(
        newAuditLogRef(),
        buildAuditLog({
          entity: 'asset_subtype',
          entityId: id,
          action: 'create',
          actorUid: actor.uid,
          actorRole: actor.role,
          before: null,
          after: auditSnapshot(after),
        })
      );
    });

    return id;
  },

  async update(id, patch, actor) {
    await runTransaction(db, async (txn) => {
      const ref = doc(db, COLLECTION, id);
      const snap = await txn.get(ref);
      if (!snap.exists?.()) {
        throw new Error(`asset_subtype/${id} not found`);
      }
      const before = snap.data();
      const sanitized = sanitizeAssetSubtypeInput({
        categoryId: before.categoryId,
        name: patch.name ?? before.name,
        requiresMultilang:
          patch.requiresMultilang === undefined
            ? before.requiresMultilang
            : patch.requiresMultilang,
        attachableTo:
          patch.attachableTo === undefined
            ? before.attachableTo
            : patch.attachableTo,
        sortOrder: patch.sortOrder === undefined ? before.sortOrder : patch.sortOrder,
        isActive: patch.isActive === undefined ? before.isActive : patch.isActive,
      });
      const after = {
        categoryId: sanitized.categoryId,
        name: sanitized.name,
        requiresMultilang: sanitized.requiresMultilang,
        attachableTo: sanitized.attachableTo,
        sortOrder: sanitized.sortOrder,
        isActive: sanitized.isActive,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      };
      txn.update(ref, after);

      txn.set(
        newAuditLogRef(),
        buildAuditLog({
          entity: 'asset_subtype',
          entityId: id,
          action: 'update',
          actorUid: actor.uid,
          actorRole: actor.role,
          before: auditSnapshot(before),
          after: auditSnapshot({ ...before, ...after }),
        })
      );
    });
  },

  async setActive(id, isActive, actor) {
    await runTransaction(db, async (txn) => {
      const ref = doc(db, COLLECTION, id);
      const snap = await txn.get(ref);
      if (!snap.exists?.()) {
        throw new Error(`asset_subtype/${id} not found`);
      }
      const before = snap.data();
      const after = {
        isActive: Boolean(isActive),
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      };
      txn.update(ref, after);

      txn.set(
        newAuditLogRef(),
        buildAuditLog({
          entity: 'asset_subtype',
          entityId: id,
          action: isActive ? 'reactivate' : 'deactivate',
          actorUid: actor.uid,
          actorRole: actor.role,
          before: auditSnapshot(before),
          after: auditSnapshot({ ...before, ...after }),
        })
      );
    });
  },
};
```

- [ ] **Step 4.7: Re-run the tests**

Run: `npx vitest run src/test/firestoreAssetSubtypeRepository.test.js`
Expected: PASS.

- [ ] **Step 4.8: Lint**

Run: `npm run lint -- src/infra/repositories/firestoreAssetSubtypeRepository.js src/domain/repositories/AssetSubtypeRepository.js`
Expected: clean.

---

### Task 5: `useAssetSubtypes` hook

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/hooks/useAssetSubtypes.js`

- [ ] **Step 5.1: Read the reference hook**

Read `C:/Users/DELL/Desktop/assets-crm/src/hooks/useCategories.js` end-to-end. The new hook follows the same shape: `useEffect` subscribes to the repository on mount, `loading`/`error`/`data` state, `useMemo` filtering by `categoryId`.

- [ ] **Step 5.2: Implement the hook**

Create `src/hooks/useAssetSubtypes.js`:

```javascript
import { useEffect, useMemo, useState } from 'react';

import { firestoreAssetSubtypeRepository } from '@/infra/repositories/firestoreAssetSubtypeRepository.js';

/**
 * Subscribes to the full asset_subtypes catalog and exposes a filtered list.
 *
 * @param {{ categoryId?: string | null, includeInactive?: boolean }} [opts]
 * @returns {{ data: import('@/domain/assetSubtypes.js').AssetSubtype[], all: import('@/domain/assetSubtypes.js').AssetSubtype[], loading: boolean, error: Error|null }}
 */
export function useAssetSubtypes(opts = {}) {
  const { categoryId = null, includeInactive = false } = opts;
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    const unsub = firestoreAssetSubtypeRepository.subscribe(
      (items) => {
        setAll(items);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );
    return () => unsub?.();
  }, []);

  const data = useMemo(() => {
    let out = all;
    if (categoryId) {
      out = out.filter((s) => s.categoryId === categoryId);
    }
    if (!includeInactive) {
      out = out.filter((s) => s.isActive !== false);
    }
    return out;
  }, [all, categoryId, includeInactive]);

  return { data, all, loading, error };
}
```

- [ ] **Step 5.3: Lint**

Run: `npm run lint -- src/hooks/useAssetSubtypes.js`
Expected: clean.

---

### Task 6: Firestore rules — new collection block + extended asset shape

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/firestore.rules`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/test/assets.rulesMirror.test.js`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/assetSubtypes.rulesMirror.test.js`

This is the most error-prone task. Read the current `firestore.rules` and the existing rules-mirror tests in full before editing. The mirror tests are JS predicates that must stay byte-aligned with the rules.

- [ ] **Step 6.1: Read current rules end-to-end**

Read `C:/Users/DELL/Desktop/assets-crm/firestore.rules` from line 1 to the end. Locate:
- `isValidAssignedTo(a)` helper — extend with `asset` kind.
- `/categories/{categoryId}` block — clone for `/asset_subtypes/{subtypeId}`.
- `/assets/{assetId}` block — extend create/update predicates with `subtypeId`, `condition`, `warrantyStart`, `warrantyEnd`.

- [ ] **Step 6.2: Read current rules-mirror tests end-to-end**

Read `C:/Users/DELL/Desktop/assets-crm/src/test/assets.rulesMirror.test.js` and `C:/Users/DELL/Desktop/assets-crm/src/test/categories.rulesMirror.test.js` end-to-end.

- [ ] **Step 6.3: Patch `isValidAssignedTo` in `firestore.rules`**

Replace the helper (around lines 452-463) with this exact text:

```text
    function isValidAssignedTo(a) {
      return a is map
        && a.keys().hasOnly(['kind', 'id'])
        && (
          (a.kind == 'warehouse' && a.id == null)
          || (a.kind == 'employee' && a.id is string && a.id.size() > 0)
          || (a.kind == 'branch' && a.id is string && a.id.size() > 0)
          || (a.kind == 'department' && a.id is string && a.id.size() > 0)
          || (a.kind == 'asset' && a.id is string && a.id.size() > 0)
        );
    }
```

- [ ] **Step 6.4: Add the `/asset_subtypes/{subtypeId}` block in `firestore.rules`**

Insert the following block after the `/categories/{categoryId}` block (before the `/assets/{assetId}` block). Use the same role helpers (`isSuperAdmin()`, `isAnyAdmin()`) the file already defines:

```text
    // ----------------- /asset_subtypes/{subtypeId} -----------------
    // Per-category sub-types (Desk, Laptop, Office 365, etc.). Read by
    // any signed-in admin; write by super_admin only. Soft-deactivate.
    match /asset_subtypes/{subtypeId} {
      function isValidSubtypeName(n) {
        return n is map
          && n.keys().hasOnly(['ru', 'en', 'hy'])
          && n.ru is string
          && n.en is string
          && n.hy is string;
      }

      function isValidAttachableTo(v) {
        return v == null || v == 'device-only' || v == 'device-or-employee';
      }

      function canCreateSubtype(data) {
        return data.keys().hasOnly([
            'categoryId', 'name', 'requiresMultilang', 'attachableTo',
            'sortOrder', 'isActive',
            'createdAt', 'createdBy', 'updatedAt', 'updatedBy'
          ])
          && data.categoryId is string && data.categoryId.size() > 0
          && isValidSubtypeName(data.name)
          && data.requiresMultilang is bool
          && isValidAttachableTo(data.attachableTo)
          && data.sortOrder is int
          && data.isActive is bool
          && data.createdBy == request.auth.uid
          && data.updatedBy == request.auth.uid;
      }

      function canUpdateSubtype(before, after) {
        return after.diff(before).affectedKeys().hasOnly([
            'name', 'requiresMultilang', 'attachableTo', 'sortOrder',
            'isActive', 'updatedAt', 'updatedBy'
          ])
          && (after.diff(before).affectedKeys().hasAny(['name']) ? isValidSubtypeName(after.name) : true)
          && (after.diff(before).affectedKeys().hasAny(['attachableTo']) ? isValidAttachableTo(after.attachableTo) : true)
          && after.updatedBy == request.auth.uid;
      }

      allow read:   if isAnyAdmin();
      allow create: if isSuperAdmin() && canCreateSubtype(request.resource.data);
      allow update: if isSuperAdmin() && canUpdateSubtype(resource.data, request.resource.data);
      allow delete: if false;
    }
```

> **NOTE:** if the file uses `isAdmin()` instead of `isAnyAdmin()`, or has a different super_admin helper name, use that name. Read the helpers section before editing.

- [ ] **Step 6.5: Patch `/assets/{assetId}` create/update predicates in `firestore.rules`**

In the assets block, find every `data.keys().hasOnly([ ... ])` (or equivalent) listing of fields. Add the four new field names to the allowed list:

```
'subtypeId', 'condition', 'warrantyStart', 'warrantyEnd'
```

In the same predicate, add the corresponding validation lines. Append after the existing field validations:

```text
          && data.subtypeId is string && data.subtypeId.size() > 0
          && (data.condition == 'new' || data.condition == 'used')
          && (data.warrantyStart == null || data.warrantyStart is timestamp)
          && (data.warrantyEnd == null || data.warrantyEnd is timestamp)
```

For update predicates, add `subtypeId`, `condition`, `warrantyStart`, `warrantyEnd` to the `affectedKeys().hasOnly([...])` list. Keep `subtypeId` updatable (super_admin must be able to fix a wrong pick) but add the same shape guards on update.

- [ ] **Step 6.6: Update `src/test/assets.rulesMirror.test.js`**

Open the file, locate the `isValidAssignedTo` mirror predicate, and add the `asset` kind branch byte-aligned with the rules. Locate the `canCreateAsset` / `canUpdateAsset` mirrors and add the new field shape checks. Finally, append a new `describe` block:

```javascript
describe('rules mirror — extended assignedTo + new asset fields', () => {
  it('isValidAssignedTo accepts asset kind with non-empty id', () => {
    expect(isValidAssignedTo({ kind: 'asset', id: 'abc' })).toBe(true);
    expect(isValidAssignedTo({ kind: 'asset', id: '' })).toBe(false);
    expect(isValidAssignedTo({ kind: 'asset', id: null })).toBe(false);
  });

  it('canCreateAsset rejects missing subtypeId', () => {
    const data = baseAssetData(); // helper that returns a minimal valid asset
    delete data.subtypeId;
    expect(canCreateAsset(data, 'asset_admin')).toBe(false);
  });

  it('canCreateAsset accepts new condition with both warranty timestamps', () => {
    const data = baseAssetData();
    data.subtypeId = 'device_laptop';
    data.condition = 'new';
    data.warrantyStart = mockTimestamp(new Date('2026-05-07'));
    data.warrantyEnd = mockTimestamp(new Date('2027-05-07'));
    expect(canCreateAsset(data, 'asset_admin')).toBe(true);
  });

  it('canCreateAsset accepts used condition with null warranty', () => {
    const data = baseAssetData();
    data.subtypeId = 'device_laptop';
    data.condition = 'used';
    data.warrantyStart = null;
    data.warrantyEnd = null;
    expect(canCreateAsset(data, 'asset_admin')).toBe(true);
  });

  it('canCreateAsset rejects unknown condition', () => {
    const data = baseAssetData();
    data.subtypeId = 'device_laptop';
    data.condition = 'broken';
    expect(canCreateAsset(data, 'asset_admin')).toBe(false);
  });
});
```

If `baseAssetData()` and `mockTimestamp()` helpers don't already exist in the test file, add them inline at the top of the `describe` block based on existing fixture patterns.

- [ ] **Step 6.7: Create `src/test/assetSubtypes.rulesMirror.test.js`**

Mirror the rules block in JS. Use `categories.rulesMirror.test.js` as a template (same structure: helpers, then `canCreateSubtype`, `canUpdateSubtype`, then describes for read/create/update/delete role gating).

```javascript
import { describe, it, expect } from 'vitest';

// JS mirror of the /asset_subtypes/{id} block in firestore.rules.
// Keep byte-aligned with rules — see PLAN-FILE: 2026-05-07-asset-subtypes-condition-warranty.md, Task 6.

function isValidSubtypeName(n) {
  if (!n || typeof n !== 'object') return false;
  const keys = Object.keys(n);
  if (keys.some((k) => !['ru', 'en', 'hy'].includes(k))) return false;
  return ['ru', 'en', 'hy'].every(
    (l) => typeof n[l] === 'string'
  );
}

function isValidAttachableTo(v) {
  return v === null || v === 'device-only' || v === 'device-or-employee';
}

function canCreateSubtype(data, actorUid) {
  const allowed = [
    'categoryId', 'name', 'requiresMultilang', 'attachableTo',
    'sortOrder', 'isActive',
    'createdAt', 'createdBy', 'updatedAt', 'updatedBy',
  ];
  const keys = Object.keys(data);
  if (keys.some((k) => !allowed.includes(k))) return false;
  if (typeof data.categoryId !== 'string' || data.categoryId.length === 0) return false;
  if (!isValidSubtypeName(data.name)) return false;
  if (typeof data.requiresMultilang !== 'boolean') return false;
  if (!isValidAttachableTo(data.attachableTo ?? null)) return false;
  if (!Number.isInteger(data.sortOrder)) return false;
  if (typeof data.isActive !== 'boolean') return false;
  if (data.createdBy !== actorUid) return false;
  if (data.updatedBy !== actorUid) return false;
  return true;
}

function canUpdateSubtype(before, after, actorUid) {
  const changed = Object.keys(after).filter(
    (k) => JSON.stringify(after[k]) !== JSON.stringify(before[k])
  );
  const allowedChange = [
    'name', 'requiresMultilang', 'attachableTo', 'sortOrder',
    'isActive', 'updatedAt', 'updatedBy',
  ];
  if (changed.some((k) => !allowedChange.includes(k))) return false;
  if (changed.includes('name') && !isValidSubtypeName(after.name)) return false;
  if (changed.includes('attachableTo') && !isValidAttachableTo(after.attachableTo ?? null)) {
    return false;
  }
  if (after.updatedBy !== actorUid) return false;
  return true;
}

const VALID = {
  categoryId: 'device',
  name: { ru: 'Laptop', en: 'Laptop', hy: 'Laptop' },
  requiresMultilang: false,
  attachableTo: null,
  sortOrder: 1,
  isActive: true,
  createdAt: 'ts',
  createdBy: 'u1',
  updatedAt: 'ts',
  updatedBy: 'u1',
};

describe('rules mirror — asset_subtypes create', () => {
  it('accepts valid input from super_admin', () => {
    expect(canCreateSubtype(VALID, 'u1')).toBe(true);
  });

  it('rejects unknown attachableTo', () => {
    expect(canCreateSubtype({ ...VALID, attachableTo: 'wat' }, 'u1')).toBe(false);
  });

  it('rejects empty categoryId', () => {
    expect(canCreateSubtype({ ...VALID, categoryId: '' }, 'u1')).toBe(false);
  });

  it('rejects missing locale', () => {
    expect(canCreateSubtype({ ...VALID, name: { ru: 'x', en: 'y' } }, 'u1')).toBe(false);
  });

  it('rejects extra keys', () => {
    expect(canCreateSubtype({ ...VALID, evil: 1 }, 'u1')).toBe(false);
  });

  it('rejects mismatched createdBy', () => {
    expect(canCreateSubtype({ ...VALID, createdBy: 'someone-else' }, 'u1')).toBe(false);
  });
});

describe('rules mirror — asset_subtypes update', () => {
  it('accepts a name change with proper updatedBy', () => {
    const after = { ...VALID, name: { ru: 'Notebook', en: 'Notebook', hy: 'Notebook' } };
    expect(canUpdateSubtype(VALID, after, 'u1')).toBe(true);
  });

  it('rejects categoryId change', () => {
    const after = { ...VALID, categoryId: 'license' };
    expect(canUpdateSubtype(VALID, after, 'u1')).toBe(false);
  });

  it('rejects createdBy change', () => {
    const after = { ...VALID, createdBy: 'attacker' };
    expect(canUpdateSubtype(VALID, after, 'u1')).toBe(false);
  });

  it('accepts setActive flip', () => {
    const after = { ...VALID, isActive: false };
    expect(canUpdateSubtype(VALID, after, 'u1')).toBe(true);
  });
});
```

- [ ] **Step 6.8: Run all rules-mirror tests**

Run: `npx vitest run src/test/assets.rulesMirror.test.js src/test/assetSubtypes.rulesMirror.test.js src/test/categories.rulesMirror.test.js`
Expected: PASS.

- [ ] **Step 6.9: Lint**

Run: `npm run lint -- src/test/assets.rulesMirror.test.js src/test/assetSubtypes.rulesMirror.test.js`
Expected: clean.

---

### Task 7: Bootstrap default sub-type catalog

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/components/system/StatusesAndCategoriesBootstrap.jsx`

The user explicitly said "you know better, this should all be ready in advance." The seed list below is locked.

- [ ] **Step 7.1: Add the seed catalog and bootstrap step**

Edit `src/components/system/StatusesAndCategoriesBootstrap.jsx`. Add the following imports at the top (after existing imports):

```javascript
import { useAssetSubtypes } from '@/hooks/useAssetSubtypes.js';
import { firestoreAssetSubtypeRepository } from '@/infra/repositories/firestoreAssetSubtypeRepository.js';
```

Add the seed catalog constant block (place it after `CATEGORY_SEEDS`):

```javascript
/**
 * Asset sub-type seeds. Stable doc ids are `<categoryId>_<slug>`.
 *
 * - Furniture entries are multi-lang Tier-2 (`requiresMultilang: true`)
 *   because furniture names differ meaningfully across ru/en/hy.
 * - Device and License entries are single-lang (`requiresMultilang: false`):
 *   the sanitizer mirrors the single string into all three locales so
 *   the persisted shape is uniform.
 * - License sub-types carry `attachableTo`. Windows OS is `device-only`
 *   (cannot be assigned to a person); everything else is
 *   `device-or-employee`.
 */
const ASSET_SUBTYPE_SEEDS = [
  // ----- Furniture (multi-lang) -----
  { id: 'furniture_desk',         categoryId: 'furniture', name: { ru: 'Стол',           en: 'Desk',             hy: 'Սեղան' },              requiresMultilang: true,  sortOrder: 10 },
  { id: 'furniture_chair',        categoryId: 'furniture', name: { ru: 'Стул',           en: 'Chair',            hy: 'Աթոռ' },               requiresMultilang: true,  sortOrder: 20 },
  { id: 'furniture_armchair',     categoryId: 'furniture', name: { ru: 'Кресло',         en: 'Armchair',         hy: 'Բազկաթոռ' },           requiresMultilang: true,  sortOrder: 30 },
  { id: 'furniture_cabinet',      categoryId: 'furniture', name: { ru: 'Шкаф',           en: 'Cabinet',          hy: 'Պահարան' },            requiresMultilang: true,  sortOrder: 40 },
  { id: 'furniture_nightstand',   categoryId: 'furniture', name: { ru: 'Тумбочка',       en: 'Nightstand',       hy: 'Կողային սեղան' },     requiresMultilang: true,  sortOrder: 50 },
  { id: 'furniture_shelf',        categoryId: 'furniture', name: { ru: 'Полка',          en: 'Shelf',            hy: 'Դարակ' },              requiresMultilang: true,  sortOrder: 60 },
  { id: 'furniture_sofa',         categoryId: 'furniture', name: { ru: 'Диван',          en: 'Sofa',             hy: 'Բազմոց' },             requiresMultilang: true,  sortOrder: 70 },
  { id: 'furniture_conf_table',   categoryId: 'furniture', name: { ru: 'Конференц-стол', en: 'Conference table', hy: 'Կոնֆերանս սեղան' },   requiresMultilang: true,  sortOrder: 80 },
  { id: 'furniture_safe',         categoryId: 'furniture', name: { ru: 'Сейф',           en: 'Safe',             hy: 'Չհրկիզվող պահարան' }, requiresMultilang: true,  sortOrder: 90 },
  { id: 'furniture_rack',         categoryId: 'furniture', name: { ru: 'Стеллаж',        en: 'Rack',             hy: 'Դարակաշար' },         requiresMultilang: true,  sortOrder: 100 },
  { id: 'furniture_whiteboard',   categoryId: 'furniture', name: { ru: 'Доска',          en: 'Whiteboard',       hy: 'Գրատախտակ' },         requiresMultilang: true,  sortOrder: 110 },

  // ----- Device (single-lang, English) -----
  { id: 'device_server',          categoryId: 'device',    name: 'Server',          requiresMultilang: false, sortOrder: 10 },
  { id: 'device_desktop',         categoryId: 'device',    name: 'Desktop',         requiresMultilang: false, sortOrder: 20 },
  { id: 'device_laptop',          categoryId: 'device',    name: 'Laptop',          requiresMultilang: false, sortOrder: 30 },
  { id: 'device_switch',          categoryId: 'device',    name: 'Switch',          requiresMultilang: false, sortOrder: 40 },
  { id: 'device_router',          categoryId: 'device',    name: 'Router',          requiresMultilang: false, sortOrder: 50 },
  { id: 'device_ip_phone',        categoryId: 'device',    name: 'IP Phone',        requiresMultilang: false, sortOrder: 60 },
  { id: 'device_mobile_phone',    categoryId: 'device',    name: 'Mobile Phone',    requiresMultilang: false, sortOrder: 70 },
  { id: 'device_tv',              categoryId: 'device',    name: 'TV',              requiresMultilang: false, sortOrder: 80 },
  { id: 'device_monitor',         categoryId: 'device',    name: 'Monitor',         requiresMultilang: false, sortOrder: 90 },
  { id: 'device_printer',         categoryId: 'device',    name: 'Printer',         requiresMultilang: false, sortOrder: 100 },
  { id: 'device_scanner',         categoryId: 'device',    name: 'Scanner',         requiresMultilang: false, sortOrder: 110 },
  { id: 'device_projector',       categoryId: 'device',    name: 'Projector',       requiresMultilang: false, sortOrder: 120 },
  { id: 'device_ups',             categoryId: 'device',    name: 'UPS',             requiresMultilang: false, sortOrder: 130 },
  { id: 'device_nas',             categoryId: 'device',    name: 'NAS',             requiresMultilang: false, sortOrder: 140 },
  { id: 'device_security_camera', categoryId: 'device',    name: 'Security Camera', requiresMultilang: false, sortOrder: 150 },
  { id: 'device_tablet',          categoryId: 'device',    name: 'Tablet',          requiresMultilang: false, sortOrder: 160 },
  { id: 'device_headset',         categoryId: 'device',    name: 'Headset',         requiresMultilang: false, sortOrder: 170 },
  { id: 'device_webcam',          categoryId: 'device',    name: 'Webcam',          requiresMultilang: false, sortOrder: 180 },
  { id: 'device_speaker',         categoryId: 'device',    name: 'Speaker',         requiresMultilang: false, sortOrder: 190 },
  { id: 'device_keyboard',        categoryId: 'device',    name: 'Keyboard',        requiresMultilang: false, sortOrder: 200 },
  { id: 'device_mouse',           categoryId: 'device',    name: 'Mouse',           requiresMultilang: false, sortOrder: 210 },
  { id: 'device_access_point',    categoryId: 'device',    name: 'Access Point',    requiresMultilang: false, sortOrder: 220 },
  { id: 'device_firewall',        categoryId: 'device',    name: 'Firewall',        requiresMultilang: false, sortOrder: 230 },

  // ----- License (single-lang) -----
  { id: 'license_windows',                categoryId: 'license', name: 'Windows OS',          requiresMultilang: false, attachableTo: 'device-only',          sortOrder: 10 },
  { id: 'license_office365',              categoryId: 'license', name: 'Office 365',          requiresMultilang: false, attachableTo: 'device-or-employee',  sortOrder: 20 },
  { id: 'license_adobe_photoshop',        categoryId: 'license', name: 'Adobe Photoshop',     requiresMultilang: false, attachableTo: 'device-or-employee',  sortOrder: 30 },
  { id: 'license_adobe_illustrator',      categoryId: 'license', name: 'Adobe Illustrator',   requiresMultilang: false, attachableTo: 'device-or-employee',  sortOrder: 40 },
  { id: 'license_adobe_acrobat',          categoryId: 'license', name: 'Adobe Acrobat',       requiresMultilang: false, attachableTo: 'device-or-employee',  sortOrder: 50 },
  { id: 'license_anydesk',                categoryId: 'license', name: 'AnyDesk',             requiresMultilang: false, attachableTo: 'device-or-employee',  sortOrder: 60 },
  { id: 'license_teamviewer',             categoryId: 'license', name: 'TeamViewer',          requiresMultilang: false, attachableTo: 'device-or-employee',  sortOrder: 70 },
  { id: 'license_kaspersky',              categoryId: 'license', name: 'Kaspersky Antivirus', requiresMultilang: false, attachableTo: 'device-or-employee',  sortOrder: 80 },
  { id: 'license_eset',                   categoryId: 'license', name: 'ESET Antivirus',      requiresMultilang: false, attachableTo: 'device-or-employee',  sortOrder: 90 },
  { id: 'license_bitdefender',            categoryId: 'license', name: 'Bitdefender Antivirus', requiresMultilang: false, attachableTo: 'device-or-employee', sortOrder: 100 },
  { id: 'license_visual_studio',          categoryId: 'license', name: 'Visual Studio',       requiresMultilang: false, attachableTo: 'device-or-employee',  sortOrder: 110 },
  { id: 'license_autocad',                categoryId: 'license', name: 'AutoCAD',             requiresMultilang: false, attachableTo: 'device-or-employee',  sortOrder: 120 },
  { id: 'license_zoom',                   categoryId: 'license', name: 'Zoom',                requiresMultilang: false, attachableTo: 'device-or-employee',  sortOrder: 130 },
  { id: 'license_slack',                  categoryId: 'license', name: 'Slack',               requiresMultilang: false, attachableTo: 'device-or-employee',  sortOrder: 140 },
];
```

Update the component body. Replace the existing `useEffect` body with this expanded version (preserves the existing behavior, adds the subtype seeding step):

```javascript
export default function StatusesAndCategoriesBootstrap() {
  const { user, role } = useAuth();
  const { data: statuses, loading: statusesLoading } = useAssetStatuses();
  const { data: categories, loading: categoriesLoading } = useCategories();
  const { all: subtypes, loading: subtypesLoading } = useAssetSubtypes({
    includeInactive: true,
  });
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    if (role !== ROLES.SUPER_ADMIN) return;
    if (!user) return;
    if (statusesLoading || categoriesLoading || subtypesLoading) return;

    const needStatuses = statuses.length === 0;
    const needCategories = categories.length === 0;
    const needSubtypes = subtypes.length === 0;
    if (!needStatuses && !needCategories && !needSubtypes) return;

    attempted.current = true;
    const actor = { uid: user.uid, role };

    void seedCatalogs({
      actor,
      needStatuses,
      needCategories,
      needSubtypes,
    }).catch((err) => {
      console.warn(
        '[AMS] catalogs bootstrap skipped:',
        err?.code ?? err?.message ?? err
      );
    });
  }, [
    user,
    role,
    statuses,
    categories,
    subtypes,
    statusesLoading,
    categoriesLoading,
    subtypesLoading,
  ]);

  return null;
}
```

Update `seedCatalogs()` to accept and handle `needSubtypes`. Append a new branch:

```javascript
async function seedCatalogs({ actor, needStatuses, needCategories, needSubtypes }) {
  if (needStatuses) {
    // ... existing block unchanged ...
  }

  if (needCategories) {
    // ... existing block unchanged ...
  }

  if (needSubtypes) {
    let added = 0;
    for (const seed of ASSET_SUBTYPE_SEEDS) {
      try {
        await firestoreAssetSubtypeRepository.create(
          {
            categoryId: seed.categoryId,
            name: seed.name,
            requiresMultilang: Boolean(seed.requiresMultilang),
            attachableTo: seed.attachableTo ?? null,
            sortOrder: seed.sortOrder ?? 0,
            isActive: true,
          },
          actor,
          { id: seed.id }
        );
        added += 1;
      } catch (err) {
        console.warn(
          `[AMS] asset_subtypes/${seed.id} bootstrap skipped:`,
          err?.code ?? err?.message ?? err
        );
      }
    }
    if (added > 0) {
      console.info(`[AMS] asset_subtypes bootstrap: ${added} created`);
    }
  }
}
```

- [ ] **Step 7.2: Smoke-run dependent tests**

Run: `npx vitest run src/test/firestoreAssetSubtypeRepository.test.js src/test/assets.test.js`
Expected: PASS.

- [ ] **Step 7.3: Lint**

Run: `npm run lint -- src/components/system/StatusesAndCategoriesBootstrap.jsx`
Expected: clean.

---

### Task 8: Persist new fields in `firestoreAssetRepository`

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/infra/repositories/firestoreAssetRepository.js`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/test/firestoreAssetRepository.test.js`

- [ ] **Step 8.1: Read the existing repository in full**

Read `C:/Users/DELL/Desktop/assets-crm/src/infra/repositories/firestoreAssetRepository.js` end-to-end. Note the `auditSnapshot()` helper, the `runTransaction` body in `createAsset`, and the patch path in `updateAsset`.

- [ ] **Step 8.2: Add tests**

Append to `src/test/firestoreAssetRepository.test.js`:

```javascript
describe('firestoreAssetRepository — subtype + condition + warranty + asset-target invariants', () => {
  it('persists subtypeId, condition, warrantyStart, warrantyEnd on create', async () => {
    // Use existing helpers in the file (txnReadDocs, writes, factory).
    // Pattern follows the existing "createAsset writes asset doc + audit row" test.
    // Assertions:
    //   - the asset write payload contains subtypeId, condition: 'new',
    //     warrantyStart: a Timestamp, warrantyEnd: a Timestamp.
    //   - the audit `after` snapshot mirrors the same fields.
  });

  it('coerces warranty fields to null when condition is used', async () => {
    // input: condition='used', warrantyStart=Date, warrantyEnd=Date
    // expect: warrantyStart and warrantyEnd written as null.
  });

  it('rejects employee assignment when subtype.attachableTo is device-only', async () => {
    // Pre-seed txnReadDocs with `asset_subtypes/license_windows` having attachableTo='device-only'.
    // Call createAsset with assignedTo: { kind: 'employee', id: 'emp-1' }.
    // Expect the promise to reject; expect no writes performed.
  });

  it('accepts asset-kind assignment for license + valid subtype', async () => {
    // Pre-seed txnReadDocs with `asset_subtypes/license_office365` having attachableTo='device-or-employee'.
    // Pre-seed `assets/asset-target` (the device the license attaches to).
    // Call createAsset with categoryId='license', assignedTo: { kind: 'asset', id: 'asset-target' }.
    // Expect the asset write payload to carry assignedTo.kind='asset' and assignedTo.id='asset-target'.
  });
});
```

(Replace the comment-only test bodies with concrete assertions modeled after the existing tests in the same file. Follow the existing fixture conventions exactly.)

- [ ] **Step 8.3: Apply repository edits**

In `firestoreAssetRepository.js`:

(a) Update `auditSnapshot()` to include the four new fields (alongside `categoryId`, `name`, `assignedTo`, etc.):

```javascript
function auditSnapshot(data) {
  return {
    inventoryCode: data.inventoryCode ?? '',
    categoryId: data.categoryId ?? '',
    subtypeId: data.subtypeId ?? '',
    statusId: data.statusId ?? '',
    name: data.name ?? null,
    brand: data.brand ?? null,
    model: data.model ?? null,
    serialNumber: data.serialNumber ?? null,
    branchId: data.branchId ?? null,
    assignedTo: data.assignedTo ?? null,
    notes: data.notes ?? null,
    purchaseDate: data.purchaseDate ?? null,
    purchasePrice: data.purchasePrice ?? null,
    condition: data.condition ?? 'new',
    warrantyStart: data.warrantyStart ?? null,
    warrantyEnd: data.warrantyEnd ?? null,
    isActive: data.isActive !== false,
  };
}
```

(b) In `createAsset`, before composing the `after` payload, validate the assignedTo invariant when applicable. Inside the `runTransaction()` callback, after sanitizing input and before `txn.set(assetRef, after)`:

```javascript
// Subtype validation — load and check attachableTo invariant for license subtypes.
const subtypeRef = doc(db, 'asset_subtypes', sanitized.subtypeId);
const subtypeSnap = await txn.get(subtypeRef);
if (!subtypeSnap.exists?.() || subtypeSnap.data().isActive === false) {
  throw new AssetSubtypeInactiveError(sanitized.subtypeId);
}
const subtype = subtypeSnap.data();

// Re-run domain validator with the loaded subtype context.
const formErrors = validateAssetInput(sanitized, {
  category,
  subtype: { attachableTo: subtype.attachableTo ?? null },
});
if (Object.keys(formErrors).length > 0) {
  // Surface as a generic invariant error — the form should have caught this.
  throw new Error(`asset/invariant: ${JSON.stringify(formErrors)}`);
}
```

Add the import:

```javascript
import { AssetSubtypeInactiveError } from '@/domain/assetSubtypes.js';
```

(c) In the `after` payload composition, add:

```javascript
subtypeId: sanitized.subtypeId,
condition: sanitized.condition,
warrantyStart: sanitized.warrantyStart
  ? Timestamp.fromDate(sanitized.warrantyStart)
  : null,
warrantyEnd: sanitized.warrantyEnd
  ? Timestamp.fromDate(sanitized.warrantyEnd)
  : null,
```

(d) Mirror in `updateAsset` (add the four fields to the patch shape, run the same subtype-loading invariant check when `subtypeId` is in the patch or when `assignedTo` changes).

- [ ] **Step 8.4: Run repository tests**

Run: `npx vitest run src/test/firestoreAssetRepository.test.js`
Expected: PASS.

- [ ] **Step 8.5: Lint**

Run: `npm run lint -- src/infra/repositories/firestoreAssetRepository.js src/test/firestoreAssetRepository.test.js`
Expected: clean.

---

### Task 9: i18n keys for ru/en/hy

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/ru/assets.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/en/assets.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/hy/assets.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/test/assetsLocale.step3.test.js`

- [ ] **Step 9.1: Identify the new key set**

Add the following keys to all three locale files (values shown for ru/en/hy respectively in each step). They split into seven groups:

1. **Subtype select chrome:** `subtype` (label), `subtypePlaceholder` (placeholder).
2. **Condition radio:** `condition` (label), `conditionNew`, `conditionUsed`.
3. **Warranty fields:** `warrantyPeriod` (group label), `warrantyStart`, `warrantyEnd`, `warrantyHint` (e.g. "Optional. Fill if the item is under warranty."), `warrantyBanner` (e.g. "Warranty: {{start}} → {{end}}"), `warrantyRemainingDays` ("({{days}} days remaining)"), `warrantyExpired` ("(expired)").
4. **Holder kind for `asset`:** `holderAsset`, `holderShortAsset` ("Asset: {{name}}"), `assetTargetPlaceholder` ("Pick a device").
5. **Subtype admin & header chrome:** `subtypeIdHeader` (Excel column row-2 label).
6. **License device-only hint:** `licenseDeviceOnlyHint` (e.g. "This license can only be attached to a device.").
7. **Validation error keys:** `errorWarrantyEndBeforeStart`, `errorLicenseDeviceOnly`, `errorAssetTargetNotLicense`, `errorAttachableOnlyForLicense`, `errorImportSubtypeRequired`, `errorImportSubtypeUnknown`, `errorImportConditionInvalid`, `errorImportWarrantyDate`, `errorImportLicenseDeviceOnly`.

- [ ] **Step 9.2: Edit `src/locales/ru/assets.json`**

Append (preserving JSON validity — close the existing object's last property with a trailing comma when needed):

```json
{
  "subtype": "Подтип",
  "subtypePlaceholder": "Выберите подтип",
  "subtypeIdHeader": "ID подтипа",
  "condition": "Состояние",
  "conditionNew": "Новый",
  "conditionUsed": "Б/у",
  "warrantyPeriod": "Гарантийный период",
  "warrantyStart": "Гарантия с",
  "warrantyEnd": "Гарантия до",
  "warrantyHint": "Необязательно. Заполните, если на товар есть гарантия.",
  "warrantyBanner": "Гарантия: {{start}} → {{end}}",
  "warrantyRemainingDays": "(осталось {{days}} дн.)",
  "warrantyExpired": "(истекла)",
  "holderAsset": "Устройство",
  "holderShortAsset": "Устройство: {{name}}",
  "assetTargetPlaceholder": "Выберите устройство",
  "licenseDeviceOnlyHint": "Эту лицензию можно привязать только к устройству.",
  "errorWarrantyEndBeforeStart": "Дата окончания гарантии раньше даты начала",
  "errorLicenseDeviceOnly": "Эту лицензию нельзя привязать к сотруднику — только к устройству",
  "errorAssetTargetNotLicense": "Привязка к устройству доступна только для лицензий",
  "errorAttachableOnlyForLicense": "Поле «Куда привязывается» допустимо только для категории «Лицензия»",
  "errorImportSubtypeRequired": "Подтип обязателен",
  "errorImportSubtypeUnknown": "Подтип не найден или неактивен",
  "errorImportConditionInvalid": "Состояние должно быть 'new' или 'used'",
  "errorImportWarrantyDate": "Неверная дата гарантии",
  "errorImportLicenseDeviceOnly": "Эта лицензия не может быть привязана к сотруднику"
}
```

- [ ] **Step 9.3: Edit `src/locales/en/assets.json`**

```json
{
  "subtype": "Sub-type",
  "subtypePlaceholder": "Select sub-type",
  "subtypeIdHeader": "Sub-type id",
  "condition": "Condition",
  "conditionNew": "New",
  "conditionUsed": "Used",
  "warrantyPeriod": "Warranty period",
  "warrantyStart": "Warranty from",
  "warrantyEnd": "Warranty until",
  "warrantyHint": "Optional. Fill in if the item has warranty.",
  "warrantyBanner": "Warranty: {{start}} → {{end}}",
  "warrantyRemainingDays": "({{days}} days remaining)",
  "warrantyExpired": "(expired)",
  "holderAsset": "Device",
  "holderShortAsset": "Device: {{name}}",
  "assetTargetPlaceholder": "Select a device",
  "licenseDeviceOnlyHint": "This license can only be attached to a device.",
  "errorWarrantyEndBeforeStart": "Warranty end date is before start date",
  "errorLicenseDeviceOnly": "This license cannot be attached to an employee — device only",
  "errorAssetTargetNotLicense": "Attaching to a device is only allowed for licenses",
  "errorAttachableOnlyForLicense": "'Attachable to' is only valid for the License category",
  "errorImportSubtypeRequired": "Sub-type is required",
  "errorImportSubtypeUnknown": "Sub-type not found or inactive",
  "errorImportConditionInvalid": "Condition must be 'new' or 'used'",
  "errorImportWarrantyDate": "Invalid warranty date",
  "errorImportLicenseDeviceOnly": "This license cannot be attached to an employee"
}
```

- [ ] **Step 9.4: Edit `src/locales/hy/assets.json`**

```json
{
  "subtype": "Ենթատեսակ",
  "subtypePlaceholder": "Ընտրեք ենթատեսակ",
  "subtypeIdHeader": "Ենթատեսակի ID",
  "condition": "Վիճակ",
  "conditionNew": "Նոր",
  "conditionUsed": "Օգտագործված",
  "warrantyPeriod": "Երաշխիքային ժամկետ",
  "warrantyStart": "Երաշխիքը՝",
  "warrantyEnd": "Երաշխիքը մինչև",
  "warrantyHint": "Կամընտրական։ Լրացրեք, եթե իրը երաշխիքով է։",
  "warrantyBanner": "Երաշխիք՝ {{start}} → {{end}}",
  "warrantyRemainingDays": "(մնացել է {{days}} օր)",
  "warrantyExpired": "(ժամկետանց)",
  "holderAsset": "Սարք",
  "holderShortAsset": "Սարք՝ {{name}}",
  "assetTargetPlaceholder": "Ընտրեք սարք",
  "licenseDeviceOnlyHint": "Այս լիցենզիան կարող է կցվել միայն սարքի։",
  "errorWarrantyEndBeforeStart": "Երաշխիքի ավարտի ամսաթիվը նախորդում է սկզբի ամսաթվին",
  "errorLicenseDeviceOnly": "Այս լիցենզիան չի կարող կցվել աշխատակցի — միայն սարքի",
  "errorAssetTargetNotLicense": "Սարքին կցումը հասանելի է միայն լիցենզիաների համար",
  "errorAttachableOnlyForLicense": "«Որտեղ կցվում է» դաշտը հասանելի է միայն «Լիցենզիա» կատեգորիայի համար",
  "errorImportSubtypeRequired": "Ենթատեսակը պարտադիր է",
  "errorImportSubtypeUnknown": "Ենթատեսակը չի գտնվել կամ ապաակտիվ է",
  "errorImportConditionInvalid": "Վիճակը պետք է լինի 'new' կամ 'used'",
  "errorImportWarrantyDate": "Անվավեր երաշխիքային ամսաթիվ",
  "errorImportLicenseDeviceOnly": "Այս լիցենզիան չի կարող կցվել աշխատակցի"
}
```

- [ ] **Step 9.5: Update `src/test/assetsLocale.step3.test.js`**

Append a new `describe` block listing all the new keys; assert each key resolves in `ru`, `en`, `hy`. Pattern:

```javascript
describe('locale parity — subtype, condition, warranty, asset-kind', () => {
  const keys = [
    'subtype', 'subtypePlaceholder', 'subtypeIdHeader',
    'condition', 'conditionNew', 'conditionUsed',
    'warrantyPeriod', 'warrantyStart', 'warrantyEnd',
    'warrantyHint', 'warrantyBanner', 'warrantyRemainingDays', 'warrantyExpired',
    'holderAsset', 'holderShortAsset', 'assetTargetPlaceholder',
    'licenseDeviceOnlyHint',
    'errorWarrantyEndBeforeStart', 'errorLicenseDeviceOnly',
    'errorAssetTargetNotLicense', 'errorAttachableOnlyForLicense',
    'errorImportSubtypeRequired', 'errorImportSubtypeUnknown',
    'errorImportConditionInvalid', 'errorImportWarrantyDate',
    'errorImportLicenseDeviceOnly',
  ];
  for (const k of keys) {
    it(`'${k}' is present in ru`, () => { expect(ruAssets[k]).toBeTypeOf('string'); });
    it(`'${k}' is present in en`, () => { expect(enAssets[k]).toBeTypeOf('string'); });
    it(`'${k}' is present in hy`, () => { expect(hyAssets[k]).toBeTypeOf('string'); });
  }
});
```

(Use the same import names already at the top of `assetsLocale.step3.test.js`.)

- [ ] **Step 9.6: Run locale tests**

Run: `npx vitest run src/test/assetsLocale.step3.test.js`
Expected: PASS.

- [ ] **Step 9.7: Validate JSON**

Run: `node -e "['ru','en','hy'].forEach(l => JSON.parse(require('fs').readFileSync('src/locales/'+l+'/assets.json','utf8')))"`
Expected: no output, exit code 0.

---

### Task 10: Redesign `AssetFormDialog`

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/AssetFormDialog.jsx`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/test/AssetFormDialog.test.jsx`

This is the largest UI change. Read the current component end-to-end before editing.

- [ ] **Step 10.1: Read the current dialog and tests in full**

Read `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/AssetFormDialog.jsx` and `C:/Users/DELL/Desktop/assets-crm/src/test/AssetFormDialog.test.jsx` end-to-end.

- [ ] **Step 10.2: Append failing tests**

Add to `src/test/AssetFormDialog.test.jsx` a new `describe('AssetFormDialog — subtype/condition/warranty/license-asset')` block with these cases:

1. Renders empty subtype select before category is picked, disabled.
2. After picking category=device, subtype select is enabled and lists only device sub-types from the mocked `useAssetSubtypes` hook.
3. Submitting without picking a subtype shows `errorRequired` next to the subtype field.
4. Default condition is "new" (selected radio).
5. Switching condition to "used" hides the warranty inputs.
6. With condition="new", entering warrantyEnd earlier than warrantyStart shows `errorWarrantyEndBeforeStart` next to the warrantyEnd input.
7. With category=license + subtype=license_windows (mock attachableTo='device-only'), the "Куда" radio for "Сотрудник" is disabled and shows `licenseDeviceOnlyHint`.
8. With category=license + subtype=license_office365 (mock attachableTo='device-or-employee'), all of warehouse/employee/asset radios are enabled; branch and department are NOT visible.
9. With category=device or category=furniture, the "asset" radio is NOT visible.

Use the existing test fixtures and `vi.mock('@/hooks/useAssetSubtypes.js', ...)` to feed the test catalog.

- [ ] **Step 10.3: Refactor the form layout**

Edit `AssetFormDialog.jsx`. Section ordering (top to bottom) becomes:

1. **Категория** (existing select).
2. **Подтип** (new select, filtered by category, disabled until category picked, shows ru/en/hy resolved label).
3. **Название** (existing — single string OR multi-lang per category convention).
4. **Brand / Model / Serial number** (existing).
5. **Куда** (radio set, but options now depend on category + subtype):
   - If `categoryId === 'license'`:
     - `warehouse` always enabled.
     - `employee` enabled iff `subtype.attachableTo === 'device-or-employee'`. Disabled with hint when `'device-only'`.
     - `asset` always enabled — renders `<AssetSelect>` to pick an active device.
     - **No** branch, no department for licenses.
   - Else (device, furniture):
     - `warehouse`, `employee`, `branch`, `department` (existing behavior).
6. **Status** (existing).
7. **Состояние** (radio: New / Used). Default: New.
8. **Гарантийный период** (group, only visible when condition === 'new'):
   - `warrantyStart` (date input).
   - `warrantyEnd` (date input).
9. **Дополнительно** (existing — purchaseDate, purchasePrice, notes).

Wire state:

- Add `subtypeId`, `condition`, `warrantyStart`, `warrantyEnd` to the form state via `setForm`.
- Use `useAssetSubtypes({ categoryId: form.categoryId })` to drive the subtype select options.
- When condition is set to `'used'`, immediately clear warranty fields (in the same `setForm` call).
- When category changes, clear `subtypeId` (it's category-scoped).
- When subtype changes for a license to `device-only`, force `assignedTo.kind` to whatever non-employee kind is currently selected; if employee was selected, fall back to warehouse.
- Pass `subtype` (the full chosen subtype doc) into `validateAssetInput()` opts so the device-only invariant fires inline.

For the "asset" radio, render `<AssetSelect onChange={(id) => setForm(...)} value={form.assignedTo?.id ?? ''} />` from Task 11.

- [ ] **Step 10.4: Run AssetFormDialog tests**

Run: `npx vitest run src/test/AssetFormDialog.test.jsx`
Expected: PASS.

- [ ] **Step 10.5: Lint**

Run: `npm run lint -- src/components/features/assets/AssetFormDialog.jsx src/test/AssetFormDialog.test.jsx`
Expected: clean.

---

### Task 11: `AssetSelect` component

**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/AssetSelect.jsx`

- [ ] **Step 11.1: Implement the picker**

Create `src/components/features/assets/AssetSelect.jsx`:

```javascript
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAssets } from '@/hooks/useAssets.js';
import { useCategories } from '@/hooks/useCategories.js';
import { nameForDisplay } from '@/domain/assets.js';
import { localize } from '@/lib/localize.js';

/**
 * Single-asset picker, scoped to active devices (categoryId === 'device'
 * by default). Used by AssetFormDialog when assigning a license to a
 * device, and by AssignDialog for the "asset" target kind.
 *
 * @param {{
 *   value: string,
 *   onChange: (assetId: string) => void,
 *   excludeAssetId?: string,
 *   restrictToCategoryIds?: string[],
 *   disabled?: boolean,
 *   placeholder?: string,
 * }} props
 */
export default function AssetSelect({
  value,
  onChange,
  excludeAssetId = '',
  restrictToCategoryIds = ['device'],
  disabled = false,
  placeholder,
}) {
  const { t, i18n } = useTranslation('assets');
  const { data: assets } = useAssets();
  const { data: categories } = useCategories();

  const options = useMemo(() => {
    return assets
      .filter((a) => a.isActive !== false)
      .filter((a) => restrictToCategoryIds.includes(a.categoryId))
      .filter((a) => a.assetId !== excludeAssetId);
  }, [assets, restrictToCategoryIds, excludeAssetId]);

  const categoryById = useMemo(() => {
    const m = new Map();
    for (const c of categories) m.set(c.categoryId, c);
    return m;
  }, [categories]);

  return (
    <select
      className="w-full rounded-md border px-3 py-2"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">{placeholder ?? t('assetTargetPlaceholder')}</option>
      {options.map((a) => {
        const cat = categoryById.get(a.categoryId);
        const catName = cat ? localize(cat.name, i18n.language) : a.categoryId;
        const display = nameForDisplay(a, i18n.language) || a.inventoryCode;
        return (
          <option key={a.assetId} value={a.assetId}>
            {`${a.inventoryCode} — ${display} (${catName})`}
          </option>
        );
      })}
    </select>
  );
}
```

- [ ] **Step 11.2: Lint**

Run: `npm run lint -- src/components/features/assets/AssetSelect.jsx`
Expected: clean.

---

### Task 12: `AssignDialog` — accept `asset` target kind

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/components/features/assignments/AssignDialog.jsx`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/test/AssignDialog.test.jsx`

- [ ] **Step 12.1: Read both files end-to-end**

Read `src/components/features/assignments/AssignDialog.jsx` and `src/test/AssignDialog.test.jsx` in full.

- [ ] **Step 12.2: Append failing tests**

Append to `src/test/AssignDialog.test.jsx`:

```javascript
describe('AssignDialog — license-asset target', () => {
  it('shows warehouse/employee/asset target kinds when source asset categoryId === license', () => {
    // Render with sourceAsset = { categoryId: 'license', subtypeId: 'license_office365', ... }
    // Mock useAssetSubtypes to return that subtype with attachableTo='device-or-employee'.
    // Expect warehouse, employee, asset radios visible. branch and department NOT visible.
  });

  it('disables employee target when subtype.attachableTo === device-only', () => {
    // sourceAsset = license_windows; subtype.attachableTo = 'device-only'
    // Expect employee radio disabled with licenseDeviceOnlyHint.
  });

  it('renders AssetSelect when asset kind is chosen', () => {
    // Click the asset radio; expect AssetSelect to be visible.
  });

  it('does NOT show asset target for non-license categories', () => {
    // sourceAsset = device — expect no asset radio.
  });
});
```

- [ ] **Step 12.3: Patch the dialog**

In `AssignDialog.jsx`:

(a) Replace the static `targetKinds` array with a function that derives the list from the source asset's category + subtype:

```javascript
function deriveTargetKinds(sourceAsset, subtype) {
  if (!sourceAsset) return ['warehouse'];
  if (sourceAsset.categoryId === 'license') {
    const kinds = ['warehouse', 'asset'];
    if (subtype?.attachableTo === 'device-or-employee') {
      kinds.splice(1, 0, 'employee');
    }
    return kinds;
  }
  // Device, furniture, and any other category default to existing behavior.
  return ['warehouse', 'employee', 'branch', 'department'];
}
```

Look up the subtype via `useAssetSubtypes({ categoryId: sourceAsset?.categoryId })` and find by `subtypeId`.

(b) When the user picks `kind === 'asset'`, render `<AssetSelect>` (from Task 11) with `excludeAssetId={sourceAsset.assetId}` and `restrictToCategoryIds={['device']}`.

(c) For the employee radio when disabled (device-only license), show the `licenseDeviceOnlyHint` text below it.

- [ ] **Step 12.4: Run AssignDialog tests**

Run: `npx vitest run src/test/AssignDialog.test.jsx`
Expected: PASS.

- [ ] **Step 12.5: Lint**

Run: `npm run lint -- src/components/features/assignments/AssignDialog.jsx src/test/AssignDialog.test.jsx`
Expected: clean.

---

### Task 13: `AssetDetailPage` — subtype label, condition badge, warranty banner, asset-holder link

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/pages/AssetDetailPage.jsx`

- [ ] **Step 13.1: Read the current page**

Read `src/pages/AssetDetailPage.jsx` end-to-end.

- [ ] **Step 13.2: Apply edits**

Inside the page component:

(a) Use `useAssetSubtypes({ categoryId: asset?.categoryId })` to look up the subtype.

(b) Extend the displayed details block to include:
- Subtype name (resolved via `localize(subtype.name, i18n.language)`).
- Condition badge: `t('conditionNew')` or `t('conditionUsed')` styled in green/gray accordingly.
- Warranty banner (only when condition === 'new' and at least one of warrantyStart/warrantyEnd is set):

```javascript
function WarrantyBanner({ asset, t, locale }) {
  if (asset.condition !== 'new') return null;
  const start = asset.warrantyStart?.toDate ? asset.warrantyStart.toDate() : null;
  const end = asset.warrantyEnd?.toDate ? asset.warrantyEnd.toDate() : null;
  if (!start && !end) return null;

  const fmt = (d) =>
    d
      ? d.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' })
      : '—';
  const today = new Date();
  let suffix = '';
  if (end) {
    const msPerDay = 86400000;
    const days = Math.ceil((end.valueOf() - today.valueOf()) / msPerDay);
    if (days < 0) {
      suffix = ` ${t('warrantyExpired')}`;
    } else {
      suffix = ` ${t('warrantyRemainingDays', { days })}`;
    }
  }

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
      {t('warrantyBanner', { start: fmt(start), end: fmt(end) })}
      {suffix}
    </div>
  );
}
```

(c) Extend the holder row's switch to handle `kind === 'asset'`:

```javascript
case 'asset': {
  const target = assetsById.get(at.id);
  const code = target?.inventoryCode ?? at.id;
  return (
    <Link className="underline" to={`/assets/${at.id}`}>
      {t('holderShortAsset', { name: code })}
    </Link>
  );
}
```

The page already loads other assets via `useAssets()` — reuse that data via a `Map<assetId, Asset>` memoized lookup.

- [ ] **Step 13.3: Lint**

Run: `npm run lint -- src/pages/AssetDetailPage.jsx`
Expected: clean.

---

### Task 14: Excel I/O — columns, import, export

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/lib/excel/columns.js`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/lib/excel/assetImportService.js`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/lib/excel/assetExportService.js`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/test/columns.test.js`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/test/assetImportService.test.js`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/test/assetExportService.test.js`

- [ ] **Step 14.1: Edit `columns.js`**

Replace the `COLUMN_KEYS` array with this exact ordering (new fields appended just before `createdAt`, alongside related fields):

```javascript
export const COLUMN_KEYS = Object.freeze([
  'inventoryCode',
  'categoryId',
  'categoryName',
  'subtypeId',
  'nameRu',
  'nameEn',
  'nameHy',
  'brand',
  'model',
  'serialNumber',
  'statusId',
  'assignedToKind',
  'assignedToId',
  'holderName',
  'branchId',
  'condition',
  'warrantyStart',
  'warrantyEnd',
  'notes',
  'purchaseDate',
  'purchasePrice',
  'createdAt',
]);
```

Add to `COLUMN_LABEL_KEYS`:

```javascript
subtypeId: 'subtypeIdHeader',
condition: 'condition',
warrantyStart: 'warrantyStart',
warrantyEnd: 'warrantyEnd',
```

`INFO_ONLY_HEADERS` stays unchanged.

- [ ] **Step 14.2: Update `assetImportService.js`**

Read it end-to-end first. Add to `validateRow()`:

- Validate `subtypeId`: must match one of the active subtypes for the row's `categoryId`. Error: `errorImportSubtypeRequired` (empty), `errorImportSubtypeUnknown` (unknown id or wrong category or inactive).
- Validate `condition`: must equal `'new'` or `'used'`. Error: `errorImportConditionInvalid`. Default to `'new'` if blank.
- Validate `warrantyStart` and `warrantyEnd`: parse as ISO date if non-empty. Error: `errorImportWarrantyDate`. If end < start, also report end error.
- Cross-validate license-windows-style rows: when `subtypeId` resolves to a subtype with `attachableTo === 'device-only'`, reject `assignedToKind === 'employee'` with `errorImportLicenseDeviceOnly`.

Add `subtypes` to the validator's input data alongside `categories`. The caller (the dialog) is already passing the catalogs; thread `subtypes` through.

In the `normalized` object returned for green rows, include:
- `subtypeId: parsedSubtypeId`
- `condition: parsedCondition`
- `warrantyStart: parsedDateStartOrNull`
- `warrantyEnd: parsedDateEndOrNull`

- [ ] **Step 14.3: Update `assetExportService.js`**

In `rowsToWorkbook()` (or the equivalent column emit switch), add cases:

```javascript
case 'subtypeId': return asset.subtypeId ?? '';
case 'condition': return asset.condition ?? 'new';
case 'warrantyStart': return isoDateUTC(asset.warrantyStart);
case 'warrantyEnd':   return isoDateUTC(asset.warrantyEnd);
```

(Reuse existing `isoDateUTC()` helper that handles Firestore Timestamps.)

- [ ] **Step 14.4: Update `columns.test.js`**

Append:

```javascript
it('includes subtypeId, condition, warrantyStart, warrantyEnd', () => {
  expect(COLUMN_KEYS).toContain('subtypeId');
  expect(COLUMN_KEYS).toContain('condition');
  expect(COLUMN_KEYS).toContain('warrantyStart');
  expect(COLUMN_KEYS).toContain('warrantyEnd');
});

it('places subtypeId after categoryName and before nameRu', () => {
  const i = (k) => COLUMN_KEYS.indexOf(k);
  expect(i('subtypeId')).toBeGreaterThan(i('categoryName'));
  expect(i('subtypeId')).toBeLessThan(i('nameRu'));
});

it('places warranty fields after condition and before notes', () => {
  const i = (k) => COLUMN_KEYS.indexOf(k);
  expect(i('warrantyStart')).toBeGreaterThan(i('condition'));
  expect(i('warrantyEnd')).toBeGreaterThan(i('warrantyStart'));
  expect(i('warrantyEnd')).toBeLessThan(i('notes'));
});

it('maps new column label keys', () => {
  expect(COLUMN_LABEL_KEYS.subtypeId).toBe('subtypeIdHeader');
  expect(COLUMN_LABEL_KEYS.condition).toBe('condition');
  expect(COLUMN_LABEL_KEYS.warrantyStart).toBe('warrantyStart');
  expect(COLUMN_LABEL_KEYS.warrantyEnd).toBe('warrantyEnd');
});
```

- [ ] **Step 14.5: Update `assetImportService.test.js`**

Add cases for each new validator path. Pattern:

```javascript
it('rejects rows missing subtypeId', () => { /* ... */ });
it('rejects rows whose subtypeId belongs to a different category', () => { /* ... */ });
it('defaults condition to "new" when blank', () => { /* ... */ });
it('rejects unknown condition strings', () => { /* ... */ });
it('parses warrantyStart and warrantyEnd as Dates', () => { /* ... */ });
it('reports errorWarrantyEndBeforeStart when end < start', () => { /* ... */ });
it('rejects employee assignedToKind for windows-license rows', () => { /* ... */ });
```

- [ ] **Step 14.6: Update `assetExportService.test.js`**

Add cases:

```javascript
it('emits subtypeId, condition, warrantyStart, warrantyEnd in row', () => { /* ... */ });
it('emits empty cells for unset warranty fields', () => { /* ... */ });
```

- [ ] **Step 14.7: Run Excel test files**

Run: `npx vitest run src/test/columns.test.js src/test/assetImportService.test.js src/test/assetExportService.test.js`
Expected: PASS.

- [ ] **Step 14.8: Lint**

Run: `npm run lint -- src/lib/excel/columns.js src/lib/excel/assetImportService.js src/lib/excel/assetExportService.js src/test/columns.test.js src/test/assetImportService.test.js src/test/assetExportService.test.js`
Expected: clean.

---

### Task 15: Final verification

- [ ] **Step 15.1: Lint**

Run: `npm run lint`
Expected: clean. 0 errors, 0 warnings.

- [ ] **Step 15.2: Full test suite**

Run: `npx vitest run`
Expected: all tests PASS. Capture the final summary line for the report.

- [ ] **Step 15.3: Build**

Run: `npm run build`
Expected: succeeds. Capture the last 10 lines for the report.

- [ ] **Step 15.4: Git status snapshot (READ-ONLY)**

Run: `git status` (read-only — do NOT commit, do NOT add).
Capture the file list to include in the final report.

---

## Reviewer Cycle (after Task 15 passes)

Run all three reviewers in sequence per the orchestrator workflow §5. Re-dispatch on FAIL.

1. **spec-reviewer** — does the code match the plan + the locked architectural decisions?
2. **code-quality-reviewer** — React + Firebase + audit-helper + repository-pattern + i18n hygiene.
3. **security-reviewer** — Firestore rules, audit-log immutability, role gating, secrets, input validation, attachableTo invariant enforcement.

If ANY reviewer FAILs:
- Identify the implementer responsible (domain/firebase/react-ui/i18n).
- Re-dispatch that implementer with the FAIL report verbatim.
- Re-run `test-engineer` after the fix.
- Re-run the failed reviewer.
- Loop until PASS.

---

## Final Report Template (delivery)

After verification + reviewers all green, deliver this report inline:

```
DONE: AMS — Asset Sub-types, Condition, and Warranty redesign

Files created (absolute paths):
  - C:/Users/DELL/Desktop/assets-crm/src/domain/assetSubtypes.js
  - C:/Users/DELL/Desktop/assets-crm/src/domain/repositories/AssetSubtypeRepository.js
  - C:/Users/DELL/Desktop/assets-crm/src/infra/repositories/firestoreAssetSubtypeRepository.js
  - C:/Users/DELL/Desktop/assets-crm/src/hooks/useAssetSubtypes.js
  - C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/AssetSelect.jsx
  - C:/Users/DELL/Desktop/assets-crm/src/test/assetSubtypes.test.js
  - C:/Users/DELL/Desktop/assets-crm/src/test/firestoreAssetSubtypeRepository.test.js
  - C:/Users/DELL/Desktop/assets-crm/src/test/assetSubtypes.rulesMirror.test.js

Files modified (absolute paths):
  - C:/Users/DELL/Desktop/assets-crm/src/domain/assets.js
  - C:/Users/DELL/Desktop/assets-crm/src/lib/audit/auditHelper.js
  - C:/Users/DELL/Desktop/assets-crm/firestore.rules
  - C:/Users/DELL/Desktop/assets-crm/src/infra/repositories/firestoreAssetRepository.js
  - C:/Users/DELL/Desktop/assets-crm/src/components/system/StatusesAndCategoriesBootstrap.jsx
  - C:/Users/DELL/Desktop/assets-crm/src/components/features/assets/AssetFormDialog.jsx
  - C:/Users/DELL/Desktop/assets-crm/src/components/features/assignments/AssignDialog.jsx
  - C:/Users/DELL/Desktop/assets-crm/src/pages/AssetDetailPage.jsx
  - C:/Users/DELL/Desktop/assets-crm/src/lib/excel/columns.js
  - C:/Users/DELL/Desktop/assets-crm/src/lib/excel/assetImportService.js
  - C:/Users/DELL/Desktop/assets-crm/src/lib/excel/assetExportService.js
  - C:/Users/DELL/Desktop/assets-crm/src/locales/ru/assets.json
  - C:/Users/DELL/Desktop/assets-crm/src/locales/en/assets.json
  - C:/Users/DELL/Desktop/assets-crm/src/locales/hy/assets.json
  - C:/Users/DELL/Desktop/assets-crm/src/test/assets.test.js
  - C:/Users/DELL/Desktop/assets-crm/src/test/assets.rulesMirror.test.js
  - C:/Users/DELL/Desktop/assets-crm/src/test/firestoreAssetRepository.test.js
  - C:/Users/DELL/Desktop/assets-crm/src/test/AssetFormDialog.test.jsx
  - C:/Users/DELL/Desktop/assets-crm/src/test/AssignDialog.test.jsx
  - C:/Users/DELL/Desktop/assets-crm/src/test/columns.test.js
  - C:/Users/DELL/Desktop/assets-crm/src/test/assetImportService.test.js
  - C:/Users/DELL/Desktop/assets-crm/src/test/assetExportService.test.js
  - C:/Users/DELL/Desktop/assets-crm/src/test/assetsLocale.step3.test.js

Test count delta: <BEFORE> → <AFTER> (Δ +<N>)
Lint:   PASS / 0 warnings
Tests:  PASS — <last 5 lines of vitest output>
Build:  PASS — <last 10 lines of npm run build output>

Reviewers:
  spec-reviewer:         PASS
  code-quality-reviewer: PASS
  security-reviewer:     PASS

Deploy needed (single command, do NOT run it for me):
  npx firebase deploy --only firestore:rules

Unresolved decisions / follow-ups:
  - <list anything punted>
```

---

## Self-Review Notes

Spec coverage:
- [x] Per-category sub-type select (Task 1, 2, 5, 7, 10).
- [x] License `attachableTo` enforcement at UI + domain + invariant in repo (Task 1, 2, 8, 10, 12).
- [x] `ASSIGNMENT_KINDS.ASSET` end-to-end (Task 2, 6, 11, 12, 13).
- [x] Condition + warranty fields with conditional UI and validation (Task 2, 8, 10, 13).
- [x] Excel I/O for new fields (Task 14).
- [x] Locale parity (Task 9).
- [x] Audit invariant preserved (Task 3, 4, 8).
- [x] Firestore rules + mirror tests (Task 6).
- [x] No git/deploy operations (top of plan, repeated in Task 15).

Placeholder scan: no TBDs, all code blocks complete, all error keys defined in Task 9.

Type consistency:
- `subtypeId` (string) — used identically in domain, rules, repo, UI, Excel.
- `attachableTo` enum — same three values everywhere.
- `condition` — `'new' | 'used'` everywhere.
- Warranty: `Date | null` in domain forms, Firestore `Timestamp | null` in persistence; `Timestamp.fromDate` conversion in repo.

If executing in subagent-driven mode (recommended), each Task above is a single subagent dispatch with the plan-section text as the brief.
