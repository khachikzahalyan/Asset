# Branches: form cleanup + phone field

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the redundant Type and Head-office controls from the branch dialog, drop the Type column from the list, and add an optional `phone` field to the Branch entity end-to-end.

**Architecture:** Pure UI + locale + thin domain/repo/rules extension. The `type` enum and `isPrimary` boolean stay alive in the schema (used by `HeadOfficeBootstrap` and the list-page badge); we only stop offering them as editable fields in the dialog. `phone` is a brand-new optional `string | null` on Branch — sanitized in the domain helper, persisted by the repo, validated by the rule, rendered in the dialog and detail page, translated in all three locales.

**Tech Stack:** React 18, Vite, Firebase Firestore (rules + SDK v9), i18next, Vitest + Testing Library.

**Decisions (locked, no user clarification needed):**

1. **Keep `isPrimary` in domain/repo/rules.** The user only objected to the modal control, not the underlying mechanism. The list-page "Главный" star badge stays valuable; the `EmployeeFormDialog` head-office auto-default needs a reliable signal that survives the user renaming the branch later. `HeadOfficeBootstrap` already maintains the flag programmatically — that pipeline is preserved.
2. **Keep `type` in domain/repo/rules.** Existing Firestore rows with `type: 'warehouse'` keep their data. New rows from the dialog default to `type: 'branch'` via `emptyBranchInput()` (already does so). The list page no longer renders a Type column; the Building2 icon next to the name is also dropped (it would duplicate "Branches" page heading). The detail page drops the Type field row.
3. **`phone` shape.** `string | null`, optional. Sanitized to `null` when empty/whitespace; otherwise trimmed. No format validation in MVP — free-text, matches plan §14 style for `address`. Rules accept `(!('phone' in d) || d.phone == null || d.phone is string)` to be tolerant of legacy rows that lack the field.
4. **Locales.** New keys: `phone`, `formPhoneLabel`, `phonePlaceholder`. Russian / English / Armenian.
5. **No git ops, no deploys.** Final report mentions that `firestore.rules` was edited and needs a manual `npm run deploy:rules` later.

---

## File Structure

**Modify:**
- `src/domain/branches.js` — add `phone` to typedef, `emptyBranchInput`, `sanitizeBranchInput`.
- `src/infra/repositories/firestoreBranchRepository.js` — include `phone` in `auditSnapshot`, `createBranch.after`, `updateBranch.after`.
- `firestore.rules` — extend create + full-shape update branches with `phone` predicate.
- `src/components/features/branches/BranchFormDialog.jsx` — drop the Type fieldset, drop the head-office checkbox + caption, add a Phone input row.
- `src/pages/BranchListPage.jsx` — drop the Type column header + cell. Drop unused `BRANCH_TYPES`, `Building2`, `Warehouse` imports. Keep the head-office badge with `Star`.
- `src/pages/BranchDetailPage.jsx` — drop the Type Field row (and Type icon in header description). Add a Phone Field row inside the Details card. Keep the head-office display row (user did not object to it).
- `src/locales/ru/branches.json`, `src/locales/en/branches.json`, `src/locales/hy/branches.json` — add `phone`, `formPhoneLabel`, `phonePlaceholder`.
- `src/test/branches.test.js` — extend to cover `phone` sanitization.
- `src/test/firestoreBranchRepository.test.js` — extend the create/update tests to assert `phone` round-trips.
- `src/test/BranchListPage.test.jsx` — update the row test: 4-column header (Name / Type / Address / Status) becomes 3 columns (Name / Address / Status).

**Create:** none.

---

### Task 1: Domain — add `phone`

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/domain/branches.js`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/test/branches.test.js`

- [ ] **Step 1: Extend the failing test for phone sanitization**

Add to `branches.test.js` inside `describe('sanitizeBranchInput', ...)`:

```js
it('trims a non-empty phone and keeps it as a string', () => {
  expect(sanitizeBranchInput({ phone: '  +374 11 22 33 44  ' }).phone).toBe(
    '+374 11 22 33 44'
  );
});

it('coerces empty / whitespace-only / missing phone to null', () => {
  expect(sanitizeBranchInput({ phone: '' }).phone).toBeNull();
  expect(sanitizeBranchInput({ phone: '   ' }).phone).toBeNull();
  expect(sanitizeBranchInput({ phone: null }).phone).toBeNull();
  expect(sanitizeBranchInput({}).phone).toBeNull();
});
```

Update the existing `emptyBranchInput defaults` test to include `phone: null` in the expected shape.

Update the `trims every string and coerces missing fields to defaults` test's expected value to include `phone: null`.

- [ ] **Step 2: Run tests to confirm failure**

Run: `npm test -- --run src/test/branches.test.js`
Expected: FAIL — sanitized output missing `phone`.

- [ ] **Step 3: Implement the change**

Edits to `src/domain/branches.js`:

In the `Branch` typedef, add after `address`:

```
 * @property {string|null} phone
```

In the `BranchInput` typedef, add after `address`:

```
 * @property {string|null} [phone]
```

In `emptyBranchInput()`, add `phone: null,` after `address: '',`.

In `sanitizeBranchInput()`, after the `address` field in the returned object, add:

```js
phone:
  isPlainString(raw.phone) && raw.phone.trim().length > 0
    ? raw.phone.trim()
    : null,
```

- [ ] **Step 4: Re-run tests**

Run: `npm test -- --run src/test/branches.test.js`
Expected: PASS.

---

### Task 2: Repository — persist `phone` and audit it

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/infra/repositories/firestoreBranchRepository.js`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/test/firestoreBranchRepository.test.js`

- [ ] **Step 1: Extend the failing tests**

In `firestoreBranchRepository.test.js`:

(a) The `createBranch -> writes the branch doc and an audit_logs entry in one transaction` test:
- Add `phone: '+374 99 12 34 56'` to the input object.
- Add `phone: '+374 99 12 34 56'` to the expected `branchSet.data` matcher.
- Add `phone: '+374 99 12 34 56'` to the expected `auditSet.data.after` shape.

(b) The `createBranch -> sanitizes input (trims whitespace)` test:
- Add `phone: '  +374 12 34 56 78  '` to the input.
- After the existing assertions add: `expect(mocks.capturedTx.sets[0].data.phone).toBe('+374 12 34 56 78');`.

(c) The `updateBranch -> writes a tx update + audit_logs row with before/after diff` test:
- Add `phone: '+374 1' ` to `before`, `phone: '+374 2'` to the input.
- After the existing `update.data` matcher add: `expect(update.data.phone).toBe('+374 2');`.
- Update the audit `before`/`after` matchers to include the phones.

- [ ] **Step 2: Run tests to confirm failure**

Run: `npm test -- --run src/test/firestoreBranchRepository.test.js`
Expected: FAIL — `phone` not in tx writes.

- [ ] **Step 3: Implement the change**

Edits to `firestoreBranchRepository.js`:

In `auditSnapshot()`, after the `address` entry add:

```js
phone: obj.phone ?? null,
```

In `createBranch`, inside the `after` object passed to `tx.set(branchRef, after)`, after `address: sanitized.address,` add:

```js
phone: sanitized.phone,
```

In `updateBranch`, inside the `after` object passed to `tx.update(ref, after)`, after `address: sanitized.address,` add:

```js
phone: sanitized.phone,
```

- [ ] **Step 4: Re-run tests**

Run: `npm test -- --run src/test/firestoreBranchRepository.test.js`
Expected: PASS.

---

### Task 3: Firestore rules — accept `phone`

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/firestore.rules`

- [ ] **Step 1: Edit the rule**

In the `match /branches/{branchId}` block, both the `allow create` predicate and the full-shape branch of `allow update` (the first `(...)` arm of the `||`) currently read:

```
&& request.resource.data.address is string
&& (
     request.resource.data.responsibleEmployeeId == null
     || request.resource.data.responsibleEmployeeId is string
   )
```

Insert a `phone` clause between them in BOTH places (create + full-update arm):

```
&& request.resource.data.address is string
&& (
     !('phone' in request.resource.data)
     || request.resource.data.phone == null
     || request.resource.data.phone is string
   )
&& (
     request.resource.data.responsibleEmployeeId == null
     || request.resource.data.responsibleEmployeeId is string
   )
```

The demotion patch arm (`request.resource.data.diff(resource.data).affectedKeys().hasOnly(['isPrimary', 'updatedBy', 'updatedAt'])`) is left untouched — the demotion path doesn't write `phone`, so omitting it from the diff is fine.

- [ ] **Step 2: Verify no regression in employee rules tests**

Run: `npm test -- --run src/test/employees.rulesMirror.test.js`
Expected: PASS (rules file syntactically valid, employee mirror unchanged).

---

### Task 4: Dialog — drop Type + head-office, add Phone

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/components/features/branches/BranchFormDialog.jsx`

- [ ] **Step 1: Edit the component**

Edits:

1. Drop `BRANCH_TYPES` from the import (it is no longer referenced after these edits) — change:
   ```js
   import {
     BRANCH_TYPES,
     emptyBranchInput,
     sanitizeBranchInput,
     validateBranchInput,
   } from '@/domain/branches.js';
   ```
   to:
   ```js
   import {
     emptyBranchInput,
     sanitizeBranchInput,
     validateBranchInput,
   } from '@/domain/branches.js';
   ```

2. In the `initial` memo, drop the `type` line (let `emptyBranchInput()`'s default carry through on create, and on edit the existing `branch.type` is preserved by the sanitized round-trip via `sanitizeBranchInput` since we do not pass it explicitly — but to be safe, keep the value flowing). Replace:
   ```js
   return {
     name: { ru: branch.name?.ru ?? '', en: branch.name?.en ?? '', hy: branch.name?.hy ?? '' },
     type: branch.type ?? BRANCH_TYPES.BRANCH,
     address: branch.address ?? '',
     responsibleEmployeeId: branch.responsibleEmployeeId ?? null,
     isActive: branch.isActive ?? true,
     isPrimary: Boolean(branch.isPrimary),
   };
   ```
   with:
   ```js
   return {
     name: { ru: branch.name?.ru ?? '', en: branch.name?.en ?? '', hy: branch.name?.hy ?? '' },
     type: branch.type ?? 'branch',
     address: branch.address ?? '',
     phone: branch.phone ?? null,
     responsibleEmployeeId: branch.responsibleEmployeeId ?? null,
     isActive: branch.isActive ?? true,
     isPrimary: Boolean(branch.isPrimary),
   };
   ```
   (This preserves the existing branch's `type` on edit, defaults to `'branch'` on create. We carry `isPrimary` through the form invisibly so the rules-side full-update payload still includes it for already-primary branches.)

3. Delete the entire `<fieldset>` block rendering the Type radios (the block that starts with `<fieldset className="space-y-1.5">` and ends with the matching `</fieldset>`).

4. Delete the entire head-office `<label className="flex items-start gap-2 ...">` block (the checkbox + `headOffice` / `headOfficeHint` spans).

5. Insert a new Phone field immediately after the Address `<div className="space-y-1.5">` block:

   ```jsx
   <div className="space-y-1.5">
     <Label htmlFor="branch-phone">{t('formPhoneLabel')}</Label>
     <Input
       id="branch-phone"
       name="phone"
       type="tel"
       value={form.phone ?? ''}
       onChange={(e) =>
         setForm((f) => ({ ...f, phone: e.target.value }))
       }
       placeholder={t('phonePlaceholder')}
       disabled={submitting}
     />
   </div>
   ```

- [ ] **Step 2: Smoke-test the dialog through the existing test surface**

The dialog has no dedicated unit test today. The list-page test exercises rendering only, not dialog open. Run the full suite to make sure nothing imports `BRANCH_TYPES` from this file:

Run: `npm test -- --run`
Expected: PASS overall, including `BranchListPage.test.jsx` (still passes pre-edit, will edit in Task 5).

---

### Task 5: List page — drop Type column

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/pages/BranchListPage.jsx`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/test/BranchListPage.test.jsx`

- [ ] **Step 1: Update the test first**

In `BranchListPage.test.jsx`, the assertion `expect(rows).toHaveLength(3)` (1 header + 2 data) stays correct, but we should additionally assert the Type column is gone. Add:

```js
expect(screen.queryByRole('columnheader', { name: i18n.t('branches:type') }))
  .not.toBeInTheDocument();
```

inside the `renders a row per branch` test, after the existing assertions.

- [ ] **Step 2: Run the test, expect failure**

Run: `npm test -- --run src/test/BranchListPage.test.jsx`
Expected: FAIL — Type column header still rendered.

- [ ] **Step 3: Edit the page**

Edits to `BranchListPage.jsx`:

1. Drop unused imports — change:
   ```js
   import { Plus, Search, Building2, Warehouse, Filter, Star } from 'lucide-react';
   ```
   to:
   ```js
   import { Plus, Search, Filter, Star } from 'lucide-react';
   ```
   And drop the `BRANCH_TYPES` import:
   ```js
   import { BRANCH_TYPES } from '@/domain/branches.js';
   ```
   delete entirely.

2. Drop the `<TableHead>{t('type')}</TableHead>` cell from the `<TableHeader>` row.

3. Drop the entire `<TableCell>` block that renders the type icon + label (the one wrapping `b.type === BRANCH_TYPES.WAREHOUSE ? <Warehouse ... /> : <Building2 ... />`).

- [ ] **Step 4: Re-run tests**

Run: `npm test -- --run src/test/BranchListPage.test.jsx`
Expected: PASS.

---

### Task 6: Detail page — drop Type, add Phone

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/pages/BranchDetailPage.jsx`

- [ ] **Step 1: Edit the page**

Edits to `BranchDetailPage.jsx`:

1. Drop unused imports — change:
   ```js
   import { ChevronLeft, Pencil, PowerOff, Power, Building2, Warehouse } from 'lucide-react';
   ```
   to:
   ```js
   import { ChevronLeft, Pencil, PowerOff, Power } from 'lucide-react';
   ```
   And drop the `BRANCH_TYPES` import:
   ```js
   import { BRANCH_TYPES } from '@/domain/branches.js';
   ```
   delete entirely.

2. Delete the line:
   ```js
   const TypeIcon = branch.type === BRANCH_TYPES.WAREHOUSE ? Warehouse : Building2;
   ```

3. In `<PageHeader description=...>`, replace
   ```jsx
   description={
     branch.type === BRANCH_TYPES.WAREHOUSE ? t('warehouseType') : t('branchType')
   }
   ```
   with:
   ```jsx
   description={branch.address || null}
   ```
   (The page heading already says "Branches" via PageHeader title; pulling the address into the subtitle is more useful than re-stating "Branch".)

4. Delete the entire `<Field label={t('formTypeLabel')}>...</Field>` block.

5. Insert a new Phone field after the Address `<Field>` block:
   ```jsx
   <Field label={t('formPhoneLabel')}>
     {branch.phone ? (
       <a
         href={`tel:${branch.phone}`}
         className="text-primary underline-offset-4 hover:underline"
       >
         {branch.phone}
       </a>
     ) : (
       <span className="text-muted-foreground">—</span>
     )}
   </Field>
   ```

- [ ] **Step 2: Run the suite**

Run: `npm test -- --run`
Expected: PASS — there is no dedicated `BranchDetailPage.test.jsx` (verified earlier), so this is purely a build-time + manual check.

---

### Task 7: i18n keys

**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/ru/branches.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/en/branches.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/hy/branches.json`

- [ ] **Step 1: Edit RU**

Add three keys to `src/locales/ru/branches.json` (insert near the existing `address` / `formAddressLabel` keys):

```json
"phone": "Телефон",
"formPhoneLabel": "Телефон",
"phonePlaceholder": "+374 ...",
```

- [ ] **Step 2: Edit EN**

Add to `src/locales/en/branches.json`:

```json
"phone": "Phone",
"formPhoneLabel": "Phone",
"phonePlaceholder": "+374 ...",
```

- [ ] **Step 3: Edit HY**

Add to `src/locales/hy/branches.json`:

```json
"phone": "Հեռախոս",
"formPhoneLabel": "Հեռախոս",
"phonePlaceholder": "+374 ...",
```

(`headOfficeHint` is no longer rendered anywhere — leave the key in the JSON so future plans can resurrect the checkbox if asked. Removing unused keys is out of scope.)

- [ ] **Step 4: Verify**

Run: `npm test -- --run`
Expected: PASS — i18next will not throw on missing keys; we added them to all three files in parallel.

---

### Task 8: Final verification

**Files:** none.

- [ ] **Step 1: Full test suite**

Run: `npm test -- --run`
Expected: all tests PASS.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: success, no new warnings.

- [ ] **Step 4: Report back**

Compose the final summary: files changed, test counts, lint result, build result, and the rules-deploy reminder.

---

## Rollback notes

- All seven file edits are independent commits in the engineer's mental model — if any single task breaks the build, revert that file alone.
- Existing Firestore rows with `type: 'warehouse'` continue to function: the field is still serialized by the repo (because the dialog-controlled value flows through), still allowed by the rule, and the `HeadOfficeBootstrap` writes `type: 'branch'` for new head-office rows. The list and detail pages simply no longer render Type as UI text.
- `firestore.rules` requires a manual `npm run deploy:rules` (or `npx firebase deploy --only firestore:rules`) — flagged in the final report. No deploy is performed automatically.
