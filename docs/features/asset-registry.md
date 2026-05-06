# Asset Registry

**Phase:** 1 (MVP)
**Status:** spec
**Owner agents:** domain-modeler, firebase-engineer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §5, §7, §8

## Purpose & user value

The **Asset Registry** is the heart of AMS: the canonical record of every physical or licensed asset the company owns — laptops, phones, monitors, printers, etc. Each asset has an auto-generated **inventory code** (e.g., `450/302042`), a category, a status, a current branch, and (when assigned) a current assignee. Asset Admin and Super Admin manage the registry; Tech Admin reads (Phase 2 will let Tech Admin edit technical attributes); Employees see only their own assignments via `/me`.

## In scope

- An `assets` Firestore collection.
- The Asset entity: `inventoryCode` (auto-generated, immutable), `categoryId`, `statusId`, `branchId`, `currentAssigneeType` (`'employee' | 'department' | null`), `currentAssigneeId`, `name` (Tier-3 free text), `brand`, `model` (Tier-4 English-only), `serialNumber?`, `imei?`, `purchaseDate?`, `purchasePrice?`, `currency?`, `warrantyUntil?`, `notes?`, `isActive`, audit fields.
- A `/assets` list page (table) with search and filters.
- A `/assets/:id` detail page with summary card, technical-attributes section (Phase 2 placeholder), assignment widget, history tab.
- A standard create/edit form.
- Inventory-code auto-generation via the category counter (transactional).
- Audit row on every write.
- Soft-archive (`isActive: false`) for assets that should be hidden from default lists but preserved (rare in MVP — typically use a final status like `written_off` instead).

## Out of scope

- Per-asset attribute schema (RAM, SSD, etc.) — Phase 2 (`dynamic-technical-attributes.md`).
- Bulk creation — Phase 2 (`purchase-batches.md`).
- Repair tracking — Phase 2 (`repairs-and-cost-vs-purchase-signal.md`).
- License records bound to asset — Phase 2 (`licenses-and-software.md`).
- Asset photos — could fit MVP but deferred unless customer asks; Phase 2 by default.
- Excel import — Phase 2.

## Domain entities involved

- **Asset** — primary entity.
- **Category** — every asset has one; provides the inventory-code prefix.
- **AssetStatus** — every asset has one.
- **Branch** — every asset has a current physical location.
- **Employee / Department** — current assignee (optional).
- **Assignment** — separate collection that records the assignment lifecycle (start/end + act-of-acceptance scan); see `asset-assignment-and-acts.md`. The Asset doc carries denormalized `currentAssignee*` fields for fast list rendering.
- **AuditLog** — every write writes a row.

## Key user flows

### Creating a single asset

1. Asset Admin opens `/assets` → "Add asset".
2. Form fields:
   - `categoryId` — `<CategorySelect>` (required) → triggers preview of the next inventory code.
   - `name` — Tier-3 free text (e.g., "MacBook Pro 14"")
   - `brand`, `model` — Tier-4 English-only (validated `^[\x20-\x7E]+

)
   - `serialNumber`, `imei` — Tier-4, optional
   - `branchId` — `<BranchSelect>` (required, defaults to the central warehouse)
   - `statusId` — `<StatusSelect>`, defaulted to `in_stock` (only assignable + non-final shown for new assets)
   - `purchaseDate`, `purchasePrice`, `currency`, `warrantyUntil` — optional, Phase 1 stores them but full reporting is Phase 2
   - `notes` — Tier-3 free text
3. On submit:
   - Repository runs a transaction:
     - Reads `category_counters/{categoryId}.next`
     - Composes `inventoryCode = ${prefix}/${next}`
     - Increments counter
     - Writes the asset doc with the generated code
     - Writes the audit row
4. Redirect to `/assets/:id`.

### Editing an asset

1. Asset Admin opens `/assets/:id` → "Edit".
2. **`inventoryCode` is read-only** (immutable post-creation).
3. Other fields editable per the role matrix:
   - Asset Admin: all fields except `inventoryCode`, status changes go through the lifecycle engine (not a free-form select).
   - Tech Admin: read-only in MVP (Phase 2 will allow technical-attribute edits).
4. Submit → patch + audit row.

### Listing assets

`/assets` shows table:
- Columns: inventory code, name, category (localized), status (localized badge), branch (localized), current assignee (employee or department, localized), updated at.
- Search box: matches inventory code, name, brand, model, serial number, IMEI.
- Filter chips: branch, category, status, assignee type, assigned/unassigned.
- Pagination or infinite scroll.

### Viewing asset detail

`/assets/:id` tabs:
- **Overview** — all fields, plus assignment widget (assign/return — see `asset-assignment-and-acts.md`).
- **Technical** — Phase 2 placeholder.
- **History** — audit-trail entity-history view (see `audit-trail.md`).

## UI surfaces

- `/assets` — `AssetListPage` with table + filter bar (see `search-and-filters.md`).
- `/assets/:id` — `AssetDetailPage` with tabs.
- "Add asset" — modal or dedicated page.
- `<AssetSummaryCard asset={...} />` reused by detail page and assignment confirmation modals.

shadcn/ui primitives: `Table`, `Dialog`, `Form`, `Input`, `Select`, `Badge`, `Tabs`, `Card`, `Separator`.

## Firestore collections & shape

### `assets/{assetId}`

```jsdoc
/**
 * @typedef {Object} Asset
 * @property {string} assetId
 * @property {string} inventoryCode            // ^[A-Z0-9]+/[A-Z0-9]+

 immutable
 * @property {string} categoryId
 * @property {string} statusId
 * @property {string} branchId
 * @property {'employee'|'department'|null} currentAssigneeType
 * @property {string|null} currentAssigneeId
 * @property {string|null} currentAssignmentId   // ref to assignments/{id} for the active record
 * @property {string} name                        // Tier 3
 * @property {string} brand                       // Tier 4 ASCII
 * @property {string} model                       // Tier 4 ASCII
 * @property {string|null} serialNumber          // Tier 4
 * @property {string|null} imei                  // Tier 4
 * @property {import('firebase/firestore').Timestamp|null} purchaseDate
 * @property {number|null} purchasePrice
 * @property {string|null} currency               // ISO-4217 e.g., 'AMD'
 * @property {import('firebase/firestore').Timestamp|null} warrantyUntil
 * @property {string|null} notes                  // Tier 3
 * @property {boolean} isActive
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} createdBy
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy
 */
```

### Indexes

- Single-field on `inventoryCode` (auto, used by uniqueness check / search).
- Composite `(branchId ASC, statusId ASC, updatedAt DESC)` — branch-scoped lists.
- Composite `(categoryId ASC, statusId ASC, updatedAt DESC)` — category lists.
- Composite `(currentAssigneeType ASC, currentAssigneeId ASC)` — "what assets does X have?"
- Composite `(statusId ASC, isActive ASC, updatedAt DESC)` — dashboard tiles.
- Search index for `name`, `brand`, `model`, `serialNumber`, `imei` is implemented client-side via prefix matching for MVP; full-text via Algolia/Typesense is Phase 2.

### Rule sketch

```
match /assets/{assetId} {
  allow read: if isAdmin()
              || (isEmployee()
                  && resource.data.currentAssigneeType == 'employee'
                  && resource.data.currentAssigneeId == get(/databases/$(database)/documents/users/$(request.auth.uid)).data.employeeId);
  allow create, update: if (isSuperAdmin() || isAssetAdmin())
                        && request.resource.data.inventoryCode.matches('^[A-Z0-9]+/[A-Z0-9]+

)
                        // inventoryCode immutable on update
                        && (resource == null || request.resource.data.inventoryCode == resource.data.inventoryCode);
  allow delete: if false;     // soft-archive only
}
```

The lifecycle engine (`asset-lifecycle-transitions.md`) adds extra constraints on `statusId` transitions.

## Storage paths

- None for the asset itself in MVP. Acts of acceptance live at `acts/{assetId}/{actId}.{ext}` — see `asset-assignment-and-acts.md`.

## Permissions / role gates

| Action | super_admin | asset_admin | tech_admin | employee |
|---|---|---|---|---|
| Read all assets | ✅ | ✅ | ✅ | ❌ |
| Read own-assigned assets | ✅ | ✅ | ✅ | ✅ (via `/me`) |
| Create asset | ✅ | ✅ | ❌ | ❌ |
| Update asset (non-technical) | ✅ | ✅ | ❌ | ❌ |
| Update asset (technical attributes) | ✅ | ✅ | ✅ Phase 2 | ❌ |
| Update `statusId` (via lifecycle engine) | ✅ | ✅ | ❌ | ❌ |
| Delete | ❌ | ❌ | ❌ | ❌ |

## Open questions

- **Inventory-code immutability under category change.** If an admin changes an asset's category, the prefix would mismatch. Default: don't allow `categoryId` change in MVP (UI-disabled). If forced, treat as deactivate-old + create-new.
- **Asset photos in MVP?** Spec mentions photos in passing. Default: defer to Phase 2 unless customer asks.
- **Currency default.** Most likely `AMD` for the placeholder customer. Default per-customer in `/settings/general` (Phase 1 picks a single tenant currency).
- **Assignment denormalization vs source-of-truth.** `Asset.currentAssignee*` is denormalized for fast list rendering; the canonical assignment record is in `assignments`. Risk: drift if a write updates one without the other. Mitigation: assignment repository writes both atomically in a transaction.

## Acceptance criteria

- [ ] `assets` collection with the typedef above.
- [ ] Asset Admin and Super Admin can create assets through `/assets`; the inventory code is auto-generated transactionally and is unique.
- [ ] Inventory code immutable post-creation (UI-disabled and rule-enforced).
- [ ] Brand / model / serial / IMEI validated as ASCII-only (Tier 4).
- [ ] Status changes go through the lifecycle engine (not a free-form select).
- [ ] List page supports search by inventory code, name, brand, model, serial, IMEI.
- [ ] Filter bar supports branch, category, status, assignee type filters.
- [ ] Asset detail page shows summary card, history tab, assignment widget.
- [ ] Employees can read only their own currently-assigned assets (rule-enforced).
- [ ] Concurrent asset creates produce unique codes (transaction test).
- [ ] Every write produces an audit-log row.
- [ ] Tech Admin is read-only on assets in MVP.

## Dependencies

- **Depends on:** branches, employees, departments, asset-categories, asset-status-catalog, audit-trail, roles-and-permissions, internationalization.
- **Depended on by:** asset-assignment-and-acts, asset-lifecycle-transitions, search-and-filters, employee-self-service, dashboards.
