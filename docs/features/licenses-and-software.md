# Licenses & Software

**Phase:** 2
**Status:** stub
**Owner agents:** domain-modeler, firebase-engineer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §12

## Purpose & user value

Software licenses (Office, Adobe, antivirus, etc.) need their own register. A license can be bound to:

- A specific asset (per-device license).
- A department or branch (volume / floating license).
- An employee (per-user license).

Each license has a key (Tier-4 English-only), a vendor, an expiry date, a seat count, and a renewal cost. AMS surfaces an **expiry alert** as the date approaches.

## In scope (high-level)

- `licenses/{licenseId}` with `{ vendor, productName (Tier-3), licenseKey (Tier-4), seatCount, boundType: 'asset'|'department'|'branch'|'employee', boundId, purchaseDate, expiryDate, cost, currency, notes }`.
- Storage path `licenses/{licenseId}/cert.{ext}` for license certificate scan (PDF, ≤10 MB).
- A `/licenses` list page with filters by vendor / expiry-window / bound-type.
- A "Licenses" sub-section on the bound entity's detail page (asset, employee, etc.).
- Expiry-alert badge: color-coded by days remaining (`>30` green, `8–30` yellow, `≤7` red, expired grey).
- Email alert (T-30, T-7, T-0) via the Trigger Email extension.

## Out of scope (this stub)

- License auto-renewal / auto-purchase integration.
- Activation key generation (the key is supplied externally).
- Device-level enforcement of license seat counts.

## Acceptance criteria

- [ ] Asset Admin and Super Admin can create / edit licenses.
- [ ] Licenses bound to an asset / department / branch / employee surface on that entity's detail page.
- [ ] Expiry-alert badge renders the appropriate color band.
- [ ] Email alert at T-30, T-7, and on expiry, gated by recipient role.
- [ ] License key validated as ASCII-only (Tier 4).
- [ ] Audit row on every write.

## Open questions

- Recipient mapping for expiry alerts (Super Admin always; Asset Admin / Tech Admin opt-in?).
- Renewal flow: edit existing license vs. create a new one and link?
