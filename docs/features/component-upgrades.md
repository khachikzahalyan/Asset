# Component Upgrades

**Phase:** 2
**Status:** stub
**Owner agents:** domain-modeler, firebase-engineer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §11

## Purpose & user value

When Tech Admin swaps a 256 GB SSD for a 1 TB SSD, or doubles RAM from 8 GB to 16 GB, AMS should:

1. Update the asset's technical attributes.
2. Auto-record a journal entry capturing **before/after** so the lifetime modification history of every asset is queryable.

This is structurally a special-case write on top of `dynamic-technical-attributes.md` — a shorthand UI for "change attribute, log the change with a structured reason."

## In scope (high-level)

- An "Upgrade component" action on the asset detail Technical tab.
- Form: pick the attribute to change, enter old value (pre-filled from current), enter new value, enter a brief reason / part SKU / cost.
- Single transaction: update `asset_attribute_values`, write a structured `audit_logs` row with `action: 'component_upgrade'` and `meta: { attrId, before, after, cost, partSku }`.
- A dedicated "Modifications" sub-tab on asset detail showing only `component_upgrade` audit rows for that asset.

## Out of scope (this stub)

- Inventory of replacement parts (parts catalog is its own initiative).
- Tracking the removed component as a separate inventory item.
- Cost rollup separate from `repairs`.

## Acceptance criteria

- [ ] Tech Admin can perform a component upgrade through a single modal.
- [ ] The asset's attribute value updates atomically with the audit row.
- [ ] Asset detail "Modifications" tab lists upgrades chronologically with localized labels.

## Open questions

- Does a component upgrade transition the asset's status (e.g., to `under_repair` while in progress)? Default proposal: no — instantaneous swap, no transition.
- Should swapped-out components be tracked as their own assets? Out of scope; if needed, the customer creates a new asset record and writes off the old component separately.
