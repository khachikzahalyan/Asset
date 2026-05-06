# Dashboards

**Phase:** 1 (MVP)
**Status:** spec
**Owner agents:** react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §10

## Purpose & user value

When an admin logs in, the first thing they see should answer "what's the state of the fleet today?" without manually filtering tables. The MVP dashboards are intentionally lightweight — three to five tiles + a recent-activity feed — because deep analytics belong in Phase 2 reports. Each role sees a slightly different layout reflecting their responsibilities.

## In scope

- A `/dashboard` route, role-aware.
- Per-role dashboard layouts:
  - **Super Admin** — overall fleet snapshot + recent audit activity + system health hints.
  - **Asset Admin** — operational tiles (assets in stock, currently issued, written off this month) + recent assignments.
  - **Tech Admin** — assets in `under_repair` + (Phase 2 placeholder) repairs needing attention.
- Tiles are simple count cards with a click-through to a filtered `/assets` view.
- Recent-activity feed reads from `audit_logs` (last 10–25 rows visible to the role).

## Out of scope

- Charts (bar, pie, time-series). Phase 2 reports.
- Customizable widgets / drag-and-drop layout. Phase 2.
- Branch-scoped tiles for an Asset Admin scoped to one branch. (Asset Admin sees all branches in MVP per `roles-and-permissions.md`.)
- Real-time aggregation (Firestore aggregation queries) — MVP uses simple count queries (`getCountFromServer`).
- Alert tiles (warranty expiring, repair cost > purchase). Phase 2.

## Domain entities involved

Read-only consumer of: assets, assignments, audit_logs, employees, branches.

## Tile catalog (default)

| Tile | Audience | Query | Click-through |
|---|---|---|---|
| Total assets | super_admin, asset_admin | count of `assets` where `isActive == true` | `/assets?active=true` |
| In stock | super_admin, asset_admin | `statusId == in_stock` | `/assets?status=in_stock` |
| Issued | super_admin, asset_admin | `statusId == issued` | `/assets?status=issued` |
| Under repair | tech_admin, super_admin | `statusId == under_repair` | `/assets?status=under_repair` |
| Written off (all-time) | super_admin | `statusId == written_off` | `/assets?status=written_off` |
| Active employees | super_admin, asset_admin | count of `employees` where `isActive == true` | `/employees?active=true` |
| Branches | super_admin | count of `branches` where `isActive == true` | `/branches` |

Tile counts use `getCountFromServer(query)` (cheaper than fetching all rows).

## Per-role layout

### Super Admin

```
[Total assets] [In stock] [Issued] [Written off]
[Active employees] [Branches]
[Recent activity feed — last 25 audit_logs rows, all entities]
```

### Asset Admin

```
[Total assets] [In stock] [Issued]
[Active employees]
[Recent activity feed — last 15 audit_logs rows for entities {asset, assignment, employee}]
```

### Tech Admin

```
[Under repair] [Total assets]
[(Phase 2 placeholder: Repairs awaiting parts)]
[Recent activity feed — last 10 audit_logs rows for entity 'asset' action 'transition']
```

## Key user flows

### Initial render

1. `<RequireAuth>` resolves; role known.
2. Dashboard component picks layout by role.
3. Tile components fire `getCountFromServer` queries in parallel.
4. Activity feed component fires a single `getDocs(audit_logs)` query with role-appropriate filters.
5. Loading skeletons render until data arrives.

### Click-through

Click a tile → navigate to `/assets?...` (or `/employees`, `/branches`) with pre-applied filter params. URL match is the same scheme as `search-and-filters.md`.

### Refresh

Page-load only; no live subscription on tiles in MVP (would require many onSnapshot listeners with extra cost). Manual refresh button available.

## UI surfaces

- `/dashboard` — `DashboardPage`, role-routed internally.
- `<TileCard label={...} count={...} loading={...} href={...} />`
- `<RecentActivityFeed entityFilter={...} actionFilter={...} limit={...} />`
- shadcn/ui: `Card`, `Skeleton`, `Badge`, `Button`.

Mobile responsiveness: tiles stack vertically below 768px; activity feed becomes a scrollable list.

## Firestore queries

Tile queries use `getCountFromServer(query)`:

```js
const inStockCount = await getCountFromServer(
  query(collection(db, 'assets'), where('statusId','==', inStockStatusId))
);
```

Activity feed query:

```js
const recent = await getDocs(
  query(collection(db, 'audit_logs'), orderBy('at','desc'), limit(25))
);
```

For Asset Admin / Tech Admin scoping, add `where('entity','in', [...])`. Composite index `(entity ASC, at DESC)` already declared in `audit-trail.md`.

## Permissions / role gates

`/dashboard` is reachable by `super_admin`, `asset_admin`, `tech_admin`. Employees redirect to `/me`. The role-specific layout enforces what each role sees; underlying queries respect the existing read rules (no extra rules needed).

## Open questions

- **Tile counts vs. raw queries.** `getCountFromServer` is cheap on aggregations but each tile = one network round-trip. 5 tiles = 5 round-trips on every dashboard load. Acceptable; cache if it becomes a UX issue.
- **Real-time activity feed.** Subscribe via `onSnapshot` for live feed? Default: no — refresh on navigation only.
- **Branch filter at the dashboard level.** Should an Asset Admin be able to scope the dashboard to one branch? Default: no in MVP (single global view); they can use the filter chips on `/assets` for branch-specific views.
- **Empty / fresh-deployment state.** First-time deploy with zero assets — tiles show 0. Activity feed shows the seed audit rows from system bootstrap. Fine; no special handling needed.

## Acceptance criteria

- [ ] `/dashboard` is reachable by super_admin, asset_admin, tech_admin.
- [ ] Employees visiting `/dashboard` are redirected to `/me`.
- [ ] Super Admin sees the fleet-overview tile set + 25-row activity feed.
- [ ] Asset Admin sees operational tiles + 15-row activity feed scoped to {asset, assignment, employee}.
- [ ] Tech Admin sees repair-focused tiles + 10-row feed scoped to `entity:'asset' action:'transition'`.
- [ ] Tile counts use `getCountFromServer` (not full fetches).
- [ ] Each tile is clickable and navigates to the corresponding pre-filtered list.
- [ ] Tiles show a skeleton while loading.
- [ ] Mobile layout stacks tiles vertically below 768px.
- [ ] Activity feed renders localized status / category labels via `localize()`.

## Dependencies

- **Depends on:** roles-and-permissions, asset-registry, asset-status-catalog, asset-lifecycle-transitions, audit-trail, employees, branches, internationalization.
- **Depended on by:** none.
