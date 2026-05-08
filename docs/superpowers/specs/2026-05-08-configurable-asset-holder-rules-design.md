# Configurable Asset Holder Rules (ПРИВЯЗКА)

**Phase:** 1.5 (extension of MVP)
**Status:** spec
**Date:** 2026-05-08
**Owner agents:** domain-modeler, react-ui-engineer, firebase-engineer
**Spec reference:** extends `docs/features/asset-categories.md` and `docs/features/asset-registry.md`

## Purpose & user value

Today every license sub-type carries `attachableTo: 'device-only' | 'device-or-employee' | null`, and only license sub-types use it. Devices and Furniture have no equivalent rule — they implicitly accept every holder kind. The Super Admin has no way to say "this furniture sub-type can only sit at a branch / warehouse, never with an employee".

Customers want to dictate **per sub-type** which holder kinds are picked from when creating an asset, so the catalog becomes a configurable rulebook instead of a fixed convention. Categories carry a default rule set; sub-types inherit and override.

## In scope

- `Category.attachableTo: string[]` — array of allowed kinds, used as default for new sub-types under the category. **New field.**
- `AssetSubtype.attachableTo: string[]` — array of allowed kinds. **Replaces** the existing single-value field `('device-only' | 'device-or-employee' | null)`.
- Five allowed kinds, lifted from existing `ASSIGNMENT_KINDS`: `branch | warehouse | employee | department | asset` (asset = "license attached to a parent device").
- Configuration UI inside `CategoryFormDialog` (checkbox group) and `SubtypeFormDialog` (checkbox group, defaults inherited from parent category).
- Enforcement inside `AssetFormDialog`: the `assignedTo.kind` picker shows only kinds present in the chosen sub-type's `attachableTo`.
- Validation update in `validateAssetInput`: `assignedTo.kind` must be in `subtype.attachableTo`.
- Migration:
  - Existing license sub-types: `'device-only'` → `['asset']`, `'device-or-employee'` → `['asset', 'employee']`.
  - Existing device sub-types: seed `['branch', 'warehouse', 'employee', 'department']`.
  - Existing furniture sub-types: seed `['branch', 'warehouse', 'employee', 'department']`.
  - Existing categories: same defaults as their seeded sub-types.
- i18n keys for the new UI in `categories.json` and `assets.json` (ru/en/hy).
- Firestore rules: validate `attachableTo` is an array of allowed string literals.
- Tests: domain validation, sub-type form, category form, asset form filtering, repository sanitization, migration component.

## Out of scope

- Changing the existing assignment lifecycle (`assignments` collection, `currentAssignee*` denormalization) — `assignedTo` on the asset doc is the only target.
- Workflow approvals before changing a holder. (Phase 3.)
- Bulk-edit of `attachableTo` across multiple sub-types. (Operator edits one row at a time.)
- A dedicated "Какой склад?" filter on the branch picker — for now, when the operator picks `kind === 'warehouse'` the picker filters `branches.where(type === 'warehouse')`; when `kind === 'branch'` it filters the inverse. No new UI control.
- Renaming the field. We keep `attachableTo` for continuity with the current code, even though the array shape supersedes the old enum semantics.

## Domain entities involved

| Entity | Change |
|---|---|
| `Category` | New field `attachableTo: string[]` |
| `AssetSubtype` | Field `attachableTo` reshape: enum → array |
| `Asset` | No schema change; `assignedTo.kind` validation tightens |

`ASSIGNMENT_KINDS` already lists all five values — no enum change.

## Data shape

### Category

```jsdoc
/**
 * @typedef {Object} Category
 * @property {string} categoryId
 * @property {CategoryName} name
 * @property {string} inventoryCodePrefix
 * @property {boolean} requiresMultilang
 * @property {string[]} attachableTo            // NEW: subset of ASSIGNMENT_KIND_LIST, no duplicates, length >= 1
 * @property {boolean} isActive
 * ...
 */
```

### AssetSubtype

```jsdoc
/**
 * @typedef {Object} AssetSubtype
 * @property {string} subtypeId
 * @property {string} categoryId
 * @property {AssetSubtypeName} name
 * @property {boolean} requiresMultilang
 * @property {string[]} attachableTo            // CHANGED: was 'device-only' | 'device-or-employee' | null
 * @property {number} sortOrder
 * @property {boolean} isActive
 * ...
 */
```

### Defaults written by the seed

```js
const CATEGORY_DEFAULTS = {
  device:    ['branch', 'warehouse', 'employee', 'department'],
  furniture: ['branch', 'warehouse', 'employee', 'department'],
  license:   ['asset', 'employee'],   // 'asset' = attached to a parent device
};
```

Each seeded sub-type inherits its category's array verbatim. The OS license remains `['asset']` only (override at sub-type level), preserving the existing "Windows OEM cannot go to a person" invariant.

## UI surfaces

### `CategoryFormDialog`

Add a fieldset titled **«Привязка по умолчанию»** with five checkboxes (Branch / Warehouse / Employee / Department / Device). Pre-selected per the defaults above on create. On edit, pre-selected from the doc. Validates: at least one checkbox must be on.

### `SubtypeFormDialog`

Add the same fieldset titled **«Разрешённые цели привязки»**. On create, pre-selected from the parent category's `attachableTo`. On edit, from the sub-type's own `attachableTo`. Validates: at least one box checked AND the chosen set is a subset of the parent category's set (sub-type cannot widen the rule, only narrow).

### `AssetFormDialog`

The existing `assignedTo.kind` picker becomes filtered:
```js
const allowedKinds = subtype?.attachableTo ?? [];
const visibleOptions = ASSIGNMENT_KIND_LIST.filter(k => allowedKinds.includes(k));
```
If `allowedKinds.length === 1`, the kind is auto-selected and the picker is hidden. If the operator changes the sub-type, the kind resets and the dependent id picker (employee/branch/department/asset) re-fetches.

## Validation

### `sanitizeCategoryInput` and `sanitizeAssetSubtypeInput`

- `attachableTo`: coerce to array, drop unknown strings, dedupe, drop empty entries.
- If the resulting array is empty AFTER coercion, leave it empty so `validate*` flags it.

### `validateCategoryInput`

- `attachableTo` must contain at least one entry.

### `validateAssetSubtypeInput`

- `attachableTo` must contain at least one entry.
- Removed: legacy `errorAttachableOnlyForLicense` rule. Replaced with: every entry must be in `ASSIGNMENT_KIND_LIST`. (Sub-type cannot have `'asset'` outside the license category? — let the parent category's set be the gate; if the parent allows `'asset'` the sub-type may too.)
- New rule: `attachableTo` must be a subset of the parent category's `attachableTo` (when the parent is provided in the validation context).

### `validateAssetInput`

- Replace the existing `subtype?.attachableTo === 'device-only'` branch with:
  ```js
  if (!subtype?.attachableTo?.includes(at.kind)) {
    errors.assignedTo = 'errorAssignedKindNotAllowed';
  }
  ```

## i18n

`categories.json` adds:
- `attachableToFieldset` — "Привязка по умолчанию" / "Default holder targets" / "Կանխադրված կցորդման թիրախներ"
- `attachableToHelp` — explanation for super admin
- `errorAttachableEmpty` — "Выберите хотя бы один тип привязки" / etc.

`assets.json` adds:
- `assignmentKindBranch`, `assignmentKindWarehouse`, `assignmentKindEmployee`, `assignmentKindDepartment`, `assignmentKindAsset` — labels for the checkbox group AND the picker.
- `subtypeAdminAttachableLegend` — fieldset title for the sub-type form.
- `errorAttachableSubsetOfCategory` — sub-type set isn't a subset of category.
- `errorAssignedKindNotAllowed` — replaces `errorLicenseDeviceOnly` in the asset form.

`subtypeAdminAttachableDeviceOnly`, `subtypeAdminAttachableDeviceOrEmployee`, `subtypeAdminAttachableNone` and the matching `assets:errorAttachableOnlyForLicense`, `assets:errorLicenseDeviceOnly` keys can stay (audit-log meta might still reference them) but the new flow won't read them.

## Repository / persistence

`firestoreCategoryRepository.createCategory` and `updateCategory` write `attachableTo` straight from the sanitized input. `auditSnapshot` includes the array. Same for `firestoreAssetSubtypeRepository`.

## Firestore rules

Add to both `match /categories/{categoryId}` and `match /asset_subtypes/{subtypeId}` create/update guards:

```
&& request.resource.data.attachableTo is list
&& request.resource.data.attachableTo.size() >= 1
&& request.resource.data.attachableTo.size() <= 5
&& request.resource.data.attachableTo.toSet().difference(
     ['branch','warehouse','employee','department','asset'].toSet()
   ).size() == 0
```

(`toSet().difference(...).size() == 0` is the rule-engine idiom for "every element is in the allowlist".)

## Migration

Two migration paths run **idempotently** on super_admin sign-in inside `MultilangNamesMigration` (rename to `CatalogShapeMigration` or extend) — same component, additional pass.

### Pass: `attachableTo: enum → array`

For each existing sub-type:
- If `attachableTo === 'device-only'` → set to `['asset']`.
- If `attachableTo === 'device-or-employee'` → set to `['asset', 'employee']`.
- If `attachableTo === null || attachableTo === undefined`:
  - When `categoryId === 'license'` → already weird; default to `['asset', 'employee']`.
  - Otherwise → seed from the category default (look up the category doc's `attachableTo`).
- If already an array → no-op.

For each existing category:
- If `attachableTo` missing → set per CATEGORY_DEFAULTS table above.
- If already an array → no-op.

The migration writes through the repository's `update` method so audit logs are emitted. The component stays idempotent because the second pass over already-upgraded docs returns `Array.isArray(attachableTo) === true` and skips.

## Permissions / role gates

No change. Configuring `attachableTo` is part of editing a Category or a Sub-type, both of which require `super_admin`.

## Acceptance criteria

- [ ] `Category` and `AssetSubtype` typedefs include `attachableTo: string[]`.
- [ ] `sanitize*Input` and `validate*Input` handle the array shape (coercion, dedupe, length ≥ 1, subset-of-category).
- [ ] `CategoryFormDialog` renders the 5-checkbox group; pre-selected from existing doc on edit, from spec defaults on create.
- [ ] `SubtypeFormDialog` renders the 5-checkbox group; pre-selected from parent category on create, from sub-type doc on edit; sub-type cannot widen the parent.
- [ ] `AssetFormDialog`'s holder picker shows only kinds in `subtype.attachableTo` and auto-selects when length === 1.
- [ ] `validateAssetInput` rejects `assignedTo.kind` not in the sub-type's `attachableTo` with `errorAssignedKindNotAllowed`.
- [ ] Migration upgrades existing sub-types from enum to array using the mapping table above; idempotent.
- [ ] Migration seeds `attachableTo` on existing categories using the defaults table; idempotent.
- [ ] Firestore rules validate the array on create/update of categories + sub-types.
- [ ] i18n keys added in ru / en / hy.
- [ ] Tests cover: domain validators, sanitizer, both dialogs, asset-form filter, migration pass, rules.

## Open questions

- **Is `'asset'` (license-attached-to-device) reachable from non-license categories?** Spec says yes, IF the super admin checks the `Device` box in a furniture category — but that's nonsensical. Current proposal: keep validation lenient (the rules permit any subset) and trust the super admin to not configure absurdities. A future guardrail could whitelist `'asset'` as license-only.
- **Branch vs Warehouse separation in the picker.** Both kinds resolve to the same `branches` collection, just filtered by `type`. Should we collapse them into one picker with a `type` filter, or keep them as two distinct kinds? Keeping distinct because the ASSIGNMENT_KINDS enum already does, and the user's mental model treats them separately.
- **Existing audit logs reference `'device-only'` / `'device-or-employee'`.** We are not rewriting audit history. The diffs in old rows stay readable but won't match new field shapes. This is acceptable; audit logs are append-only.

## Dependencies

- **Depends on:** asset-categories, asset-registry, audit-trail, MultilangNamesMigration (component to extend).
- **Depended on by:** asset-create flow, future bulk-import validation.
