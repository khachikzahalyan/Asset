# Dynamic Technical Attributes

**Phase:** 2
**Status:** stub
**Owner agents:** domain-modeler, firebase-engineer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §5

## Purpose & user value

Different asset categories have different technical attributes: a laptop has CPU, RAM, SSD, screen size, OS; a monitor has resolution and panel type; a phone has IMEI and storage capacity. Hard-coding fields in the Asset entity would either bloat every record with irrelevant fields or force category-specific schemas in code. The Phase-2 solution is a **Super-Admin-managed schema per category** (`category_attributes`) and a **per-asset values doc** (`asset_attribute_values`) keyed by attribute id.

Tech Admin gets meaningful work in Phase 2: editing the technical attributes of any asset (RAM upgrade, SSD swap, OS reinstall) without touching assignment / status / location.

## In scope (high-level)

- `category_attributes/{categoryId}/attrs/{attrId}` — schema entries with `{ name (Tier-2), type (string|number|boolean|enum|date), unit?, options?, required, sortOrder }`.
- `asset_attribute_values/{assetId}/values/{attrId}` — value docs.
- Schema editor at `/settings/categories/:id/attributes` (Super Admin).
- Asset detail "Technical" tab populated with the relevant fields per category.
- Tech Admin write access scoped to attribute values only (not the Asset's other fields).
- Audit row on every attribute write.

## Out of scope (this stub)

- Schema migration when an attribute is renamed or deleted.
- Conditional attributes ("show RAM only if asset.kind == laptop").
- Validation rules beyond simple type / required.

## Acceptance criteria

- [ ] Super Admin can add, edit, reorder, deactivate attributes per category.
- [ ] Asset detail page renders the per-category attribute form on the Technical tab.
- [ ] Tech Admin can edit attribute values; cannot edit other asset fields.
- [ ] Every attribute-value write produces an audit-log row.
- [ ] Attribute names are multi-language (`<MultiLangInput>`).

## Open questions

- Should attribute values be flat (one doc per asset) or sub-collection (one doc per asset+attribute)? Flat is simpler; sub-collection scales better for many-attribute categories.
- How to handle category change after assets exist (do values migrate)? Default: forbid category change (already the rule).
