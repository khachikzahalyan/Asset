# Search & Filters

**Phase:** 1 (MVP)
**Status:** spec
**Owner agents:** firebase-engineer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §7

## Purpose & user value

The asset list at `/assets` is the most-used screen. Without a fast and predictable search-and-filter experience, admins drown in the registry. MVP delivers:

- **Search box** — substring match across inventory code, name, brand, model, serial number, IMEI.
- **Filter chips** — branch, category, status, assignee type (employee/department/unassigned), active/archived.
- **Reset filters** action.
- **URL-encoded state** — filters and search query persist in the URL so admins can deep-link and use back-button.

## In scope

- A `<FilterBar>` component above the asset table.
- A `useAssetFilters()` hook that holds filter state, syncs to URL search params, and produces a Firestore query / client-side filter predicate.
- Search across the indexed fields with **prefix matching** (Firestore `>=` / `<` query); full-text search via Algolia/Typesense is Phase 2.
- Server-side filtering for branch, category, status, assignee (these match composite indexes defined in `asset-registry.md`).
- Client-side filtering for the search box (since Firestore can only prefix-match one field per query).
- Pagination ("Load more" cursor-based).

## Out of scope

- Saved filter views (e.g., "My filter: laptops in Yerevan branch under repair"). Phase 2.
- Full-text search (Algolia / Typesense / Meilisearch). Phase 2.
- Cross-entity search (employees, branches). Phase 2 — global command palette.
- Bulk actions on filtered results (select all → assign / write off). Phase 2.

## Key user flows

### Searching by inventory code

1. Admin types `450/302042` → instant client-side narrow.
2. URL updates: `/assets?q=450%2F302042`.
3. If no result locally, request fetches a fresh page from Firestore with a prefix query.

### Filtering by branch + status

1. Admin clicks "Yerevan" branch chip → `branchId = 'yerevan-branch-id'` added to filter set.
2. Clicks "Under repair" status chip → `statusId = 'under_repair-id'` added.
3. Firestore query rebuilds: `where('branchId', '==', ...).where('statusId', '==', ...)`.
4. URL: `/assets?branch=yerevan-branch-id&status=under_repair-id`.
5. Pagination cursor reset.

### Resetting

"Clear filters" button removes all filter params. URL becomes `/assets`.

## UI surfaces

- `<FilterBar />` above `/assets` table:
  - `<SearchInput />` (debounced 250ms)
  - `<BranchFilterChip />`, `<CategoryFilterChip />`, `<StatusFilterChip />`, `<AssigneeFilterChip />`, `<ActiveFilterChip />`
  - `<ClearFiltersButton />` (only visible if any filter is active)
- `<AssetTable />` reads filter state from the hook and renders.
- `<LoadMoreButton />` at table footer.

shadcn/ui primitives: `Input`, `Badge` (used as filter chips), `Button`, `Popover`, `Command` (for combobox-style filter pickers).

## Firestore queries

The asset repository exposes:

```js
async function listAssets({ branchId, categoryId, statusId, assigneeType, isActive, cursorDoc, pageSize = 50 }) {
  let q = query(collection(db, 'assets'));
  if (branchId)     q = query(q, where('branchId', '==', branchId));
  if (categoryId)   q = query(q, where('categoryId', '==', categoryId));
  if (statusId)     q = query(q, where('statusId', '==', statusId));
  if (assigneeType) q = query(q, where('currentAssigneeType', '==', assigneeType));
  if (isActive != null) q = query(q, where('isActive', '==', isActive));
  q = query(q, orderBy('updatedAt', 'desc'), limit(pageSize));
  if (cursorDoc) q = query(q, startAfter(cursorDoc));
  return getDocs(q);
}
```

Indexes already declared in `asset-registry.md`.

For the search box, a separate path:

```js
async function searchAssetsByPrefix(field, prefix, pageSize = 25) {
  // field ∈ ['inventoryCode','brand','model','serialNumber','imei','name'] — index each as needed
  const q = query(
    collection(db, 'assets'),
    where(field, '>=', prefix),
    where(field, '<', prefix + ''),
    limit(pageSize)
  );
  return getDocs(q);
}
```

The search component fires this for each candidate field on debounce, merges and dedups results, then displays.

## URL search-param schema

| Param | Meaning |
|---|---|
| `q` | search query string |
| `branch` | branchId |
| `category` | categoryId |
| `status` | statusId |
| `assignee` | `'employee' \| 'department' \| 'none'` |
| `active` | `'true' \| 'false'` |
| `cursor` | last-doc id for pagination (opaque) |

## Permissions / role gates

Filtering and search inherit the asset list's role gates (admins read all, employees see only their own assignments via `/me`). No new gates here.

## Open questions

- **Search performance.** Prefix queries on six fields with `||` semantics is six round trips. For ~5000-asset deployments this is fine; for larger, Phase 2 introduces Algolia/Typesense. Confirm initial customer scale.
- **Localized name search.** Asset `name` is Tier 3 (single string), so no locale issue. But categories and statuses have multi-language `name` — search by status name is filter-chip only (not free-text), so no problem.
- **Filter combinatorics and Firestore index limits.** Composite indexes are scoped per filter combination. Listing five common combinations (branch+status, branch+category, status+assignee, etc.) is enough; rare combinations may require a manual index when the dev console flags it.
- **Sort options.** Default is `updatedAt desc`. Allow user-chosen sort (createdAt asc, inventoryCode asc)? Phase 2.

## Acceptance criteria

- [ ] `/assets` shows a search box that searches across inventoryCode, name, brand, model, serial, IMEI.
- [ ] `/assets` shows filter chips for branch, category, status, assignee, active.
- [ ] Filter state syncs to URL search params; refresh and back-button preserve state.
- [ ] "Clear filters" button removes all params.
- [ ] Pagination is cursor-based, server-side, and respects filter constraints.
- [ ] Composite indexes defined for the common filter combinations (declared in `firestore.indexes.json`).
- [ ] Search debounce is 250ms.
- [ ] Empty state shows a localized "No assets match" message.
- [ ] Loading state shows a skeleton table.

## Dependencies

- **Depends on:** asset-registry, branches, asset-categories, asset-status-catalog, employees, departments, internationalization.
- **Depended on by:** dashboards (which embed filtered asset queries).
