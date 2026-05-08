# Configurable Asset Holder Rules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-08-configurable-asset-holder-rules-design.md`

**Goal:** Replace the legacy `attachableTo` enum on asset sub-types with a configurable, per-category-and-per-sub-type array of allowed holder kinds (Branch / Warehouse / Employee / Department / Asset), and surface the rule in the catalog UI plus the asset-create form.

**Architecture:** The asset domain already supports five `assignedTo.kind` values via `ASSIGNMENT_KINDS`. We add `attachableTo: string[]` to both `Category` and `AssetSubtype`, default sub-types from their parent category, gate the asset-create kind-picker through the sub-type's array, and migrate existing docs idempotently inside the existing super-admin bootstrap pass.

**Tech Stack:** React 19, Firestore (modular SDK), JSDoc typedefs, vitest + @testing-library/react, react-i18next, shadcn/ui primitives.

**Note on commits:** Per the user's standing instruction, **do not run `git add/commit/push`** during execution. Stage logical groups; the user runs commits when ready.

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/domain/categories.js` | Add `attachableTo` to typedefs, sanitizer, validator. |
| `src/domain/assetSubtypes.js` | Reshape `attachableTo` from enum → array; add subset-of-category check; drop `ATTACHABLE_TO`/`ATTACHABLE_TO_LIST`/`ATTACHABLE_TO_CATEGORY_IDS`. |
| `src/domain/assets.js` | `validateAssetInput`: switch from `subtype.attachableTo === 'device-only'` to `subtype.attachableTo.includes(at.kind)`. |
| `src/components/system/StatusesAndCategoriesBootstrap.jsx` | Seed `attachableTo` on `CATEGORY_SEEDS` and `ASSET_SUBTYPE_SEEDS`. |
| `scripts/seed.js` | Mirror `attachableTo` defaults on `CATEGORY_SEEDS`. |
| `src/components/system/MultilangNamesMigration.jsx` | Extend with a second pass that upgrades existing docs to the new shape. Rename to `CatalogShapeMigration` for clarity. Update import in `AppShell`. |
| `src/components/features/categories/CategoryFormDialog.jsx` | Add fieldset «Привязка по умолчанию» — 5 checkboxes; pre-fill from doc/defaults. |
| `src/components/features/assets/SubtypeFormDialog.jsx` | Add fieldset «Разрешённые цели привязки» — 5 checkboxes; pre-fill from parent category; subset-only validation. Drop the legacy `attachableTo` `<select>`. |
| `src/components/features/assets/AssetFormDialog.jsx` | Filter the `assignedTo.kind` picker through `subtype.attachableTo`; auto-select when length === 1. |
| `firestore.rules` | Validate `attachableTo` is a list of allowed strings, length ≥ 1, on both collections. |
| `src/locales/{ru,en,hy}/categories.json` | New keys for the fieldset legend, help text, errors. |
| `src/locales/{ru,en,hy}/assets.json` | Labels for the 5 kinds; new error key `errorAssignedKindNotAllowed`; sub-type fieldset legend. |
| `src/test/categories.test.js`, `assetSubtypes.test.js`, `assets.test.js` | Domain validator/sanitizer coverage. |
| `src/test/CategoryFormDialog.test.jsx`, `SubtypeFormDialog.test.jsx`, `AssetFormDialog.test.jsx` | UI coverage. |
| `src/test/multilangNamesMigration.test.jsx` *(new)* | Migration component coverage. |
| `src/test/statusesAndCategoriesBootstrap.subtypes.test.jsx` | Update to assert `attachableTo` is an array on every seed. |

---

## Constants used throughout the plan

```js
// in src/domain/assets.js — already exists
export const ASSIGNMENT_KIND_LIST = Object.freeze([
  'warehouse', 'employee', 'branch', 'department', 'asset'
]);

// new — used for category defaults and migration
const CATEGORY_DEFAULT_ATTACHABLE_TO = {
  device:    ['branch', 'warehouse', 'employee', 'department'],
  furniture: ['branch', 'warehouse', 'employee', 'department'],
  license:   ['asset', 'employee'],
};
```

`'asset'` is the existing `ASSIGNMENT_KINDS.ASSET` — a license attached to a parent device.

---

## Task 1: Domain — `categories.js` carries `attachableTo`

**Files:**
- Modify: `src/domain/categories.js`
- Test: `src/test/categories.test.js`

- [ ] **Step 1.1: Failing test for sanitize/validate of `attachableTo`**

Add to `src/test/categories.test.js`:

```js
import {
  sanitizeCategoryInput,
  validateCategoryInput,
} from '@/domain/categories.js';

describe('Category attachableTo', () => {
  it('sanitizer dedupes and drops unknown kinds', () => {
    const out = sanitizeCategoryInput({
      name: { ru: 'X', en: 'X', hy: 'X' },
      inventoryCodePrefix: 'A1',
      attachableTo: ['employee', 'employee', 'unknown', 'branch'],
    });
    expect(out.attachableTo).toEqual(['employee', 'branch']);
  });

  it('sanitizer coerces missing/non-array to []', () => {
    expect(sanitizeCategoryInput({ name: { ru: 'X', en: 'X', hy: 'X' }, inventoryCodePrefix: 'A1' }).attachableTo).toEqual([]);
    expect(sanitizeCategoryInput({ name: { ru: 'X', en: 'X', hy: 'X' }, inventoryCodePrefix: 'A1', attachableTo: 'employee' }).attachableTo).toEqual([]);
  });

  it('validator flags empty array with errorAttachableEmpty', () => {
    const errs = validateCategoryInput({
      name: { ru: 'X', en: 'X', hy: 'X' },
      inventoryCodePrefix: 'A1',
      attachableTo: [],
    });
    expect(errs.attachableTo).toBe('errorAttachableEmpty');
  });

  it('validator passes when at least one kind is present', () => {
    const errs = validateCategoryInput({
      name: { ru: 'X', en: 'X', hy: 'X' },
      inventoryCodePrefix: 'A1',
      attachableTo: ['employee'],
    });
    expect(errs.attachableTo).toBeUndefined();
  });
});
```

- [ ] **Step 1.2: Run the new tests**

```bash
npm test -- --run src/test/categories.test.js
```

Expected: 4 failures (`attachableTo` undefined on sanitized output, validator missing the rule).

- [ ] **Step 1.3: Implement in `src/domain/categories.js`**

a. Import `ASSIGNMENT_KIND_LIST`:
```js
import { ASSIGNMENT_KIND_LIST } from '@/domain/assets.js';
```

b. Update typedefs `Category` and `CategoryInput` to include `@property {string[]} attachableTo`.

c. Update `emptyCategoryInput`:
```js
export function emptyCategoryInput() {
  return {
    name: emptyCategoryName(),
    inventoryCodePrefix: '',
    requiresMultilang: true,
    attachableTo: [],
    isActive: true,
  };
}
```

d. Inside `sanitizeCategoryInput`, before the `return`:
```js
const attachableTo = Array.isArray(raw.attachableTo)
  ? Array.from(
      new Set(
        raw.attachableTo.filter(
          (k) => typeof k === 'string' && ASSIGNMENT_KIND_LIST.includes(k)
        )
      )
    )
  : [];
```
Add `attachableTo` to the returned object.

e. Inside `validateCategoryInput`, after the prefix check:
```js
if (!sanitized.attachableTo || sanitized.attachableTo.length === 0) {
  errors.attachableTo = 'errorAttachableEmpty';
}
```

- [ ] **Step 1.4: Re-run, expect green**

```bash
npm test -- --run src/test/categories.test.js
```

Expected: all green.

---

## Task 2: Domain — `assetSubtypes.js` reshape `attachableTo`

**Files:**
- Modify: `src/domain/assetSubtypes.js`
- Test: `src/test/assetSubtypes.test.js`

- [ ] **Step 2.1: Failing tests**

Replace any test that asserts `attachableTo === 'device-only'` shape with the new array shape. Add:

```js
import {
  sanitizeAssetSubtypeInput,
  validateAssetSubtypeInput,
} from '@/domain/assetSubtypes.js';

describe('AssetSubtype attachableTo (array shape)', () => {
  const baseInput = {
    categoryId: 'device',
    name: 'Laptop',
    requiresMultilang: false,
    sortOrder: 10,
    isActive: true,
  };

  it('sanitizer keeps only known kinds and dedupes', () => {
    const out = sanitizeAssetSubtypeInput({
      ...baseInput,
      attachableTo: ['employee', 'employee', 'foo', 'branch'],
    });
    expect(out.attachableTo).toEqual(['employee', 'branch']);
  });

  it('sanitizer coerces missing/non-array to []', () => {
    expect(sanitizeAssetSubtypeInput(baseInput).attachableTo).toEqual([]);
  });

  it('validator flags empty', () => {
    const errs = validateAssetSubtypeInput({ ...baseInput, attachableTo: [] });
    expect(errs.attachableTo).toBe('errorAttachableEmpty');
  });

  it('validator rejects superset of category attachableTo', () => {
    const errs = validateAssetSubtypeInput(
      { ...baseInput, attachableTo: ['employee', 'asset'] },
      { category: { attachableTo: ['employee'] } }
    );
    expect(errs.attachableTo).toBe('errorAttachableNotInCategory');
  });

  it('validator passes for subset of category attachableTo', () => {
    const errs = validateAssetSubtypeInput(
      { ...baseInput, attachableTo: ['employee'] },
      { category: { attachableTo: ['employee', 'branch'] } }
    );
    expect(errs.attachableTo).toBeUndefined();
  });
});
```

- [ ] **Step 2.2: Run, expect failures.**

- [ ] **Step 2.3: Implement**

a. Drop `ATTACHABLE_TO`, `ATTACHABLE_TO_LIST`, `ATTACHABLE_TO_CATEGORY_IDS` exports. Replace with:
```js
import { ASSIGNMENT_KIND_LIST } from '@/domain/assets.js';
```

b. Update typedef `AssetSubtype`: `@property {string[]} attachableTo`. Same on `AssetSubtypeInput`.

c. Update `emptyAssetSubtypeInput`:
```js
return {
  categoryId: '',
  name: emptyName(),
  requiresMultilang: false,
  attachableTo: [],
  sortOrder: 0,
  isActive: true,
};
```

d. In `sanitizeAssetSubtypeInput` replace the `attachableTo` block with:
```js
const attachableTo = Array.isArray(raw.attachableTo)
  ? Array.from(
      new Set(
        raw.attachableTo.filter(
          (k) => typeof k === 'string' && ASSIGNMENT_KIND_LIST.includes(k)
        )
      )
    )
  : [];
```

e. In `validateAssetSubtypeInput` change the `attachableTo` block:
```js
export function validateAssetSubtypeInput(input, opts = {}) {
  const errors = {};
  const s = sanitizeAssetSubtypeInput(input);
  // ...categoryId / name checks unchanged...

  if (!s.attachableTo || s.attachableTo.length === 0) {
    errors.attachableTo = 'errorAttachableEmpty';
  } else if (opts.category?.attachableTo) {
    const allowed = new Set(opts.category.attachableTo);
    const widens = s.attachableTo.some((k) => !allowed.has(k));
    if (widens) errors.attachableTo = 'errorAttachableNotInCategory';
  }

  return errors;
}
```

f. Search the codebase for `ATTACHABLE_TO`, `ATTACHABLE_TO_LIST`, `ATTACHABLE_TO_CATEGORY_IDS` and update or remove imports/usages:

```bash
# In Grep tool:
grep -n "ATTACHABLE_TO" src/
```

Likely call-sites: `SubtypeManagementPage.jsx` (`renderAttachableTo`), `AssetFormDialog.jsx`, possibly `assets.js`. They will be updated in their own tasks below.

- [ ] **Step 2.4: Re-run domain tests**

```bash
npm test -- --run src/test/assetSubtypes.test.js
```

Expected: green.

---

## Task 3: Domain — `assets.js` validation uses the array

**Files:**
- Modify: `src/domain/assets.js`
- Test: `src/test/assets.test.js`

- [ ] **Step 3.1: Failing test**

Add to `src/test/assets.test.js`:

```js
describe('validateAssetInput — attachableTo array', () => {
  const baseInput = {
    categoryId: 'device',
    subtypeId: 'device_laptop',
    name: 'X',
    branchId: 'b1',
    statusId: 'warehouse',
    condition: 'new',
    assignedTo: { kind: 'employee', id: 'emp_1' },
  };

  it('passes when assignedTo.kind is in subtype.attachableTo', () => {
    const errs = validateAssetInput(baseInput, {
      category: { requiresMultilang: false },
      subtype: { attachableTo: ['employee', 'branch'] },
    });
    expect(errs.assignedTo).toBeUndefined();
  });

  it('fails with errorAssignedKindNotAllowed when kind missing from list', () => {
    const errs = validateAssetInput(baseInput, {
      category: { requiresMultilang: false },
      subtype: { attachableTo: ['branch'] },
    });
    expect(errs.assignedTo).toBe('errorAssignedKindNotAllowed');
  });

  it('passes when subtype is not provided (no gating)', () => {
    const errs = validateAssetInput(baseInput, {
      category: { requiresMultilang: false },
    });
    expect(errs.assignedTo).toBeUndefined();
  });
});
```

- [ ] **Step 3.2: Run, expect failures.**

- [ ] **Step 3.3: Implement**

In `src/domain/assets.js`, locate the existing `assignedTo` validation block in `validateAssetInput` (around line 360). Replace the `'device-only'` branch:

```js
} else if (
  subtype?.attachableTo &&
  Array.isArray(subtype.attachableTo) &&
  subtype.attachableTo.length > 0 &&
  !subtype.attachableTo.includes(at.kind)
) {
  errors.assignedTo = 'errorAssignedKindNotAllowed';
}
```

Drop the `ASSIGNMENT_KINDS.ASSET && categoryId !== 'license'` branch — replaced by the same check (super admin can configure which categories permit `'asset'`).

Update the JSDoc on `opts`:
```
* @param {{
*   category?: { requiresMultilang: boolean } | null,
*   subtype?: { attachableTo: string[] } | null,
* }} [opts]
```

- [ ] **Step 3.4: Re-run**

```bash
npm test -- --run src/test/assets.test.js
```

Expected: green.

---

## Task 4: Bootstrap seeds carry `attachableTo`

**Files:**
- Modify: `src/components/system/StatusesAndCategoriesBootstrap.jsx`
- Modify: `scripts/seed.js`
- Modify: `src/test/statusesAndCategoriesBootstrap.subtypes.test.jsx`

- [ ] **Step 4.1: Update `CATEGORY_SEEDS` in both bootstrap files**

In both files, change each category seed to include `attachableTo`:

```js
{
  id: 'device',
  name: { ru: 'Устройства', en: 'Devices', hy: 'Սարքեր' },
  inventoryCodePrefix: '400',
  requiresMultilang: true,
  attachableTo: ['branch', 'warehouse', 'employee', 'department'],
},
{
  id: 'furniture',
  name: { ru: 'Мебель', en: 'Furniture', hy: 'Կահույք' },
  inventoryCodePrefix: '500',
  requiresMultilang: true,
  attachableTo: ['branch', 'warehouse', 'employee', 'department'],
},
{
  id: 'license',
  name: { ru: 'Лицензии', en: 'Licenses', hy: 'Լիցենզիաներ' },
  inventoryCodePrefix: 'LIC',
  requiresMultilang: true,
  attachableTo: ['asset', 'employee'],
},
```

- [ ] **Step 4.2: Update `ASSET_SUBTYPE_SEEDS` in `StatusesAndCategoriesBootstrap.jsx`**

Replace the legacy `attachableTo: 'device-only' | null` shape with arrays:

- All seven device sub-types: `attachableTo: ['branch', 'warehouse', 'employee', 'department']`
- All seven furniture sub-types: `attachableTo: ['branch', 'warehouse', 'employee', 'department']`
- Six of the seven license sub-types (everything except OS): `attachableTo: ['asset', 'employee']`
- The `license_os` sub-type: `attachableTo: ['asset']` (preserves the "OEM cannot go to a person" constraint)

Drop every `attachableTo: 'device-only'` and `attachableTo: 'device-or-employee'` from the seed list and replace with the arrays above.

- [ ] **Step 4.3: Update the bootstrap call to forward the new field**

Inside `seedCatalogs`'s category creation block (line ~256), pass `attachableTo`:

```js
await firestoreCategoryRepository.create(
  {
    name: categoryNameInputFromSeed(seed),
    inventoryCodePrefix: seed.inventoryCodePrefix,
    requiresMultilang: seed.requiresMultilang,
    attachableTo: seed.attachableTo,
    isActive: true,
  },
  actor,
  { id: seed.id }
);
```

Inside the sub-type creation block (line ~287):

```js
await firestoreAssetSubtypeRepository.create(
  {
    categoryId: seed.categoryId,
    name: seed.name,
    requiresMultilang: Boolean(seed.requiresMultilang),
    attachableTo: seed.attachableTo,
    sortOrder: seed.sortOrder ?? 0,
    isActive: true,
  },
  actor,
  { id: seed.id }
);
```

- [ ] **Step 4.4: Update the bootstrap test**

Edit `src/test/statusesAndCategoriesBootstrap.subtypes.test.jsx` — replace the assertion:

```js
expect(deviceOnly[0].payload.attachableTo).toEqual(['asset']);
// ...
for (const c of mocks.subtypeCreates) {
  expect(Array.isArray(c.payload.attachableTo)).toBe(true);
  expect(c.payload.attachableTo.length).toBeGreaterThan(0);
  for (const k of c.payload.attachableTo) {
    expect(['branch', 'warehouse', 'employee', 'department', 'asset']).toContain(k);
  }
}
```

(Replace the existing `device-only` regex assertion likewise.)

- [ ] **Step 4.5: Run**

```bash
npm test -- --run src/test/statusesAndCategoriesBootstrap.subtypes.test.jsx
```

Expected: green.

---

## Task 5: Migration — extend the bootstrap migration component

**Files:**
- Rename: `src/components/system/MultilangNamesMigration.jsx` → `src/components/system/CatalogShapeMigration.jsx`
- Modify: `src/components/layout/AppShell.jsx` (update import + JSX tag)
- Test: `src/test/catalogShapeMigration.test.jsx` *(new)*

- [ ] **Step 5.1: Rename the file and the component**

Rename and update the default export name to `CatalogShapeMigration`.

- [ ] **Step 5.2: Update the import in `AppShell.jsx`**

```diff
- import MultilangNamesMigration from '@/components/system/MultilangNamesMigration.jsx';
+ import CatalogShapeMigration from '@/components/system/CatalogShapeMigration.jsx';
...
- <MultilangNamesMigration />
+ <CatalogShapeMigration />
```

- [ ] **Step 5.3: Add the second migration pass**

Inside `runMigration`, after the existing name-upgrade loops, add:

```js
const CATEGORY_DEFAULT_ATTACHABLE_TO = {
  device:    ['branch', 'warehouse', 'employee', 'department'],
  furniture: ['branch', 'warehouse', 'employee', 'department'],
  license:   ['asset', 'employee'],
};

// Pass 2: upgrade `attachableTo` from enum/null to array.
for (const cat of categories) {
  if (Array.isArray(cat.attachableTo) && cat.attachableTo.length > 0) continue;
  const next = CATEGORY_DEFAULT_ATTACHABLE_TO[cat.categoryId] ?? null;
  if (!next) continue; // unknown custom category — skip; super admin sets it manually
  try {
    await firestoreCategoryRepository.update(
      cat.categoryId,
      {
        name: cat.name,
        inventoryCodePrefix: cat.inventoryCodePrefix,
        requiresMultilang: cat.requiresMultilang ?? true,
        attachableTo: next,
        isActive: cat.isActive ?? true,
      },
      cat,
      actor
    );
    upgraded += 1;
  } catch (err) {
    console.warn(`[AMS] migration: category.attachableTo ${cat.categoryId} skipped:`, err?.code ?? err?.message ?? err);
  }
}

for (const sub of subtypes) {
  if (Array.isArray(sub.attachableTo) && sub.attachableTo.length > 0) continue;
  let next;
  if (sub.attachableTo === 'device-only') next = ['asset'];
  else if (sub.attachableTo === 'device-or-employee') next = ['asset', 'employee'];
  else {
    // null/undefined — inherit from parent category seed defaults.
    const parentDefault = CATEGORY_DEFAULT_ATTACHABLE_TO[sub.categoryId];
    if (!parentDefault) continue;
    next = parentDefault;
  }
  try {
    await firestoreAssetSubtypeRepository.update(
      sub.subtypeId,
      {
        categoryId: sub.categoryId,
        name: sub.name,
        requiresMultilang: sub.requiresMultilang ?? false,
        attachableTo: next,
        sortOrder: sub.sortOrder ?? 0,
        isActive: sub.isActive ?? true,
      },
      sub,
      actor
    );
    upgraded += 1;
  } catch (err) {
    console.warn(`[AMS] migration: subtype.attachableTo ${sub.subtypeId} skipped:`, err?.code ?? err?.message ?? err);
  }
}
```

- [ ] **Step 5.4: Add migration test**

Create `src/test/catalogShapeMigration.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const mocks = {
  authValue: { user: { uid: 'super_uid' }, role: 'super_admin' },
  categories: { data: [], loading: false },
  subtypes: { all: [], loading: false },
  catUpdates: [],
  subUpdates: [],
};

vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => mocks.authValue,
}));
vi.mock('@/hooks/useCategories.js', () => ({
  useCategories: () => mocks.categories,
}));
vi.mock('@/hooks/useAssetSubtypes.js', () => ({
  useAssetSubtypes: () => ({ ...mocks.subtypes, loading: mocks.subtypes.loading }),
}));
vi.mock('@/infra/repositories/firestoreCategoryRepository.js', () => ({
  firestoreCategoryRepository: {
    update: vi.fn(async (id, input, before, actor) => {
      mocks.catUpdates.push({ id, input, before, actor });
    }),
  },
}));
vi.mock('@/infra/repositories/firestoreAssetSubtypeRepository.js', () => ({
  firestoreAssetSubtypeRepository: {
    update: vi.fn(async (id, input, before, actor) => {
      mocks.subUpdates.push({ id, input, before, actor });
    }),
  },
}));

import CatalogShapeMigration from '@/components/system/CatalogShapeMigration.jsx';

beforeEach(() => {
  mocks.catUpdates.length = 0;
  mocks.subUpdates.length = 0;
});

describe('CatalogShapeMigration — attachableTo upgrade', () => {
  it('upgrades a license sub-type with legacy device-only enum', async () => {
    mocks.subtypes = {
      all: [
        {
          subtypeId: 'license_os',
          categoryId: 'license',
          name: { ru: 'Операционная система', en: 'Operating System', hy: 'Օպերացիոն համակարգ' },
          requiresMultilang: true,
          attachableTo: 'device-only',
          sortOrder: 10,
          isActive: true,
        },
      ],
      loading: false,
    };
    mocks.categories = { data: [], loading: false };

    render(<CatalogShapeMigration />);
    await waitFor(() => {
      expect(mocks.subUpdates.length).toBe(1);
    });
    expect(mocks.subUpdates[0].input.attachableTo).toEqual(['asset']);
  });

  it('upgrades a category with missing attachableTo to its seed default', async () => {
    mocks.categories = {
      data: [
        {
          categoryId: 'device',
          name: { ru: 'Устройства', en: 'Devices', hy: 'Սարքեր' },
          inventoryCodePrefix: '400',
          requiresMultilang: true,
          isActive: true,
        },
      ],
      loading: false,
    };
    mocks.subtypes = { all: [], loading: false };

    render(<CatalogShapeMigration />);
    await waitFor(() => {
      expect(mocks.catUpdates.length).toBe(1);
    });
    expect(mocks.catUpdates[0].input.attachableTo).toEqual([
      'branch', 'warehouse', 'employee', 'department',
    ]);
  });

  it('no-ops when attachableTo is already an array', async () => {
    mocks.categories = {
      data: [
        {
          categoryId: 'device',
          name: { ru: 'Устройства', en: 'Devices', hy: 'Սարքեր' },
          inventoryCodePrefix: '400',
          requiresMultilang: true,
          attachableTo: ['branch'],
          isActive: true,
        },
      ],
      loading: false,
    };
    mocks.subtypes = { all: [], loading: false };

    render(<CatalogShapeMigration />);
    await new Promise((r) => setTimeout(r, 80));
    expect(mocks.catUpdates).toHaveLength(0);
  });
});
```

- [ ] **Step 5.5: Run**

```bash
npm test -- --run src/test/catalogShapeMigration.test.jsx
```

Expected: green.

---

## Task 6: i18n keys

**Files:**
- Modify: `src/locales/{ru,en,hy}/categories.json`
- Modify: `src/locales/{ru,en,hy}/assets.json`

- [ ] **Step 6.1: Add to `categories.json` (all three locales)**

ru:
```json
"attachableToFieldset": "Привязка по умолчанию",
"attachableToHelp": "Эти варианты будут предложены при создании подтипов этой категории. Подтипы могут сузить список, но не расширить.",
"errorAttachableEmpty": "Выберите хотя бы один тип привязки",
```

en:
```json
"attachableToFieldset": "Default holder targets",
"attachableToHelp": "These options will be offered when creating sub-types of this category. Sub-types can narrow the list but not widen it.",
"errorAttachableEmpty": "Pick at least one holder target",
```

hy:
```json
"attachableToFieldset": "Կանխադրված կցորդման թիրախներ",
"attachableToHelp": "Այս ընտրանքները կառաջարկվեն այս կատեգորիայի ենթատեսակները ստեղծելիս: Ենթատեսակները կարող են նեղացնել ցանկը, բայց ոչ ընդլայնել:",
"errorAttachableEmpty": "Ընտրեք առնվազն մեկ կցորդման թիրախ",
```

- [ ] **Step 6.2: Add to `assets.json` (all three locales)**

ru:
```json
"assignmentKindBranch": "Филиал",
"assignmentKindWarehouse": "Склад",
"assignmentKindEmployee": "Сотрудник",
"assignmentKindDepartment": "Отдел",
"assignmentKindAsset": "Устройство",
"subtypeAdminAttachableLegend": "Разрешённые цели привязки",
"subtypeAdminAttachableHelp": "Можно выбрать только из набора, разрешённого в категории.",
"errorAssignedKindNotAllowed": "Этот тип привязки не разрешён для выбранного подтипа",
"errorAttachableNotInCategory": "Подтип не может расширять список категории",
```

en:
```json
"assignmentKindBranch": "Branch",
"assignmentKindWarehouse": "Warehouse",
"assignmentKindEmployee": "Employee",
"assignmentKindDepartment": "Department",
"assignmentKindAsset": "Device",
"subtypeAdminAttachableLegend": "Allowed holder targets",
"subtypeAdminAttachableHelp": "Pick a subset of the parent category's allowed targets.",
"errorAssignedKindNotAllowed": "This holder kind is not allowed for the selected sub-type",
"errorAttachableNotInCategory": "Sub-type cannot widen the parent category's list",
```

hy:
```json
"assignmentKindBranch": "Մասնաճյուղ",
"assignmentKindWarehouse": "Պահեստ",
"assignmentKindEmployee": "Աշխատակից",
"assignmentKindDepartment": "Բաժին",
"assignmentKindAsset": "Սարք",
"subtypeAdminAttachableLegend": "Թույլատրված կցորդման թիրախներ",
"subtypeAdminAttachableHelp": "Ընտրեք ծնող կատեգորիայի թույլատրված ենթաբազմությունից:",
"errorAssignedKindNotAllowed": "Կցորդման այս տեսակն այս ենթատեսակի համար թույլատրված չէ",
"errorAttachableNotInCategory": "Ենթատեսակը չի կարող ընդլայնել ծնող կատեգորիայի ցանկը",
```

- [ ] **Step 6.3: Lint to make sure JSON is valid**

```bash
npm run lint
```

Expected: clean.

---

## Task 7: UI — `CategoryFormDialog` checkbox group

**Files:**
- Modify: `src/components/features/categories/CategoryFormDialog.jsx`
- Test: `src/test/CategoryFormDialog.test.jsx`

- [ ] **Step 7.1: Read the file** to identify form-state hook + render structure.

- [ ] **Step 7.2: Failing test**

```jsx
it('renders the 5 holder-target checkboxes and submits the chosen subset', async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderDialog({ onSubmit });

  // Fill required name + prefix
  await user.type(screen.getByLabelText(/RU/i), 'Тест');
  await user.type(screen.getByLabelText(/EN/i), 'Test');
  await user.type(screen.getByLabelText(/HY/i), 'Թեստ');
  await user.type(
    screen.getByLabelText(i18n.t('categories:inventoryCodePrefix')),
    'TST'
  );

  // The fieldset legend
  expect(screen.getByText(i18n.t('categories:attachableToFieldset'))).toBeInTheDocument();

  // Pick employee + branch
  await user.click(screen.getByLabelText(i18n.t('assets:assignmentKindEmployee')));
  await user.click(screen.getByLabelText(i18n.t('assets:assignmentKindBranch')));

  await user.click(
    screen.getByRole('button', { name: i18n.t('categories:save') })
  );

  expect(onSubmit).toHaveBeenCalled();
  const [input] = onSubmit.mock.calls[0];
  expect(input.attachableTo).toEqual(['employee', 'branch']);
});

it('blocks submit with errorAttachableEmpty when no boxes are checked', async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderDialog({ onSubmit });

  await user.type(screen.getByLabelText(/RU/i), 'X');
  await user.type(screen.getByLabelText(/EN/i), 'X');
  await user.type(screen.getByLabelText(/HY/i), 'X');
  await user.type(
    screen.getByLabelText(i18n.t('categories:inventoryCodePrefix')),
    'X1'
  );
  await user.click(
    screen.getByRole('button', { name: i18n.t('categories:save') })
  );

  expect(
    screen.getByText(i18n.t('categories:errorAttachableEmpty'))
  ).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});
```

- [ ] **Step 7.3: Implement the fieldset**

Inside `CategoryFormDialog.jsx`:

1. Add `attachableTo` to the form state seeded by `emptyCategoryInput()`. On edit mode, seed from `category.attachableTo ?? []`.

2. Render the fieldset (place it right under the existing `requiresMultilang` toggle). Use the `useTranslation('assets')` hook to pull the kind labels:

```jsx
const KINDS = ['branch', 'warehouse', 'employee', 'department', 'asset'];

<fieldset className="space-y-2">
  <legend className="text-sm font-medium">
    {t('categories:attachableToFieldset')}
  </legend>
  <p className="text-xs text-muted-foreground">{t('categories:attachableToHelp')}</p>
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
    {KINDS.map((k) => {
      const checked = formState.attachableTo.includes(k);
      return (
        <label key={k} className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name={`attachableTo.${k}`}
            checked={checked}
            onChange={(e) =>
              setFormState((s) => ({
                ...s,
                attachableTo: e.target.checked
                  ? [...s.attachableTo, k]
                  : s.attachableTo.filter((x) => x !== k),
              }))
            }
          />
          {tA(`assignmentKind${k.charAt(0).toUpperCase() + k.slice(1)}`)}
        </label>
      );
    })}
  </div>
  {errors.attachableTo ? (
    <p className="text-xs text-destructive">
      {t(`categories:${errors.attachableTo}`)}
    </p>
  ) : null}
</fieldset>
```

(Where `tA` is the `assets`-namespace `t` function.)

3. The submit handler already calls `validateCategoryInput`; the validator from Task 1 now flags `attachableTo`.

- [ ] **Step 7.4: Run**

```bash
npm test -- --run src/test/CategoryFormDialog.test.jsx
```

Expected: green.

---

## Task 8: UI — `SubtypeFormDialog` checkbox group + subset constraint

**Files:**
- Modify: `src/components/features/assets/SubtypeFormDialog.jsx`
- Test: `src/test/SubtypeFormDialog.test.jsx`

- [ ] **Step 8.1: Read the file**.

- [ ] **Step 8.2: Failing test**

```jsx
it('shows the parent category subset and rejects widening', async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <I18nextProvider i18n={i18n}>
      <SubtypeFormDialog
        open
        onClose={vi.fn()}
        subtype={null}
        defaultCategoryId="device"
        categories={[
          { categoryId: 'device', attachableTo: ['employee', 'branch'], requiresMultilang: false, name: { ru: 'X', en: 'X', hy: 'X' } },
        ]}
        onSubmit={onSubmit}
      />
    </I18nextProvider>
  );

  // Only the parent's two kinds appear as enabled checkboxes.
  expect(screen.getByLabelText(i18n.t('assets:assignmentKindEmployee'))).toBeEnabled();
  expect(screen.getByLabelText(i18n.t('assets:assignmentKindBranch'))).toBeEnabled();
  // Department was NOT in the parent's list — must be disabled or hidden.
  const dept = screen.queryByLabelText(i18n.t('assets:assignmentKindDepartment'));
  expect(dept === null || dept.disabled).toBe(true);

  // Pick employee, fill name, submit.
  await user.click(screen.getByLabelText(i18n.t('assets:assignmentKindEmployee')));
  await user.type(screen.getByLabelText(i18n.t('assets:subtypeAdminFieldName')), 'Laptop');
  await user.click(screen.getByRole('button', { name: i18n.t('assets:save') }));
  expect(onSubmit).toHaveBeenCalled();
  expect(onSubmit.mock.calls[0][0].attachableTo).toEqual(['employee']);
});
```

(Adjust the field-name label key to whatever `SubtypeFormDialog` uses — pull from the existing test file.)

- [ ] **Step 8.3: Implement**

1. Drop the existing `<select>` for `attachableTo` (old `device-only` / `device-or-employee` / null UI).

2. Add the same fieldset as in Task 7, BUT only render checkboxes for kinds listed in the parent category's `attachableTo`. Pass the parent category through props/lookup. Disable kinds outside the parent's set.

3. On `defaultCategoryId` resolution (existing typeahead path), pre-populate the sub-type's `attachableTo` from the parent's set on first render. When the operator switches the parent category, reset to the new parent's set.

4. Pass `{ category: parentCategory }` to `validateAssetSubtypeInput` in the component's submit handler.

- [ ] **Step 8.4: Run**

```bash
npm test -- --run src/test/SubtypeFormDialog.test.jsx
```

Expected: green.

---

## Task 9: UI — `AssetFormDialog` filters the kind picker

**Files:**
- Modify: `src/components/features/assets/AssetFormDialog.jsx`
- Test: `src/test/AssetFormDialog.test.jsx`

- [ ] **Step 9.1: Read the existing kind picker** (search for `assignedTo.kind` or `ASSIGNMENT_KINDS` inside the file).

- [ ] **Step 9.2: Failing test**

```jsx
it('shows only kinds in the chosen sub-type attachableTo', async () => {
  // The mock catalog was set up earlier in the file; pick the device sub-type
  // whose `attachableTo` we'll update for this test:
  // device subtype attachableTo: ['employee']
  // ...
  // After picking the sub-type the kind <select> should have one option only.
  const user = userEvent.setup();
  renderDialog();

  await user.selectOptions(screen.getByLabelText(i18n.t('assets:category')), 'cat_device');
  await user.selectOptions(screen.getByLabelText(i18n.t('assets:subtype')), 'device_laptop');

  const kindEl = screen.getByLabelText(i18n.t('assets:holderKind'));
  // Only "Employee" is offered.
  const opts = Array.from(kindEl.querySelectorAll('option'));
  expect(opts.map((o) => o.value)).toEqual(['employee']);
});
```

- [ ] **Step 9.3: Implement**

1. Compute `allowedKinds` from the chosen sub-type:
```js
const allowedKinds = useMemo(() => {
  const sub = subtypes.find((s) => s.subtypeId === input.subtypeId);
  return sub?.attachableTo ?? [];
}, [subtypes, input.subtypeId]);
```

2. Filter the `<option>` list of the `assignedTo.kind` `<select>` (or `<RadioGroup>`):
```jsx
{ASSIGNMENT_KIND_LIST.filter((k) => allowedKinds.includes(k)).map((k) => (
  <option key={k} value={k}>{tA(`assignmentKind${k.charAt(0).toUpperCase() + k.slice(1)}`)}</option>
))}
```

3. When `allowedKinds` changes (sub-type swap), reset `assignedTo.kind` if it's no longer present:
```js
useEffect(() => {
  if (!allowedKinds.includes(input.assignedTo?.kind)) {
    setInput((s) => ({ ...s, assignedTo: { kind: allowedKinds[0] ?? 'warehouse', id: null } }));
  }
}, [allowedKinds]);
```

4. If `allowedKinds.length === 1`, hide the picker entirely and show a static label.

- [ ] **Step 9.4: Run**

```bash
npm test -- --run src/test/AssetFormDialog.test.jsx
```

Expected: green.

---

## Task 10: Firestore rules — validate the array

**Files:**
- Modify: `firestore.rules`
- Test: `src/test/categories.rulesMirror.test.js` and `assets.rulesMirror.test.js` (if they exist)

- [ ] **Step 10.1: Open `firestore.rules`** and locate the `match /categories/{id}` and `match /asset_subtypes/{id}` blocks.

- [ ] **Step 10.2: Add to each create/update guard**

```
&& request.resource.data.attachableTo is list
&& request.resource.data.attachableTo.size() >= 1
&& request.resource.data.attachableTo.size() <= 5
&& request.resource.data.attachableTo.toSet().difference(
     ['branch','warehouse','employee','department','asset'].toSet()
   ).size() == 0
```

- [ ] **Step 10.3: Update the rules-mirror tests** (if present in `src/test/`) to assert the new shape passes/fails as expected.

- [ ] **Step 10.4: Lint and unit-test**

```bash
npm run lint && npm test -- --run
```

(Skip the rules emulator unless the project has it wired — the mirror tests cover the parsing.)

---

## Task 11: Browser smoke test

- [ ] **Step 11.1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 11.2: Sign in as super admin**

The migration runs silently. Look for `[AMS] multilang-names migration: N doc(s) upgraded` in the browser devtools console.

- [ ] **Step 11.3: Walk through the three flows**

1. `/settings/categories` → click "Add category" → see the «Привязка по умолчанию» fieldset; pick subset; save.
2. `/settings/asset-subtypes` → click "+ Добавить подтип" on a category card → sub-type form shows the parent's allowed kinds; pick subset; save.
3. `/assets` → "Add asset" → pick the new sub-type → confirm the holder picker shows only the configured kinds.

- [ ] **Step 11.4: Confirm i18n**

Switch UI language to en, then hy. Verify the fieldset legend and kind labels translate.

---

## Self-Review notes

- `'asset'` may appear in non-license categories if the super admin enables it. Acknowledged in the spec. No code-level guardrail.
- The migration acts on first super-admin sign-in only; `attempted.current = true` prevents re-runs in the same session. Subsequent sessions re-evaluate and no-op (because already-upgraded docs have `Array.isArray(attachableTo) === true`).
- Existing audit log rows still reference `'device-only'` etc. We don't rewrite history — diffs against future updates simply show the migration row that flipped enum → array.
- `firestoreCategoryRepository.auditSnapshot` and `firestoreAssetSubtypeRepository.auditSnapshot` already cover `attachableTo` (they pluck `obj.attachableTo ?? null`); the field's new shape doesn't break the JSON snapshot.
