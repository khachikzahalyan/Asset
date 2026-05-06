# Asset Status Catalog

**Phase:** 1 (MVP)
**Status:** spec
**Owner agents:** domain-modeler, firebase-engineer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §5, §8

## Purpose & user value

The **Status Catalog** is the Super-Admin-managed list of states an asset can be in: *In stock*, *Issued*, *Under repair*, *Written off*, *Lost*, etc. Each status carries a name (multi-language Tier-2), a color (for badges), and **two flags that drive the lifecycle engine**:

- `isFinal: boolean` — once an asset enters a final status, it cannot leave (e.g., "Written off"). The lifecycle feature enforces this irreversibility.
- `isAssignable: boolean` — whether an asset in this status can hold an active assignment to an employee/department. Returning to "In stock" must clear assignments.

The catalog drives the dropdowns in asset edit forms, the filter chips on the asset list, the badge colors throughout the UI, and the lifecycle-transition validator.

## In scope

- An `asset_statuses` Firestore collection.
- The AssetStatus entity: code identifier (English), `name` (multi-language Tier-2), `color` (hex string), `isFinal`, `isAssignable`, `sortOrder`, `isActive`, `createdAt`, `updatedAt`.
- A `/settings/statuses` page (Super-Admin-only).
- Validation: cannot deactivate a status that's currently assigned to any asset; cannot change `isFinal: false → true` on a status with active assets in it (would lock them).
- Audit row on every write.
- Seed defaults: at minimum `in_stock` (assignable, non-final), `issued` (assignable, non-final), `under_repair` (non-assignable, non-final), `written_off` (non-assignable, final), `lost` (non-assignable, final).

## Out of scope

- Status workflow rules (which status can transition to which) — covered by `asset-lifecycle-transitions.md` Phase 1.
- Per-status notification triggers — Phase 2.
- Per-status custom forms (e.g., requiring a reason on write-off) — Phase 3 may add a "transition reason" prompt.
- Status icons.

## Domain entities involved

- **AssetStatus** — primary entity.
- **Asset** — references a status via `statusId`. `Asset.statusId` cannot point to a deactivated or non-existent status.
- **Assignment** — only allowed when the asset's status has `isAssignable: true`.

## Key user flows

### Seeding defaults (one-time, deploy seed script)

The deploy seed script writes the 5 default statuses if `asset_statuses` is empty. See `data-migration-engineer` for seed script.

### Creating a status (Super Admin)

1. Super Admin opens `/settings/statuses` → "Add status".
2. Form fields:
   - `name` — `<MultiLangInput>` (Tier 2, all 3 locales required)
   - `color` — color picker → hex string (e.g., `#16a34a` for green)
   - `isFinal` — checkbox
   - `isAssignable` — checkbox
   - `sortOrder` — number, controls display order in dropdowns/lists
3. On submit: doc created with `isActive: true`. Audit row written.

### Editing a status

1. `name`, `color`, `sortOrder`, `isAssignable` editable.
2. **`isFinal` is one-way:** can flip `false → true` only if no asset currently sits in this status (would otherwise trap them); cannot flip `true → false` ever (existing final-status assets would suddenly become editable, breaking audit assumptions).
3. Audit row captures the diff.

### Deactivating a status

1. Cannot deactivate while any asset has `statusId == this`. Block with a clear error showing the count.
2. If clear, set `isActive: false`. Audit row.

### Reading statuses (any admin)

`/settings/statuses` shows table sorted by `sortOrder`. Columns: name (localized), color swatch, `isFinal`, `isAssignable`, asset count, active/inactive.

## UI surfaces

- `/settings/statuses` — `StatusListPage` with Super-Admin-only gate.
- `<StatusBadge status={status} />` — reusable badge with the status color and localized name; used everywhere an asset's status is displayed.
- `<StatusSelect>` reused by asset edit form (filtered by `isActive` and by lifecycle-engine allowed transitions).

shadcn/ui primitives: `Table`, `Dialog`, `Form`, `Input`, `Checkbox`, `Badge` (custom-styled with the status's hex color).

## Firestore collections & shape

### `asset_statuses/{statusId}`

```jsdoc
/**
 * @typedef {Object} AssetStatus
 * @property {string} statusId
 * @property {{ ru: string, en: string, hy: string }} name
 * @property {string} color                  // hex e.g., '#16a34a', Tier 4
 * @property {boolean} isFinal
 * @property {boolean} isAssignable
 * @property {number} sortOrder              // smaller first
 * @property {boolean} isActive
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */
```

### Indexes

- Single-field on `isActive` (auto).
- Single-field on `sortOrder` (auto).

### Rule sketch

```
match /asset_statuses/{statusId} {
  allow read: if isAdmin();
  allow create: if isSuperAdmin()
                && request.resource.data.name.keys().hasOnly(['ru','en','hy'])
                && request.resource.data.color.matches('^#[0-9A-Fa-f]{6}

);
  allow update: if isSuperAdmin()
                // isFinal can only flip false → true
                && (request.resource.data.isFinal == resource.data.isFinal
                    || (resource.data.isFinal == false && request.resource.data.isFinal == true));
  allow delete: if false;
}
```

(The "no asset is in this status" check for `isFinal` flip and for deactivation cannot be expressed in rules; UI enforces, plus a Cloud Function gate is recommended in Phase 2.)

## Storage paths

- None.

## Permissions / role gates

| Action | super_admin | asset_admin | tech_admin | employee |
|---|---|---|---|---|
| Read statuses | ✅ | ✅ | ✅ | ❌ (employees see localized status name on their assigned assets via `/me`) |
| Create / update / deactivate | ✅ | ❌ | ❌ | ❌ |

## Open questions

- **Default status set.** Confirm the 5 seeded defaults are sufficient: `in_stock`, `issued`, `under_repair`, `written_off`, `lost`. Customer may want additions like `reserved`, `in_transit` — they can add freely via the catalog.
- **Status code identifiers.** Are these Russian-style strings (`v_remonte`) or English (`under_repair`)? Project rule: identifiers in English. Localization lives in `name.{ru,en,hy}`.
- **Color picker UX.** Native `<input type="color">` works but ugly; could use a curated palette of 12 colors. Default proposal: native input + presets.

## Acceptance criteria

- [ ] `asset_statuses` collection with the typedef above.
- [ ] Seed script creates the 5 default statuses on first deploy if collection is empty.
- [ ] Super Admin can create, edit, deactivate statuses through `/settings/statuses`.
- [ ] Asset Admin and Tech Admin can read; cannot write.
- [ ] `isFinal` cannot flip `true → false` (rule enforces).
- [ ] Status with assets cannot be deactivated (UI enforces with clear error).
- [ ] `<StatusBadge>` renders the status with its color and localized name.
- [ ] Every write produces an audit-log row.

## Dependencies

- **Depends on:** roles-and-permissions, internationalization, audit-trail.
- **Depended on by:** asset-registry, asset-lifecycle-transitions, asset-assignment-and-acts (assignments only allowed on `isAssignable: true` statuses).
