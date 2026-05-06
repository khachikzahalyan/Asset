# Employee Termination Flow

**Phase:** 3
**Status:** stub
**Owner agents:** firebase-engineer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §6

## Purpose & user value

When an employee leaves the company with N assets in their possession, the admin currently has to return each asset one-by-one before terminating them. Phase 3 adds a **guided termination flow**:

1. Open the employee's detail page → "Terminate".
2. Wizard lists every active assignment.
3. For each, pick: return to stock / reassign to another employee / write off.
4. Optional: bulk-upload return acts (one PDF for all).
5. Confirm → AMS executes all the chosen transitions in one orchestration, sets `terminatedAt`, sets `isActive: false`, writes audit rows.

## In scope (high-level)

- A multi-step termination wizard at `/employees/:id/terminate`.
- Per-assignment action picker.
- Bulk return-act upload (one file applies to all).
- Atomic-ish orchestration (each individual transition is its own transaction; if one fails, surface the failure and let admin retry just that one).
- Audit row per asset transition + a "termination" summary audit row on the employee.

## Out of scope (this stub)

- Auto-redistribution policy ("redistribute to the employee's deputy").
- HR system integration (auto-trigger from a payroll event).
- Multi-day termination workflows (asset return scheduled across multiple visits).

## Acceptance criteria

- [ ] Wizard handles employees with up to 50 assignments without timeout.
- [ ] Mid-flow failure surfaces only the failed item; remaining successes persist.
- [ ] Termination is reversible (Super Admin can re-activate; outstanding assets do not auto-restore).
- [ ] Audit trail captures every transition + a top-level termination row.

## Open questions

- Should the flow let the admin enter a final return date in the past (e.g., backfilling a termination that happened a week ago)?
- What's the policy for assets the employee "still has somewhere" but didn't physically return — write off or escalate?
