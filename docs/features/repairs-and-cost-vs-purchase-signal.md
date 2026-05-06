# Repairs & Cost-vs-Purchase Signal

**Phase:** 2
**Status:** stub
**Owner agents:** domain-modeler, firebase-engineer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §11

## Purpose & user value

Each time an asset goes for repair, the cost is logged. AMS sums the cumulative repair cost per asset and surfaces a **signal** when that total approaches or exceeds the asset's `purchasePrice` — a hint to the admin that it's cheaper to write off and replace than to keep repairing. Tech Admin owns this workflow.

## In scope (high-level)

- `repairs/{repairId}` collection with `{ assetId, openedAt, openedBy, closedAt?, contractor (string), description, cost, currency, partsReplaced[], scanUrl?, status }`.
- A "Repair" workflow on the asset: open repair → asset transitions to `under_repair` → after work, close repair → asset transitions back to previous status.
- Cumulative-cost calculation per asset; threshold percentage configurable in `/settings/general`.
- A "Repair cost ≥ X% of purchase" badge on asset list and detail page.
- Tech Admin can create / close repairs; Asset Admin can read.
- Storage path `repairs/{repairId}/scan.{ext}`.

## Out of scope (this stub)

- Approval gate before high-cost repairs.
- Vendor (contractor) catalog. Deferred — repairs use a free-text `contractor` field for Phase 2 launch.
- Repair scheduling / SLA tracking.

## Acceptance criteria

- [ ] Tech Admin can open and close repairs; asset transitions handled atomically with the repair write.
- [ ] Cumulative cost per asset visible on the asset detail page.
- [ ] Asset detail shows "Cumulative repair cost: X% of purchase" badge with color coded threshold.
- [ ] Threshold percentage editable by Super Admin in `/settings/general`.
- [ ] Every repair create / close writes audit row.

## Open questions

- Threshold semantics: `cumulativeCost >= threshold * purchasePrice`? Per repair or all-time?
- Currency mismatch handling (asset bought in USD, repair paid in AMD).
