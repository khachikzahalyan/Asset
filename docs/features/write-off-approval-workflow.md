# Write-Off Approval Workflow

**Phase:** 3
**Status:** stub
**Owner agents:** firebase-engineer, react-ui-engineer, security-reviewer
**Spec reference:** `docs/AMS_Plan_v3.md` §16

## Purpose & user value

Write-offs are sensitive — they remove value from the books and are often the first place fraud or sloppy paperwork shows up. Phase 3 introduces a **two-eyes pattern**: Asset Admin **requests** a write-off; Super Admin **approves** or **rejects** it. The asset only transitions to `written_off` after approval. Until then, it sits in a transient `pending_write_off` status (or stays in its current status with a flag — see Open questions).

## In scope (high-level)

- A `write_off_requests/{requestId}` collection: `{ assetId, requestedBy, requestedAt, reason (Tier-3), evidenceUrls[], status: 'pending'|'approved'|'rejected', resolvedBy?, resolvedAt?, resolutionNote? }`.
- "Request write-off" action on the asset (Asset Admin only).
- A queue at `/approvals` for Super Admin: pending requests with asset summary, requester, reason, evidence.
- Approve action: transitions asset to `written_off` + writes audit row, server-enforced.
- Reject action: marks request as rejected with note + writes audit row.
- Email notification to Super Admin on new request, to requester on resolution.
- Storage path `write_offs/{requestId}/evidence.{ext}`.

## Out of scope (this stub)

- N-eyes (more than two approvers).
- Approval delegation when Super Admin is on leave.
- Approvals for other transitions (e.g., status changes other than write-off).

## Acceptance criteria

- [ ] Asset Admin can submit a write-off request with reason + evidence.
- [ ] Asset cannot be transitioned to `written_off` directly by Asset Admin (rule denies).
- [ ] Approval triggers the actual `written_off` transition server-side.
- [ ] Rejection allows the requester to amend and re-submit.
- [ ] Email notifications to both parties at each step.
- [ ] Audit rows for request, approval/rejection, and the resulting write-off.
- [ ] Rules test: Asset Admin attempting direct write-off transition is denied.

## Open questions

- Transient status (`pending_write_off`) vs. flag on the asset (`pendingWriteOffRequestId`)? Default proposal: flag, no extra status — keeps the status catalog clean.
- Same workflow for "Lost" (where the asset isn't physically present)? Open — depends on customer policy.
