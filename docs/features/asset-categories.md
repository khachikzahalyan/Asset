# Asset Categories

**Phase:** 1 (MVP)
**Status:** spec
**Owner agents:** domain-modeler, firebase-engineer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §5, §7

## Purpose & user value

A **Category** classifies an asset (Laptop, Monitor, Phone, Printer, etc.) and — critically — owns the **inventory-code prefix** that becomes part of every asset's `inventoryCode` (e.g., laptops get `450/...`, phones get `300/...`). Without categories, AMS cannot generate inventory codes deterministically.

Super Admin manages categories and their prefixes. Once a category has assets in production, its prefix becomes effectively immutable (changing it would invalidate existing codes). The catalog also defines per-category technical attribute schemas (Phase 2).

## In scope

- A `categories` Firestore collection.
- The Category entity: code identifier (English), `name` (multi-language Tier-2), `inventoryCodePrefix` (English/digits, immutable after first asset), `description?` (multi-language), `isActive`, `createdAt`, `updatedAt`.
- A counter document per category for sequential inventory-number assignment (`category_counters/{categoryId}.next`).
- A `/settings/categories` page (Super-Admin-only).
- Validation: prefix matches `^[A-Z0-9]+$` (uppercase letters/digits only, no slash).
- Audit row on every write.

## Out of scope

- Per-category attribute schema and per-asset attribute values — Phase 2 (`dynamic-technical-attributes.md`).
- Category icons / images.
- Category hierarchy (parent/child).
- Per-category permission scoping.
- Renaming the prefix after assets exist (system blocks).

## Domain entities involved

- **Category** — primary entity.
- **CategoryCounter** — sibling collection (or `categories/{id}/counter` subdoc) used to atomically reserve the next inventory number.
- **Asset** — references a category via `categoryId`; `inventoryCode` is composed from the category prefix + assigned number.

## Key user flows

### Creating a category

1. Super Admin opens `/settings/categories` → "Add category".
2. Form fields:
   - `name` — `<MultiLangInput>` (Tier 2)
   - `description` — `<MultiLangInput>` (Tier 2, optional)
   - `inventoryCodePrefix` — plain `<Input>` (Tier 4, validated `^[A-Z0-9]+$`, e.g., `450`, `LAP`, `MON`)
3. Validate the prefix isn't already used by another category.
4. On submit: doc created with `isActive: true`. Counter doc initialized at `next: 1`. Audit row written.

### Editing a category

1. Edit `name`, `description`, `isActive` freely.
2. **`inventoryCodePrefix` is editable only if no assets reference this category.** UI checks live; rule enforces (`if request.resource.data.inventoryCodePrefix == resource.data.inventoryCodePrefix || /* asset count is zero */`). The "asset count is zero" check is hard to do in rules; defer enforcement to a Cloud Function for MVP, or just disable the field client-side and trust the admin (since it's Super-Admin-only).

### Deactivating a category

1. Cannot deactivate while assets reference this category. Block with clear error.
2. If clear, set `isActive: false`. Audit row.

### Generating a new inventory code (used by asset-registry on asset create)

1. Repository reads `category_counters/{categoryId}` in a transaction.
2. Increments `.next` by 1, writes back.
3. Composes `inventoryCode` as `${category.inventoryCodePrefix}/${zeroPad(counter.next, 6)}` (or no zero-pad — see Open questions).
4. Asset doc is written with this code. Audit row.

The transactional read+write guarantees uniqueness even under concurrent asset creates.

## UI surfaces

- `/settings/categories` — `CategoryListPage` with Super-Admin-only gate.
- "Add category" modal / inline form.
- `<CategorySelect>` reused by asset-create form.

shadcn/ui primitives: `Table`, `Dialog`, `Form`, `Input`, `Badge`.

## Firestore collections & shape

### `categories/{categoryId}`

```jsdoc
/**
 * @typedef {Object} Category
 * @property {string} categoryId
 * @property {{ ru: string, en: string, hy: string }} name
 * @property {{ ru: string, en: string, hy: string }|null} description
 * @property {string} inventoryCodePrefix         // ^[A-Z0-9]+$, Tier 4, immutable after first asset
 * @property {boolean} isActive
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */
```

### `category_counters/{categoryId}`

```jsdoc
/**
 * @typedef {Object} CategoryCounter
 * @property {number} next                       // monotonically increasing; never decremented
 * @property {import('firebase/firestore').Timestamp} updatedAt
 */
```

(Doc id matches the category id for a clean 1:1 lookup.)

### Indexes

- Single-field on `inventoryCodePrefix` (auto, used by uniqueness check).
- Single-field on `isActive` (auto).

### Rule sketch

```
match /categories/{categoryId} {
  allow read: if isAdmin();
  allow create, update: if isSuperAdmin()
                        && request.resource.data.name.keys().hasOnly(['ru','en','hy'])
                        && request.resource.data.inventoryCodePrefix.matches('^[A-Z0-9]+

);
  allow delete: if false;
}
match /category_counters/{categoryId} {
  allow read: if isAdmin();
  allow write: if isAdmin()
               && request.resource.data.next == resource.data.next + 1; // monotonic
}
```

The counter `write` rule enforces strictly-monotonic increment so a buggy client cannot reset it.

## Storage paths

- None.

## Permissions / role gates

| Action | super_admin | asset_admin | tech_admin | employee |
|---|---|---|---|---|
| Read categories | ✅ | ✅ | ✅ | ❌ |
| Create / update / deactivate | ✅ | ❌ | ❌ | ❌ |
| Increment counter (asset create) | ✅ | ✅ | ✅ | ❌ |

## Open questions

- **Zero-padding the inventory number.** Spec example `450/302042` shows 6 digits with no padding; another example `450/000123` shows zero-padding. Default proposal: **no zero-padding**, raw digits — reads cleaner, matches the most concrete spec example. Confirm with customer.
- **Prefix collisions across categories.** Enforced by uniqueness check at create time. What if a customer wants to merge two categories later? Out of scope for MVP — would need a migration script.
- **Counter on category deactivation.** Counter is preserved (even if category is deactivated, codes already issued must remain valid). Doc never deleted.

## Acceptance criteria

- [ ] `categories` and `category_counters` collections exist with the typedefs above.
- [ ] Super Admin can create, edit, deactivate categories through `/settings/categories`.
- [ ] Asset Admin and Tech Admin can read; only the asset-create flow writes the counter.
- [ ] Inventory-code prefix validated as `^[A-Z0-9]+

 (uppercase letters/digits only).
- [ ] Inventory-code prefix cannot be changed once assets reference the category (UI-disabled in MVP).
- [ ] Concurrent asset creates produce unique inventory codes (counter is transactional).
- [ ] Deactivating a category with assets is blocked.
- [ ] Every write produces an audit-log row.
- [ ] Category name and description are multi-language.

## Dependencies

- **Depends on:** roles-and-permissions, internationalization, audit-trail.
- **Depended on by:** asset-registry (every asset has a category and gets its inventory code from the category counter).
