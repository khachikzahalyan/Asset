# Excel Export & Reports

**Phase:** 2
**Status:** stub
**Owner agents:** firebase-engineer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §14

## Purpose & user value

Spec calls for **six canned reports** and an ad-hoc export of any filtered list. The reports are the most-asked-for analytics that auditors and management need, exportable as `.xlsx`:

1. Asset register snapshot (full registry, filterable).
2. Currently-issued assets (by employee, by department, by branch).
3. Movement history (assigned/returned in date range).
4. Repair-cost summary per asset (Phase 2 — depends on `repairs` feature).
5. Write-off log (assets in final statuses with reason and date).
6. License-expiry calendar (Phase 2 — depends on `licenses` feature).

Plus: every list page (`/assets`, `/employees`, `/branches`) gets an "Export filtered to Excel" button.

## In scope (high-level)

- A `/reports` page listing the 6 reports as cards, each launching a parameter modal (date range, branch, etc.).
- xlsx generation via `exceljs` or `xlsx-populate` (server-side via a Cloud Function for large reports; client-side for small ones).
- Branded template with company logo (configurable in `/settings/general`).
- All exports respect role-based read permissions (no info leaks).
- "Export filtered" button on list pages applies the current filter to the export.
- Audit row recording the export request `{ entity: 'report', action: 'export', meta: { reportType, filters } }`.

## Out of scope (this stub)

- Scheduled/email-delivered reports (Phase 3).
- PDF export (xlsx only in Phase 2).
- Custom report builder.

## Acceptance criteria

- [ ] All six reports generate a valid `.xlsx` matching documented column structure.
- [ ] Each report respects the caller's role (Tech Admin reports omit cost / write-off details where appropriate).
- [ ] List-page "Export filtered" applies current filter chips and search query.
- [ ] Audit row captures every export.
- [ ] Localized column headers based on the user's `preferredLocale`.

## Open questions

- Server-side generation (Cloud Function) vs. client-side. Default proposal: client for ≤10k rows, server for larger. Threshold tunable.
- How to deliver large reports? Direct download vs. Storage URL with email link?
