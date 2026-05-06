# Purchase Batches

**Phase:** 2
**Status:** stub
**Owner agents:** domain-modeler, firebase-engineer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §5

## Purpose & user value

When the company buys 50 identical laptops in one purchase, AMS shouldn't make the admin enter them one at a time. A **Batch** records the shared metadata (supplier, invoice number, purchase date, unit price, warranty) and lets the admin spawn N assets from it in one action. Each asset still gets its own inventory code and serial number, but the shared fields denormalize from the batch.

## In scope (high-level)

- `batches/{batchId}` collection with `{ supplierName, invoiceNumber, purchaseDate, unitPrice, currency, warrantyUntil, categoryId, branchId, count, status, invoiceUrl }`.
- Bulk-create flow: admin fills the form, supplies a list of serial numbers (or auto-fill blanks), AMS spawns N asset docs with consecutive inventory codes from the category counter.
- Storage upload for invoice scan: `batches/{batchId}/invoice.{ext}` (PDF/JPEG/PNG, ≤10 MB).
- A `/batches` list page.
- Audit row per batch + per spawned asset.

## Out of scope (this stub)

- Supplier and contractor catalog entities (deferred — `suppliers` and `contractors` collections were considered in Stage A and parked for a later Phase 2 sub-iteration).
- Partial-receive (5 of 50 arrived today).
- Batch-level write-off (write off the entire batch).
- Currency conversion.

## Acceptance criteria

- [ ] Asset Admin can create a batch and spawn N assets in one transaction.
- [ ] Each spawned asset has unique inventory code + audit row.
- [ ] Batch invoice scan stored at `batches/{batchId}/invoice.{ext}` with 10 MB / file-type rules.
- [ ] Each spawned asset references `batchId`; deleting the batch is forbidden.
- [ ] Failure mid-spawn rolls back the whole batch (transactional).

## Open questions

- Cap on N (50? 200?) before falling back to the Excel import path.
- Do we let the admin auto-generate placeholder serial numbers ("SN-PENDING-1") to be filled in later? Or block creation until all serials supplied?
