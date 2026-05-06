# Inventory Walk

**Phase:** 3
**Status:** stub
**Owner agents:** firebase-engineer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §17

## Purpose & user value

Periodic inventory audits ("walk the floor and confirm every asset is where AMS says it is") catch loss, theft, and bookkeeping drift. Phase 3 adds a **branch-scoped checklist session**:

1. Asset Admin starts a new walk for a branch → AMS materializes a checklist of every asset currently at that branch.
2. Walker (Asset Admin or designate) marks each asset *Found*, *Missing*, or *Misplaced (note location)*.
3. On submit, AMS produces a discrepancy report + suggested transitions:
   - *Missing* → flag for write-off (or trigger `lost` transition).
   - *Misplaced* → suggested branch transfer.
4. Audit row per checked asset + per transition.

Mobile-first because walking the floor with a desktop is impractical.

## In scope (high-level)

- An `inventory_walks/{walkId}` collection with `{ branchId, startedBy, startedAt, completedAt?, status, items: [{ assetId, expectedBranch, actualState, note }] }` (items as a sub-collection if many).
- A `/inventory-walks/new` start page (pick branch → snapshot taken).
- A mobile-first checklist UI with quick-tap *Found / Missing / Misplaced* buttons + optional note + camera-photo (Phase 3).
- A discrepancy report on completion with suggested transitions.
- Read-only walk-history page.

## Out of scope (this stub)

- Barcode / QR-code scanning (already excluded from AMS-v1 globally).
- Multi-walker simultaneous edit on the same walk.
- Auto-execute the suggested transitions; admin must confirm each.

## Acceptance criteria

- [ ] Asset Admin can start a walk for a branch; the snapshot is immutable once started.
- [ ] Mobile UI usable at 360px width.
- [ ] Per-asset state recorded with optional note.
- [ ] Completion produces a discrepancy summary with one-click "Apply suggested transitions" gated to Super Admin.
- [ ] Audit row per item + a "walk complete" summary audit row.

## Open questions

- Walk granularity — branch only, or branch + room/floor? Default: branch only.
- Resume an interrupted walk? Default: yes — `status: 'in_progress'` resumable until `completedAt` set.
- Photo evidence per missing asset? Useful but Phase 3+.
