# AMS Feature Catalog

This directory contains the per-feature specifications for **AMS — Asset Management System**. Source: `docs/AMS_Plan_v3.md` (extracted from `AMS_Plan_v3.docx`, original Russian).

## MVP scope

**Phase 1 (MVP)** is the only phase scheduled for implementation. Phase 2 and Phase 3 features are documented as **stubs** for context — they exist so we know where Phase 1 designs need to leave room for future work, but no Phase 2/3 code lands until Phase 1 ships and the user signs off.

## Project context (locked decisions)

- **Project name:** AMS (code name `AMS`)
- **Customer:** placeholder — no literal company name or email domain in any artifact
- **Languages:** Russian + English + Armenian (4-tier i18n strategy)
- **Stack:** React 19 + Vite + Tailwind + shadcn/ui (frontend, hosted on Vercel) | Firebase Auth + Firestore + Cloud Storage + Cloud Functions + Trigger Email Extension (backend)
- **Auth:** Google OAuth (admins, server-enforced runtime domain check) + Firebase `signInWithEmailLink` (employees, passwordless)
- **Roles (4):** `super_admin`, `asset_admin`, `tech_admin`, `employee`
- **Audit log:** every state-changing write produces an immutable `audit_logs` row via shared helper inside a transaction
- **Devices:** Desktop-first, responsive Mobile. No tablet, no dark mode in MVP
- **Code identifiers:** English; Russian only inside i18n strings

## Feature index

### Phase 1 (MVP — full spec)

| Slug | Title | Owners | Depends on |
|---|---|---|---|
| [authentication](authentication.md) | Authentication & sessions (Google OAuth + email-link) | firebase-engineer, react-ui-engineer, security-reviewer | — |
| [roles-and-permissions](roles-and-permissions.md) | 4-role matrix and route gating | firebase-engineer, security-reviewer, react-ui-engineer | authentication |
| [internationalization](internationalization.md) | 3-locale i18n with 4-tier strategy | i18n-engineer, react-ui-engineer | — |
| [branches](branches.md) | Branch CRUD (incl. central warehouse) | domain-modeler, firebase-engineer, react-ui-engineer | roles-and-permissions, internationalization |
| [departments](departments.md) | Department CRUD (for shared assets) | domain-modeler, firebase-engineer, react-ui-engineer | roles-and-permissions, internationalization |
| [employees](employees.md) | Employee CRUD with branch assignment | domain-modeler, firebase-engineer, react-ui-engineer | branches, departments |
| [asset-categories](asset-categories.md) | Category catalog with inventory-code prefix | domain-modeler, firebase-engineer, react-ui-engineer | roles-and-permissions, internationalization |
| [asset-status-catalog](asset-status-catalog.md) | Status catalog (Super Admin–managed) | domain-modeler, firebase-engineer, react-ui-engineer | roles-and-permissions, internationalization |
| [asset-registry](asset-registry.md) | Core asset CRUD with inventory codes | domain-modeler, firebase-engineer, react-ui-engineer | branches, employees, departments, asset-categories, asset-status-catalog |
| [asset-assignment-and-acts](asset-assignment-and-acts.md) | Assign/return + act-of-acceptance scan upload | firebase-engineer, react-ui-engineer | asset-registry |
| [asset-lifecycle-transitions](asset-lifecycle-transitions.md) | Status workflow (irreversible final statuses) | domain-modeler, firebase-engineer | asset-registry, asset-status-catalog |
| [audit-trail](audit-trail.md) | Immutable audit log + asset timeline view | firebase-engineer, security-reviewer, react-ui-engineer | roles-and-permissions |
| [search-and-filters](search-and-filters.md) | Global asset search + filter bar | firebase-engineer, react-ui-engineer | asset-registry |
| [employee-self-service](employee-self-service.md) | Passwordless employee landing page | firebase-engineer, react-ui-engineer | authentication, asset-assignment-and-acts |
| [dashboards](dashboards.md) | Role-specific home (lightweight in MVP) | react-ui-engineer | roles-and-permissions, asset-registry |

### Phase 2 (stub — purpose + acceptance criteria only)

| Slug | Title |
|---|---|
| [dynamic-technical-attributes](dynamic-technical-attributes.md) | Per-category attribute schema + per-asset values |
| [purchase-batches](purchase-batches.md) | Bulk-create N identical assets (shared supplier/price/warranty/invoice) |
| [repairs-and-cost-vs-purchase-signal](repairs-and-cost-vs-purchase-signal.md) | Repair tracking + cumulative-cost alert |
| [component-upgrades](component-upgrades.md) | RAM/SSD/etc. changes with auto-journal entry |
| [licenses-and-software](licenses-and-software.md) | License records bound to asset/department + expiry alerts |
| [excel-import](excel-import.md) | Two-pass import (employees → assets) with 4-state preview |
| [excel-export-and-reports](excel-export-and-reports.md) | Six canned reports + filtered export |
| [notifications-system](notifications-system.md) | In-app + email matrix per role × event |

### Phase 3 (stub)

| Slug | Title |
|---|---|
| [employee-termination-flow](employee-termination-flow.md) | Bulk redistribute assets when an employee leaves |
| [write-off-approval-workflow](write-off-approval-workflow.md) | Two-eyes write-off (Asset Admin requests, Super Admin approves) |
| [inventory-walk](inventory-walk.md) | Branch-scoped checklist audit session |

## Suggested implementation order (Phase 1)

`internationalization` setup runs in parallel with everything else (it's foundational scaffolding, not a feature gate).

```
authentication
  └→ roles-and-permissions
       ├→ branches
       │    └→ employees
       │         └→ asset-registry
       │              ├→ asset-assignment-and-acts
       │              │    └→ employee-self-service
       │              ├→ asset-lifecycle-transitions
       │              ├→ search-and-filters
       │              └→ audit-trail (cross-cuts every write)
       ├→ departments  ─┘
       ├→ asset-categories  ─┘
       ├→ asset-status-catalog  ─┘
       └→ dashboards (last; depends on everything else for data)
```

Critical-path order:

1. internationalization (parallel scaffolding)
2. authentication
3. roles-and-permissions (Firestore rules baseline)
4. branches
5. departments
6. employees
7. asset-status-catalog
8. asset-categories
9. audit-trail (helper introduced before first write that needs auditing)
10. asset-registry
11. asset-assignment-and-acts
12. asset-lifecycle-transitions
13. search-and-filters
14. employee-self-service
15. dashboards

## Out of scope for AMS v1 entirely

- ERP integration / accounting export
- Active Directory / LDAP sync
- Barcode / QR code scanning
- Mobile native apps (iOS/Android — only responsive web)
- Multi-tenancy (single-tenant deployment per customer instance)
- Public asset catalog or vendor self-service portal
- Real-time collaboration (multi-user-on-same-asset editing with presence)
