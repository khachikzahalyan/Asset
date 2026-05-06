# Branches CRUD — Implementation Plan

**Spec source:** `docs/features/branches.md`
**Stage:** Stage C Step 3
**Tracking:** Phase 1 (MVP)

## Goal

Phase-1-complete Branches feature: list / create / edit / soft-deactivate, multi-language `name`,
audit-log on every write, role gates, react-router routes, i18n keys, tests.

## Domain model (final)

```
/branches/{branchId}   (auto-id)
{
  branchId: string,                       // mirrors doc id, denormalized for client convenience
  name: { ru: string, en: string, hy: string },
  type: 'branch' | 'warehouse',
  address: string,                        // free-text Tier-3
  responsibleEmployeeId: string | null,
  isActive: boolean,
  createdAt: Timestamp,
  createdBy: string,                      // uid
  updatedAt: Timestamp,
  updatedBy: string                       // uid
}
```

Soft-close only (`allow delete: if false`).

## File tree (all paths absolute)

NEW:
- `C:/Users/DELL/Desktop/assets-crm/src/domain/branches.js` — typedef, validators, `BRANCH_TYPES`.
- `C:/Users/DELL/Desktop/assets-crm/src/domain/repositories/BranchRepository.js` — JSDoc port.
- `C:/Users/DELL/Desktop/assets-crm/src/infra/repositories/firestoreBranchRepository.js` — adapter using modular Firestore SDK.
- `C:/Users/DELL/Desktop/assets-crm/src/lib/audit/auditLog.js` — `writeAuditEntry(batch, { entity, entityId, action, actorUid, before, after })`.
- `C:/Users/DELL/Desktop/assets-crm/src/hooks/useBranches.js` — `{ data, loading, error }` via onSnapshot.
- `C:/Users/DELL/Desktop/assets-crm/src/hooks/useBranch.js` — single-doc hook for detail page.
- `C:/Users/DELL/Desktop/assets-crm/src/pages/BranchListPage.jsx` — table + add button.
- `C:/Users/DELL/Desktop/assets-crm/src/pages/BranchDetailPage.jsx` — read view + edit dialog.
- `C:/Users/DELL/Desktop/assets-crm/src/components/features/branches/BranchFormDialog.jsx` — create + edit modal.
- `C:/Users/DELL/Desktop/assets-crm/src/components/features/branches/BranchSelect.jsx` — reusable dropdown of active branches.
- `C:/Users/DELL/Desktop/assets-crm/src/components/ui/dialog.jsx` — small shadcn-style dialog primitive (no Radix dependency for MVP; native `<dialog>` + portal-free).
- `C:/Users/DELL/Desktop/assets-crm/src/components/ui/badge.jsx` — small badge primitive.
- `C:/Users/DELL/Desktop/assets-crm/src/components/ui/table.jsx` — small table wrapper.
- `C:/Users/DELL/Desktop/assets-crm/src/test/branches.test.js` — domain validator tests.
- `C:/Users/DELL/Desktop/assets-crm/src/test/firestoreBranchRepository.test.js` — repo unit tests w/ mocked SDK.
- `C:/Users/DELL/Desktop/assets-crm/src/test/BranchListPage.test.jsx` — RTL smoke test.

MODIFIED:
- `C:/Users/DELL/Desktop/assets-crm/src/App.jsx` — add `/branches` and `/branches/:id` routes (admin-gated).
- `C:/Users/DELL/Desktop/assets-crm/src/config/routes.js` — add BRANCHES + BRANCH_DETAIL constants.
- `C:/Users/DELL/Desktop/assets-crm/firestore.rules` — add `/branches/{id}` and `/audit_logs` rule cohesion.
- `C:/Users/DELL/Desktop/assets-crm/firestore.indexes.json` — add `(isActive ASC, type ASC, name.ru ASC)` index.
- `C:/Users/DELL/Desktop/assets-crm/src/locales/{ru,en,hy}/branches.json` — fill out keys.
- `C:/Users/DELL/Desktop/assets-crm/src/locales/{ru,en,hy}/common.json` — add cancel/save/edit/deactivate/activate keys if missing.

## Firestore rules diff

```
match /branches/{branchId} {
  allow read: if isAdmin();
  allow create: if isSuperAdmin()
                && request.resource.data.name.keys().hasOnly(['ru','en','hy'])
                && request.resource.data.type in ['branch','warehouse']
                && request.resource.data.isActive is bool
                && request.resource.data.createdBy == request.auth.uid
                && request.resource.data.updatedBy == request.auth.uid;
  allow update: if isSuperAdmin()
                && request.resource.data.name.keys().hasOnly(['ru','en','hy'])
                && request.resource.data.type in ['branch','warehouse']
                && request.resource.data.updatedBy == request.auth.uid;
  allow delete: if false;
}
```

## i18n keys

`branches.json` namespace, all three locales:

```
title, subtitle, addBranch, editBranch, deactivate, activate,
name, type, branchType, warehouseType, address, responsible, none,
isActive, active, closed, status,
formNameLabel, formTypeLabel, formAddressLabel, formResponsibleLabel,
emptyState, deleteConfirmTitle, deleteConfirmBody,
errorRequired, errorNameAllLocales,
toastCreated, toastUpdated, toastDeactivated, toastActivated,
nav (already in common)
```

`common.json` additions (only if missing): `save, cancel, confirm, edit, search`.

## Tasks (sequential, each gated by test-engineer)

1. **domain-modeler** — write `src/domain/branches.js` with `BRANCH_TYPES`, `validateBranchInput()`, `sanitizeBranchInput()`. Pure JS. Plus `src/domain/repositories/BranchRepository.js` (JSDoc-only port, exports nothing runtime-side; documents `list / get / create / update / setActive`). NO Firestore imports.
2. **firebase-engineer** — write `src/infra/repositories/firestoreBranchRepository.js` implementing the port. Use `runTransaction` to write the branch + an audit-log entry atomically. Also create `src/lib/audit/auditLog.js` (helper used by all infra repos). Update `firestore.rules` and `firestore.indexes.json`. Do NOT deploy yet.
3. **react-ui-engineer** — write hooks (`useBranches`, `useBranch`), components (`BranchFormDialog`, `BranchSelect`), pages (`BranchListPage`, `BranchDetailPage`), small UI primitives (`dialog.jsx`, `badge.jsx`, `table.jsx`). Wire routes in `App.jsx`. NO Firestore imports in component files — go through hooks → repository.
4. **i18n-engineer** — fill out the three branches.json files with every key listed above; add missing common.json keys.
5. **spec-reviewer** — verify against `docs/features/branches.md` acceptance criteria.
6. **code-quality-reviewer** — React + Firebase best-practice audit.
7. **security-reviewer** — branches rule, audit_logs rule, no leakage of Firestore SDK into UI, role gates correct on routes.
8. **deploy** — `firebase deploy --only firestore:rules,firestore:indexes`.

## Verification commands

```
cd C:/Users/DELL/Desktop/assets-crm
npm run lint
npm run test:run
npm run build
```

All three must pass (lint zero warnings, tests all green, build succeeds).

Then manually:
- Sign in as super_admin (zahalyanxcho@gmail.com).
- Open `/branches` → empty state.
- Click "Add branch" → fill ru/en/hy name, pick "Warehouse", address "Yerevan central" → Save.
- Verify row appears, audit log entry created (check Firestore console).
- Edit the branch → change ru name → Save → verify update.
- Deactivate the branch → verify Closed badge.

## Rollback

If any step lands broken on main, revert the relevant file changes from the file list above and redeploy rules from the prior version. The bootstrap super_admin path (`firestore.rules` users.create) is independent of branches and stays.
