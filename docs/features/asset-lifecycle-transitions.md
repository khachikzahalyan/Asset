# Asset Lifecycle Transitions

**Phase:** 1 (MVP)
**Status:** spec
**Owner agents:** domain-modeler, firebase-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §8

## Purpose & user value

An asset's status (`statusId`) doesn't change by free-form selection — it transitions through a small state machine that AMS enforces. The two essential rules:

1. **Final statuses are irreversible** (e.g., `written_off` and `lost`). Once entered, the asset stays there forever. No "undo write-off" — only a compensating new asset can be created.
2. **Assignment-coupled transitions are atomic.** Going from `in_stock` → `issued` requires a valid assignment write; going `issued` → `in_stock` requires the active assignment to close. The lifecycle engine and the assignment feature interlock.

Without this engine, an admin could accidentally write off an active asset without a return-act, or "un-write-off" something illegitimately. The engine is the contract that keeps history honest.

## In scope

- A `transitionAsset(assetId, toStatusId, options)` function in the asset repository (or a dedicated `lifecycle.js` module).
- A static **transition matrix** declaring allowed `from → to` pairs, expressed in code (not in Firestore) since it's pure business logic.
- Server-side enforcement via Firestore rules (where expressible) + transactional asset+assignment+audit writes.
- UI: status dropdowns on `/assets/:id` only show transitions allowed from the current status.
- Audit row on every transition with `{ entity: 'asset', action: 'transition', meta: { fromStatusId, toStatusId, reason? } }`.

## Out of scope

- User-defined transition matrices (Super Admin editing allowed transitions). Out of MVP — matrix lives in code.
- Reason-required transitions (e.g., must enter a "write-off reason" string). Phase 3 (`write-off-approval-workflow.md`).
- Approval workflows (two-eyes write-off). Phase 3.
- Time-based auto-transitions (e.g., warranty expiry → flag). Out of scope.

## Domain entities involved

- **Asset** — `statusId` is the state.
- **AssetStatus** — defines `isFinal` and `isAssignable` flags consulted by the engine.
- **Assignment** — closing/opening an assignment may be required for certain transitions.
- **AuditLog** — every transition writes a row.

## The transition matrix (default)

Using the seeded statuses (`in_stock`, `issued`, `under_repair`, `written_off`, `lost`):

| From \ To       | in_stock | issued | under_repair | written_off | lost |
|---|---|---|---|---|---|
| **in_stock**    | —        | ✅ (via assign) | ✅           | ✅           | ✅   |
| **issued**      | ✅ (via return) | — | ✅ (via return + repair) | ✅ (via return + write-off) | ✅ (lost while issued) |
| **under_repair**| ✅       | ✅ (via assign) | —           | ✅           | ✅   |
| **written_off** | ❌ FINAL | ❌ FINAL | ❌ FINAL | — | ❌ FINAL |
| **lost**        | ❌ FINAL | ❌ FINAL | ❌ FINAL | ✅ (admit loss is permanent) | — |

(Whether `lost → written_off` is allowed is a customer-policy question — listed as an Open question.)

The engine reads `AssetStatus.isFinal` for the *from* status; if true, all outgoing transitions are denied. So the matrix above is partly derivable from data + a couple of hard-coded special cases (assignment-coupled transitions).

## Engine algorithm

```
transitionAsset(assetId, toStatusId, options) {
  inTransaction:
    asset = read assets/{assetId}
    fromStatus = read asset_statuses/{asset.statusId}
    toStatus   = read asset_statuses/{toStatusId}

    if fromStatus.isFinal: throw 'Asset is in a final status, no transitions allowed'
    if !toStatus.isActive:  throw 'Target status is deactivated'
    if asset.currentAssignmentId && !toStatus.isAssignable && options.action != 'return':
      throw 'Active assignment must be returned before this transition'

    // Apply the change
    update asset { statusId: toStatusId, updatedAt, updatedBy }
    if options.action == 'return':
      update assignments/{asset.currentAssignmentId} { endedAt, endedBy, returnActUrl? }
      clear asset { currentAssigneeType, currentAssigneeId, currentAssignmentId }
    if options.action == 'assign':
      ... (handled by asset-assignment-and-acts feature; calls this engine internally)

    write audit_logs row { entity: 'asset', action: 'transition',
                           meta: { fromStatusId, toStatusId, reason: options.reason } }
}
```

## Key user flows

### Manual status change (e.g., `in_stock` → `under_repair`)

1. Asset Admin opens `/assets/:id` → status dropdown.
2. Dropdown shows only allowed transitions from the current status.
3. Selecting `under_repair`:
   - If the asset has an active assignment, UI offers "Return first" — clicking returns the asset, then transitions to `under_repair` in two steps. Or (Phase 2) a single combined action.
4. Engine runs the transition transactionally.
5. Audit row written with `meta.fromStatusId` and `meta.toStatusId`.

### Write-off

1. Asset Admin selects `written_off` from the dropdown.
2. UI shows a confirmation modal: "This is a final status. The asset cannot be un-written-off. Continue?"
3. If asset is currently issued, the modal forces a "Return + Write off" combined flow with both an act-return upload and a write-off reason note.
4. Engine runs the multi-write transaction.
5. Audit row.

### Return-and-issue in one swoop

Not supported in MVP — admins return then assign in two clicks. Phase 2 may add a "transfer" combined action.

## UI surfaces

- Status `<Select>` on `/assets/:id` Overview filters options through the engine's allowed-transitions list.
- "Status change" confirmation modal for transitions with side-effects (final, return-required).
- `<TransitionGuard>` helper that wraps any status-change UI.

## Firestore collections & shape

No new collections — this feature is pure business logic on top of `assets` + `assignments` + `audit_logs`.

## Rule constraints (where expressible)

A pure rules-only enforcement of the full matrix is hard. The minimum rules contribution:

```
match /assets/{assetId} {
  allow update: if (isSuperAdmin() || isAssetAdmin())
                // can't transition out of a final status
                && (request.resource.data.statusId == resource.data.statusId
                    || get(/databases/$(database)/documents/asset_statuses/$(resource.data.statusId)).data.isFinal == false)
                // can't move to a deactivated status
                && get(/databases/$(database)/documents/asset_statuses/$(request.resource.data.statusId)).data.isActive == true;
}
```

Stricter constraints (e.g., must close the assignment when going to non-assignable) live in repository code + tests; rules act as a backstop.

## Permissions / role gates

Same as `assets` updates: super_admin and asset_admin can transition; tech_admin and employee cannot. Tech Admin's Phase 2 access to technical attributes is orthogonal to status transitions.

## Open questions

- **`lost → written_off`?** Some customers consider "lost" terminal forever; others want a "lost and now officially written off" path. Default proposal: allow `lost → written_off` (admit loss became permanent). Confirm with customer.
- **`written_off → in_stock` recovery.** Spec says final means final. If a customer claims "we wrote it off then found it" — answer: create a new asset in `in_stock`, audit-log the rationale. Don't relax the final rule.
- **Reason text on transitions.** Free-text reason note required for write-off and lost? Default proposal: required for `written_off` and `lost` only; optional for others.
- **Combined "transfer" action.** Useful but Phase 2.

## Acceptance criteria

- [ ] `transitionAsset(assetId, toStatusId, options)` exists in the asset repository (or `src/lib/asset/lifecycle.js`).
- [ ] Engine reads asset, current status, target status in a transaction; rejects final-status outgoing transitions.
- [ ] Engine rejects transition to deactivated status.
- [ ] Engine forces assignment close when transitioning issued → non-assignable.
- [ ] UI status `<Select>` on asset detail page only shows transitions allowed from the current status.
- [ ] Final-status transition shows a confirmation modal with irreversibility warning.
- [ ] Every transition writes an audit row with `meta.fromStatusId` and `meta.toStatusId`.
- [ ] Rule test verifies cannot edit `statusId` away from a final status.
- [ ] Rule test verifies cannot transition to a deactivated status.
- [ ] Unit tests cover the matrix above (each from/to pair).

## Dependencies

- **Depends on:** asset-registry, asset-status-catalog, asset-assignment-and-acts, audit-trail.
- **Depended on by:** dashboards (counts by status), search-and-filters (status filter chips), write-off-approval-workflow (Phase 3).
