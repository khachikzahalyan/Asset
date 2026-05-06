# Excel Import (Two-Pass)

**Phase:** 2
**Status:** stub
**Owner agents:** firebase-engineer, react-ui-engineer, data-migration-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §13

## Purpose & user value

Onboarding a new customer means importing their existing spreadsheet of employees and assets. AMS supports a **two-pass import**:

1. **Pass 1 — Employees.** Upload an `.xlsx` file with employee rows; AMS validates and loads them.
2. **Pass 2 — Assets.** Upload an `.xlsx` file with asset rows that reference employee emails (now in AMS).

Each row passes through a **4-state preview**: 🟢 ready, 🟡 warning (will create with defaults), 🔴 error (must fix), ⚪ skip (already exists / duplicate). Admin reviews, corrects, re-uploads, then confirms.

## In scope (high-level)

- A `/import` page (Super Admin / Asset Admin only).
- File parser using `xlsx` library (client-side; large files chunked).
- Two pre-built templates (employee + asset) downloadable from the import page.
- Row-level validation:
  - Employee: required fields, email uniqueness, branch/department resolution.
  - Asset: required fields, brand/model ASCII, category resolution, status resolution, assignee email matches existing employee.
- 4-state preview table with inline editing of warning/error rows.
- Batched commit (chunks of 100 rows; transactions inside chunks).
- Audit row per imported row.
- Roll-back the entire import if the user cancels mid-commit (best-effort; partial commits possible if network drops — Phase 2 should add a re-runnable `importBatchId` to make idempotent re-imports possible).

## Out of scope (this stub)

- CSV import (xlsx only).
- Importing batches, repairs, licenses (Phase 3 if needed).
- Live progress for huge files (>10k rows).
- ERP / API-based import.

## Acceptance criteria

- [ ] Super Admin / Asset Admin can upload an `.xlsx` and see a 4-state preview.
- [ ] Errors block commit until fixed; warnings can be accepted.
- [ ] Successful import creates entities + audit rows; each imported doc has `importBatchId` for traceability.
- [ ] Templates downloadable as `.xlsx` with header rows in the user's current locale.
- [ ] Importing the same file twice does NOT duplicate rows (idempotent via deterministic doc id where applicable; or via uniqueness check).

## Open questions

- Idempotency strategy: deterministic doc ids (email-hash for employees, inventory-code for assets) vs. an `importBatchId` lookup?
- What about partial-commit recovery if the user closes the tab mid-import?
