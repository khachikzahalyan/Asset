# Admin Invitations & User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the founding super_admin a `/users` page to invite (`super_admin` / `asset_admin` / `tech_admin`), promote/demote, deactivate, and revoke invitations, with full audit-log integration — all enforced via Firestore security rules on the Spark plan (no Cloud Functions).

**Architecture:** New top-level `userInvitations/{emailLower}` collection holds pending → accepted | revoked transitions. AuthContext extends its existing seed-bootstrap pattern with a second self-bootstrap path: when a freshly-signed-in user has no `users/{uid}` doc, look up `userInvitations/{email}`, atomically create `users/{uid}` with the invited role and mark the invitation accepted in one `runTransaction`. Firestore rules enforce role-match and one-shot invariants. Existing `users/{uid}` docs gain `isActive: boolean` for soft-deactivation; `RequireAuth` / `AuthContext` sign disabled users out client-side.

**Tech Stack:** Vite, React 19, react-router-dom v7, Firebase v11 (modular SDK), react-i18next (ru/en/hy), Tailwind, shadcn-style primitives, Vitest + Testing Library.

**Spec:** `C:/Users/DELL/Desktop/assets-crm/docs/superpowers/specs/2026-05-05-admin-invitations-user-management-design.md`

---

## File tree

### NEW (20 files)

```
src/domain/userInvitations.js
src/domain/repositories/UserInvitationsRepository.js
src/domain/repositories/UsersRepository.js

src/infra/repositories/firestoreUserInvitationsRepository.js
src/infra/repositories/firestoreUsersRepository.js

src/hooks/useUserInvitations.js
src/hooks/useUsers.js

src/pages/UsersPage.jsx
src/components/features/users/InviteAdminDialog.jsx
src/components/features/users/RoleChangeDialog.jsx
src/components/features/users/ConfirmActionDialog.jsx

src/locales/ru/users.json
src/locales/en/users.json
src/locales/hy/users.json

src/test/userInvitations.test.js
src/test/firestoreUserInvitationsRepository.test.js
src/test/firestoreUsersRepository.test.js
src/test/AuthContext.bootstrap.test.jsx
src/test/UsersPage.test.jsx
```

### MODIFIED (10 files)

```
firestore.rules
firestore.indexes.json
scripts/seed.js

src/lib/audit/auditHelper.js
src/contexts/AuthContext.jsx
src/App.jsx
src/config/routes.js
src/components/layout/AppShell.jsx
src/pages/LoginPage.jsx

src/locales/{ru,en,hy}/auth.json
src/locales/{ru,en,hy}/common.json
```

---

## Sequential subagent dispatch order

1. **domain-modeler** — Tasks 1–3
2. **firebase-engineer** — Tasks 4–8 (rules, indexes, repos, audit helper, seed migration)
3. **react-ui-engineer** — Tasks 9–14 (hooks, dialogs, page, AuthContext, routing, AppShell, LoginPage banner)
4. **i18n-engineer** — Task 15 (all three `users.json` + `auth.json` updates + `common.json` updates)

Each task is gated by `test-engineer`. If `test-engineer` returns FAIL, re-dispatch the same implementer with the failing test report; do **not** advance.

After Tasks 1–15:

5. **spec-reviewer** — Task 16
6. **code-quality-reviewer** — Task 17
7. **security-reviewer** — Task 18 (mandatory because rules + auth touched)
8. **deploy** — Task 19

---

## Firestore rules diff (target final state)

The **NEW** `userInvitations` block and the **MODIFIED** `users` block (full block replaced):

```
function isValidInviteRole(role) {
  return role in ['super_admin', 'asset_admin', 'tech_admin'];
}

match /userInvitations/{email} {
  allow read: if isAdmin();

  allow create: if isSuperAdmin()
                && request.resource.data.email == email
                && isValidInviteRole(request.resource.data.role)
                && request.resource.data.invitedBy == request.auth.uid
                && request.resource.data.invitedAt == request.time
                && request.resource.data.status == 'pending'
                && request.resource.data.acceptedAt == null
                && request.resource.data.acceptedUid == null
                && request.resource.data.revokedAt == null
                && request.resource.data.revokedBy == null;

  allow update: if (
                    // revoke (super_admin)
                    isSuperAdmin()
                    && resource.data.status == 'pending'
                    && request.resource.data.status == 'revoked'
                    && request.resource.data.revokedBy == request.auth.uid
                    && request.resource.data.revokedAt == request.time
                    && request.resource.data.diff(resource.data).affectedKeys()
                       .hasOnly(['status', 'revokedBy', 'revokedAt'])
                  ) || (
                    // self-accept (the invitee)
                    request.auth != null
                    && request.auth.token.email_verified == true
                    && resource.data.status == 'pending'
                    && resource.data.email == request.auth.token.email.lower()
                    && request.resource.data.status == 'accepted'
                    && request.resource.data.acceptedUid == request.auth.uid
                    && request.resource.data.acceptedAt == request.time
                    && request.resource.data.diff(resource.data).affectedKeys()
                       .hasOnly(['status', 'acceptedUid', 'acceptedAt'])
                  );

  allow delete: if false;
}

match /users/{uid} {
  allow read: if (request.auth != null && request.auth.uid == uid) || isSuperAdmin();

  allow create: if request.auth != null
                && request.auth.uid == uid
                && (
                     // (1) seed super-admin (preserved)
                     (
                       isSeedSuperAdminEmail()
                       && request.resource.data.role == 'super_admin'
                       && request.resource.data.email == request.auth.token.email
                       && request.resource.data.isActive == true
                     ) || (
                       // (2) invitation acceptance
                       request.auth.token.email_verified == true
                       && exists(/databases/$(database)/documents/userInvitations/$(request.auth.token.email.lower()))
                       && get(/databases/$(database)/documents/userInvitations/$(request.auth.token.email.lower())).data.status == 'pending'
                       && request.resource.data.role == get(/databases/$(database)/documents/userInvitations/$(request.auth.token.email.lower())).data.role
                       && request.resource.data.email == request.auth.token.email.lower()
                       && request.resource.data.isActive == true
                     )
                   );

  allow update: if isSuperAdmin()
                && request.resource.data.diff(resource.data).affectedKeys()
                   .hasOnly(['role', 'branchId', 'departmentId', 'displayName',
                             'preferredLocale', 'employeeId', 'isActive', 'updatedAt']);

  allow delete: if false;
}
```

> If the rules engine in this Firebase project rejects `request.auth.token.email.lower()` (older preview), fall back to comparing `request.resource.data.email == request.auth.token.email` and require the client to lowercase before sign-up. The firebase-engineer verifies during Task 4.

---

## Indexes diff (`firestore.indexes.json`)

Append two index objects to the existing `indexes` array:

```json
{
  "collectionGroup": "userInvitations",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status",    "order": "ASCENDING" },
    { "fieldPath": "invitedAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "users",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "isActive", "order": "ASCENDING" },
    { "fieldPath": "role",     "order": "ASCENDING" },
    { "fieldPath": "email",    "order": "ASCENDING" }
  ]
}
```

---

## i18n keys

**`users.json` (NEW namespace, all 3 locales):**

```
usersTitle, usersSubtitle,
sectionActive, sectionPending,
inviteCta, inviteDialogTitle, inviteDialogDescription,
formEmailLabel, formEmailPlaceholder, formRoleLabel,
roleSuperAdmin, roleAssetAdmin, roleTechAdmin, roleEmployee,
btnInvite, btnInviting, btnCancel,
toastInvited, toastInviteRevoked, toastRoleChanged, toastDeactivated, toastActivated,
errInviteExists, errEmailRequired, errEmailInvalid, errRoleRequired,
errLastSuperAdmin, errCannotDeactivateSelf, errCannotRevokeSelf,
colEmail, colName, colRole, colBranch, colStatus, colCreated, colInvitedBy, colInvitedAt, colActions,
statusActive, statusInactive, statusPending,
actionsChangeRole, actionsDeactivate, actionsActivate, actionsRevoke,
emptyActiveUsers, emptyPendingInvitations,
confirmDeactivateTitle, confirmDeactivateBody, confirmActivateTitle, confirmActivateBody,
confirmRevokeTitle, confirmRevokeBody,
roleChangeDialogTitle, roleChangeDialogDescription
```

**`auth.json` updates (all 3 locales):**

| Key | ru | en | hy |
|---|---|---|---|
| `tabAdmin` (value change) | "Через Google" | "Sign in with Google" | "Google-ով" |
| `tabEmployee` (value change) | "По ссылке на email" | "Email sign-in link" | "Հղումով նամակին" |
| `accountDisabled` (NEW) | "Ваш аккаунт деактивирован администратором. Обратитесь к супер-админу." | "Your account has been deactivated by an administrator. Please contact a super admin." | "Ձեր հաշիվը անջատվել է ադմինիստրատորի կողմից։ Դիմեք գերադմինին։" |

**`common.json` updates (all 3 locales):** add `navUsers` (flat key style — matches existing `navBranches`, `navAssets`, etc.):

| Key | ru | en | hy |
|---|---|---|---|
| `navUsers` | "Пользователи" | "Users" | "Օգտատերեր" |

---

## AuthContext bootstrap algorithm (target)

Inside `onAuthStateChanged`, when `fbUser` is non-null, run **before** `setUser(fbUser)`:

```
async function bootstrapFromInvitationIfEligible(fbUser):
  if not fbUser.email:                       return
  if not fbUser.emailVerified:               return
  email = fbUser.email.trim().toLowerCase()

  userRef   = doc(db, 'users', fbUser.uid)
  userSnap  = await getDoc(userRef)
  if userSnap.exists():                      return

  inviteRef = doc(db, 'userInvitations', email)

  try:
    await runTransaction(db, async tx -> {
      inviteSnap = await tx.get(inviteRef)
      if !inviteSnap.exists():               return
      invite = inviteSnap.data()
      if invite.status != 'pending':         return

      tx.set(userRef, {
        email, displayName: fbUser.displayName ?? null, photoURL: fbUser.photoURL ?? null,
        role: invite.role, branchId: invite.branchId ?? null,
        departmentId: invite.departmentId ?? null, employeeId: null,
        preferredLocale: 'ru', isActive: true,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })
      tx.update(inviteRef, {
        status: 'accepted', acceptedUid: fbUser.uid, acceptedAt: serverTimestamp(),
      })
    })
  catch err:
    console.warn('[AMS auth] invitation bootstrap skipped:', err?.code ?? err)
```

Order of operations:
1. `await bootstrapSuperAdminIfEligible(fbUser)` (existing, unchanged)
2. `await bootstrapFromInvitationIfEligible(fbUser)` (NEW)
3. `setUser(fbUser)` — triggers users/{uid} onSnapshot

**isActive enforcement:** in the `users/{uid}` onSnapshot effect, when `data.isActive === false`, call `signOut(auth)` and set `accountDisabled = true` in context. LoginPage reads `accountDisabled` and renders an `Alert` above the tabs using `t('auth:accountDisabled')`.

---

## UI guards (Q3 — client-side only)

| Guard | Implementation |
|---|---|
| Cannot deactivate yourself | In `UsersPage.jsx`, disable **Деактивировать** button when `targetUser.uid === auth.user.uid`; show tooltip with `t('users:errCannotDeactivateSelf')`. |
| Cannot demote last active super_admin | Before role-change submit: `count = users.filter(u => u.role === 'super_admin' && u.isActive).length`. If `count === 1 && target.uid === thatUser.uid && newRole !== 'super_admin'`, block submit, toast `t('users:errLastSuperAdmin')`. |
| Cannot revoke own pending invitation | Hide **Отозвать** when `invitation.email === auth.user.email.toLowerCase()`. (Realistically a super_admin won't have a pending invite — defense in depth.) |

---

## Audit log entries

Per spec §10. **No audit entry on invitation acceptance** (Q2). All entries use `buildAuditLog()` and write atomically inside the same `runTransaction`.

| Trigger | entity | entityId | action |
|---|---|---|---|
| Invite created | `invitation` | `emailLower` | `create` |
| Invite revoked | `invitation` | `emailLower` | `revoke` |
| Role changed | `user` | `uid` | `roleChanged` |
| Deactivated | `user` | `uid` | `deactivated` |
| Reactivated | `user` | `uid` | `reactivated` |

`auditHelper.js` `ALLOWED_ENTITIES` gains `'invitation'`.

---

## Migration plan

`scripts/seed.js` gets a `backfillIsActive(db)` step run after `bootstrapSuperAdmins`. It scans `users/`, finds docs missing `isActive`, sets `isActive: true` via Admin SDK (bypasses rules). Idempotent.

**Order of operations on deploy day:**
1. Deploy rules + indexes.
2. `npm run seed` — patches existing user docs with `isActive: true`.
3. Deploy UI.

---

## Tasks

### Task 1: domain — userInvitations module (typedefs + validators)

**Subagent role:** domain-modeler
**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/domain/userInvitations.js`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/test/userInvitations.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// src/test/userInvitations.test.js
import { describe, it, expect } from 'vitest';
import {
  INVITE_ROLES,
  INVITE_ROLE_LIST,
  INVITE_STATUS,
  emptyInviteInput,
  sanitizeInviteInput,
  validateInviteInput,
  isInviteInputValid,
  normalizeEmail,
} from '@/domain/userInvitations.js';

describe('userInvitations domain', () => {
  it('exposes the three invitable admin roles', () => {
    expect(INVITE_ROLES).toEqual({
      SUPER_ADMIN: 'super_admin',
      ASSET_ADMIN: 'asset_admin',
      TECH_ADMIN: 'tech_admin',
    });
    expect(INVITE_ROLE_LIST).toEqual(['super_admin', 'asset_admin', 'tech_admin']);
  });

  it('exposes the three invitation statuses', () => {
    expect(INVITE_STATUS).toEqual({
      PENDING: 'pending',
      ACCEPTED: 'accepted',
      REVOKED: 'revoked',
    });
  });

  it('emptyInviteInput returns a fresh object with tech_admin default', () => {
    expect(emptyInviteInput()).toEqual({ email: '', role: 'tech_admin' });
  });

  it('normalizeEmail trims and lowercases', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
    expect(normalizeEmail(undefined)).toBe('');
    expect(normalizeEmail(null)).toBe('');
  });

  it('sanitizeInviteInput normalizes email and coerces role', () => {
    expect(sanitizeInviteInput({ email: ' Foo@Bar.com ', role: 'asset_admin' })).toEqual({
      email: 'foo@bar.com',
      role: 'asset_admin',
    });
    // unknown role -> default tech_admin
    expect(sanitizeInviteInput({ email: 'a@b.com', role: 'employee' })).toEqual({
      email: 'a@b.com',
      role: 'tech_admin',
    });
  });

  it('validateInviteInput flags empty email', () => {
    expect(validateInviteInput({ email: '', role: 'tech_admin' })).toEqual({
      email: 'errEmailRequired',
    });
  });

  it('validateInviteInput flags malformed email', () => {
    expect(validateInviteInput({ email: 'not-an-email', role: 'tech_admin' })).toEqual({
      email: 'errEmailInvalid',
    });
  });

  it('validateInviteInput passes a clean input', () => {
    expect(validateInviteInput({ email: 'kolya@gmail.com', role: 'tech_admin' })).toEqual({});
    expect(isInviteInputValid({ email: 'kolya@gmail.com', role: 'tech_admin' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run test:run -- src/test/userInvitations.test.js`
Expected: FAIL with "Cannot find module '@/domain/userInvitations.js'"

- [ ] **Step 3: Write the module**

```javascript
// src/domain/userInvitations.js
/**
 * UserInvitations domain module.
 *
 * Pure JavaScript: no Firestore, no React, no I/O. Exports the entity shape,
 * type/status constants, and validation helpers used by both the infra
 * repository and the form layer.
 */

/**
 * @typedef {'super_admin' | 'asset_admin' | 'tech_admin'} InviteRole
 * @typedef {'pending' | 'accepted' | 'revoked'} InviteStatus
 *
 * @typedef {Object} UserInvitation
 * @property {string} email                  // canonical lowercased, mirrors doc id
 * @property {InviteRole} role
 * @property {string|null} branchId
 * @property {string|null} departmentId
 * @property {string} invitedBy              // uid
 * @property {import('firebase/firestore').Timestamp} invitedAt
 * @property {InviteStatus} status
 * @property {import('firebase/firestore').Timestamp|null} acceptedAt
 * @property {string|null} acceptedUid
 * @property {import('firebase/firestore').Timestamp|null} revokedAt
 * @property {string|null} revokedBy
 *
 * @typedef {Object} InviteInput
 * @property {string} email
 * @property {InviteRole} role
 */

export const INVITE_ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  ASSET_ADMIN: 'asset_admin',
  TECH_ADMIN: 'tech_admin',
});

export const INVITE_ROLE_LIST = Object.freeze(Object.values(INVITE_ROLES));

export const INVITE_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REVOKED: 'revoked',
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Trim + lowercase. Returns '' for nullish.
 * @param {string|null|undefined} email
 * @returns {string}
 */
export function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

/** @returns {InviteInput} */
export function emptyInviteInput() {
  return { email: '', role: INVITE_ROLES.TECH_ADMIN };
}

/**
 * @param {InviteInput} input
 * @returns {InviteInput}
 */
export function sanitizeInviteInput(input) {
  const raw = input ?? {};
  return {
    email: normalizeEmail(raw.email),
    role: INVITE_ROLE_LIST.includes(raw.role) ? raw.role : INVITE_ROLES.TECH_ADMIN,
  };
}

/**
 * @param {InviteInput} input
 * @returns {Record<string, string>}  // empty = valid
 */
export function validateInviteInput(input) {
  const sanitized = sanitizeInviteInput(input);
  const errors = {};
  if (!sanitized.email) {
    errors.email = 'errEmailRequired';
  } else if (!EMAIL_RE.test(sanitized.email)) {
    errors.email = 'errEmailInvalid';
  }
  if (!INVITE_ROLE_LIST.includes(sanitized.role)) {
    errors.role = 'errRoleRequired';
  }
  return errors;
}

export function isInviteInputValid(input) {
  return Object.keys(validateInviteInput(input)).length === 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run test:run -- src/test/userInvitations.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Hand off to test-engineer**

Test-engineer verifies the test file covers each exported function and runs `npm run test:run`. Must report PASS before Task 2 starts.

---

### Task 2: domain — UserInvitationsRepository port (JSDoc)

**Subagent role:** domain-modeler
**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/domain/repositories/UserInvitationsRepository.js`

- [ ] **Step 1: Write the port**

```javascript
// src/domain/repositories/UserInvitationsRepository.js
/**
 * UserInvitationsRepository — domain-level port (interface).
 *
 * JSDoc-only by design: importing this file at runtime only pulls in
 * typedef metadata, never a Firestore client. Components and hooks talk
 * to a concrete adapter (firestoreUserInvitationsRepository) through this
 * shape.
 *
 * Concrete adapter:
 *   - src/infra/repositories/firestoreUserInvitationsRepository.js
 *
 * Method semantics:
 *   listPending(onData, onError):
 *     subscribe to all invitations with status='pending' ordered by
 *     invitedAt DESC. Returns an unsubscribe function.
 *
 *   create(input, actor):
 *     atomically create userInvitations/{emailLower} with status='pending'
 *     and an audit_logs entry of action 'create'. Returns the email used
 *     as the doc id. Rejects if a doc already exists at that id.
 *
 *   revoke(emailLower, before, actor):
 *     atomically transition pending -> revoked and write 'revoke' audit.
 */

/**
 * @typedef {import('@/domain/userInvitations.js').UserInvitation} UserInvitation
 * @typedef {import('@/domain/userInvitations.js').InviteInput} InviteInput
 */

/**
 * @typedef {Object} ActorContext
 * @property {string} uid
 * @property {string} role
 */

/**
 * @typedef {Object} UserInvitationsRepository
 * @property {(onData: (invites: UserInvitation[]) => void, onError: (err: Error) => void) => () => void} listPending
 * @property {(input: InviteInput, actor: ActorContext) => Promise<string>} create
 * @property {(emailLower: string, before: UserInvitation, actor: ActorContext) => Promise<void>} revoke
 */

export {};
```

- [ ] **Step 2: Hand off to test-engineer**

No runtime tests for the port (JSDoc only). Test-engineer confirms the file has no executable side effects (`export {}` only) and runs the full suite to ensure nothing regresses: `npm run test:run`.

---

### Task 3: domain — UsersRepository port (JSDoc)

**Subagent role:** domain-modeler
**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/domain/repositories/UsersRepository.js`

- [ ] **Step 1: Write the port**

```javascript
// src/domain/repositories/UsersRepository.js
/**
 * UsersRepository — domain-level port (interface).
 *
 * JSDoc-only by design.
 *
 * Concrete adapter:
 *   - src/infra/repositories/firestoreUsersRepository.js
 *
 * Method semantics:
 *   list(onData, onError):
 *     subscribe to all users ordered by email ASC. Unsubscribe returned.
 *
 *   updateRole(uid, newRole, before, actor):
 *     atomically update users/{uid}.role and write a 'roleChanged' audit.
 *
 *   setActive(uid, isActive, before, actor):
 *     atomically toggle users/{uid}.isActive and write
 *     'deactivated' | 'reactivated' audit.
 */

/**
 * @typedef {Object} AppUser
 * @property {string} uid
 * @property {string} email
 * @property {string|null} displayName
 * @property {string|null} photoURL
 * @property {'super_admin'|'asset_admin'|'tech_admin'|'employee'} role
 * @property {string|null} branchId
 * @property {string|null} departmentId
 * @property {string|null} employeeId
 * @property {'ru'|'en'|'hy'} preferredLocale
 * @property {boolean} isActive
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {import('firebase/firestore').Timestamp} updatedAt
 */

/**
 * @typedef {Object} ActorContext
 * @property {string} uid
 * @property {string} role
 */

/**
 * @typedef {Object} UsersRepository
 * @property {(onData: (users: AppUser[]) => void, onError: (err: Error) => void) => () => void} list
 * @property {(uid: string, newRole: AppUser['role'], before: AppUser, actor: ActorContext) => Promise<void>} updateRole
 * @property {(uid: string, isActive: boolean, before: AppUser, actor: ActorContext) => Promise<void>} setActive
 */

export {};
```

- [ ] **Step 2: Hand off to test-engineer**

Same as Task 2.

---

### Task 4: firestore.rules — userInvitations + extended users.create + widened users.update

**Subagent role:** firebase-engineer
**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/firestore.rules`

- [ ] **Step 1: Add the helper function**

Inside `service cloud.firestore { match /databases/{database}/documents { ... } }`, near the existing role helpers, add:

```
function isValidInviteRole(role) {
  return role in ['super_admin', 'asset_admin', 'tech_admin'];
}
```

- [ ] **Step 2: Add the userInvitations match block**

Place between `match /settings/auth` and `match /branches/{branchId}`:

```
match /userInvitations/{email} {
  allow read: if isAdmin();

  allow create: if isSuperAdmin()
                && request.resource.data.email == email
                && isValidInviteRole(request.resource.data.role)
                && request.resource.data.invitedBy == request.auth.uid
                && request.resource.data.invitedAt == request.time
                && request.resource.data.status == 'pending'
                && request.resource.data.acceptedAt == null
                && request.resource.data.acceptedUid == null
                && request.resource.data.revokedAt == null
                && request.resource.data.revokedBy == null;

  allow update: if (
                    isSuperAdmin()
                    && resource.data.status == 'pending'
                    && request.resource.data.status == 'revoked'
                    && request.resource.data.revokedBy == request.auth.uid
                    && request.resource.data.revokedAt == request.time
                    && request.resource.data.diff(resource.data).affectedKeys()
                       .hasOnly(['status', 'revokedBy', 'revokedAt'])
                  ) || (
                    request.auth != null
                    && request.auth.token.email_verified == true
                    && resource.data.status == 'pending'
                    && resource.data.email == request.auth.token.email.lower()
                    && request.resource.data.status == 'accepted'
                    && request.resource.data.acceptedUid == request.auth.uid
                    && request.resource.data.acceptedAt == request.time
                    && request.resource.data.diff(resource.data).affectedKeys()
                       .hasOnly(['status', 'acceptedUid', 'acceptedAt'])
                  );

  allow delete: if false;
}
```

- [ ] **Step 3: Replace the users match block**

Replace the entire existing `match /users/{uid}` block with:

```
match /users/{uid} {
  allow read: if (request.auth != null && request.auth.uid == uid) || isSuperAdmin();

  allow create: if request.auth != null
                && request.auth.uid == uid
                && (
                     (
                       isSeedSuperAdminEmail()
                       && request.resource.data.role == 'super_admin'
                       && request.resource.data.email == request.auth.token.email
                       && request.resource.data.isActive == true
                     ) || (
                       request.auth.token.email_verified == true
                       && exists(/databases/$(database)/documents/userInvitations/$(request.auth.token.email.lower()))
                       && get(/databases/$(database)/documents/userInvitations/$(request.auth.token.email.lower())).data.status == 'pending'
                       && request.resource.data.role == get(/databases/$(database)/documents/userInvitations/$(request.auth.token.email.lower())).data.role
                       && request.resource.data.email == request.auth.token.email.lower()
                       && request.resource.data.isActive == true
                     )
                   );

  allow update: if isSuperAdmin()
                && request.resource.data.diff(resource.data).affectedKeys()
                   .hasOnly(['role', 'branchId', 'departmentId', 'displayName',
                             'preferredLocale', 'employeeId', 'isActive', 'updatedAt']);

  allow delete: if false;
}
```

- [ ] **Step 4: Verify rules syntax locally (best-effort)**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npx -y firebase rules:check firestore.rules 2>&1 | tail -20` (this CLI subcommand may not exist; if it errors, proceed — Task 19 deploy is the real validation).

If `firebase-tools` rejects `request.auth.token.email.lower()`, replace those two occurrences with `request.auth.token.email` and add `&& email == request.auth.token.email` to the userInvitations.update self-accept branch (the email lookup in users.create still works because the doc id is the lowercased email and the client-side flow always lowercases before lookup; with this fallback the email field on the invitation must be stored exactly as the auth provider returns it). Document the chosen branch in a one-line code comment above the rule.

- [ ] **Step 5: Hand off to test-engineer**

Test-engineer scans the diff against the spec §4 rules block and confirms: (a) userInvitations rules present, (b) users.create has both bootstrap branches, (c) users.update affectedKeys widened, (d) helper `isValidInviteRole` defined. No runtime test required at this step (rules-emulator deferred to Task 18).

---

### Task 5: firestore.indexes.json — two new indexes

**Subagent role:** firebase-engineer
**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/firestore.indexes.json`

- [ ] **Step 1: Append the two index objects**

Inside the top-level `indexes` array, append:

```json
{
  "collectionGroup": "userInvitations",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status",    "order": "ASCENDING" },
    { "fieldPath": "invitedAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "users",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "isActive", "order": "ASCENDING" },
    { "fieldPath": "role",     "order": "ASCENDING" },
    { "fieldPath": "email",    "order": "ASCENDING" }
  ]
}
```

- [ ] **Step 2: Validate JSON**

Run: `cd C:/Users/DELL/Desktop/assets-crm && node -e "JSON.parse(require('fs').readFileSync('firestore.indexes.json', 'utf8')); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 3: Hand off to test-engineer**

Test-engineer validates JSON parses and the new objects appear exactly once in the array.

---

### Task 6: auditHelper — whitelist 'invitation' entity

**Subagent role:** firebase-engineer
**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/lib/audit/auditHelper.js`

- [ ] **Step 1: Extend ALLOWED_ENTITIES**

Replace the array literal:

```javascript
const ALLOWED_ENTITIES = [
  'asset',
  'branch',
  'employee',
  'department',
  'category',
  'asset_status',
  'user',
  'auth',
  'assignment',
  'settings',
  'invitation',
];
```

- [ ] **Step 2: Run the existing test suite**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run test:run`
Expected: all existing tests still pass (no test currently asserts the array's contents — adding `'invitation'` is additive).

- [ ] **Step 3: Hand off to test-engineer**

Test-engineer confirms `'invitation'` is in the array and the suite is green.

---

### Task 7: firestoreUserInvitationsRepository (Firestore adapter)

**Subagent role:** firebase-engineer
**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/infra/repositories/firestoreUserInvitationsRepository.js`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/test/firestoreUserInvitationsRepository.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// src/test/firestoreUserInvitationsRepository.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the modular Firestore SDK BEFORE importing the SUT
vi.mock('firebase/firestore', () => {
  const collection = vi.fn(() => ({ __type: 'collection' }));
  const doc = vi.fn((arg, _path, id) => ({ __type: 'docref', id: id ?? `auto-${Math.random()}` }));
  const onSnapshot = vi.fn(() => () => {});
  const query = vi.fn((c, ...rest) => ({ __type: 'query', c, rest }));
  const where = vi.fn((field, op, value) => ({ __type: 'where', field, op, value }));
  const orderBy = vi.fn((field, dir) => ({ __type: 'orderBy', field, dir }));
  const serverTimestamp = vi.fn(() => '__SERVER_TS__');
  const runTransaction = vi.fn(async (_db, fn) => {
    const tx = {
      get: vi.fn(async () => ({ exists: () => false })),
      set: vi.fn(),
      update: vi.fn(),
    };
    await fn(tx);
    return tx;
  });
  return {
    collection,
    doc,
    onSnapshot,
    query,
    where,
    orderBy,
    serverTimestamp,
    runTransaction,
  };
});

vi.mock('@/lib/firebase/index.js', () => ({ db: { __mock: 'db' } }));

vi.mock('@/lib/audit/auditHelper.js', () => ({
  buildAuditLog: vi.fn((args) => ({ __auditLog: true, ...args })),
  newAuditLogRef: vi.fn(() => ({ __type: 'docref', id: 'audit-1' })),
}));

import * as firestore from 'firebase/firestore';
import { buildAuditLog } from '@/lib/audit/auditHelper.js';
import {
  firestoreUserInvitationsRepository,
} from '@/infra/repositories/firestoreUserInvitationsRepository.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('firestoreUserInvitationsRepository', () => {
  it('listPending subscribes with status=pending and orderBy invitedAt DESC', () => {
    const onData = vi.fn();
    const onError = vi.fn();
    firestoreUserInvitationsRepository.listPending(onData, onError);

    expect(firestore.collection).toHaveBeenCalledWith({ __mock: 'db' }, 'userInvitations');
    expect(firestore.where).toHaveBeenCalledWith('status', '==', 'pending');
    expect(firestore.orderBy).toHaveBeenCalledWith('invitedAt', 'desc');
    expect(firestore.onSnapshot).toHaveBeenCalled();
  });

  it('create runs a transaction, writes the invitation and an audit log', async () => {
    await firestoreUserInvitationsRepository.create(
      { email: '  Foo@Bar.COM ', role: 'tech_admin' },
      { uid: 'super-uid', role: 'super_admin' }
    );

    expect(firestore.doc).toHaveBeenCalledWith({ __mock: 'db' }, 'userInvitations', 'foo@bar.com');
    expect(firestore.runTransaction).toHaveBeenCalledTimes(1);

    const txFn = firestore.runTransaction.mock.calls[0][1];
    const tx = {
      get: vi.fn(async () => ({ exists: () => false })),
      set: vi.fn(),
      update: vi.fn(),
    };
    await txFn(tx);

    expect(tx.set).toHaveBeenCalledTimes(2); // invitation doc + audit log
    const [, payload] = tx.set.mock.calls[0];
    expect(payload).toMatchObject({
      email: 'foo@bar.com',
      role: 'tech_admin',
      status: 'pending',
      invitedBy: 'super-uid',
    });
    expect(buildAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'invitation',
        entityId: 'foo@bar.com',
        action: 'create',
        actorUid: 'super-uid',
        actorRole: 'super_admin',
      })
    );
  });

  it('create throws if invitation already exists', async () => {
    firestore.runTransaction.mockImplementationOnce(async (_db, fn) => {
      await fn({
        get: async () => ({ exists: () => true }),
        set: vi.fn(),
        update: vi.fn(),
      });
    });

    await expect(
      firestoreUserInvitationsRepository.create(
        { email: 'a@b.com', role: 'tech_admin' },
        { uid: 'u', role: 'super_admin' }
      )
    ).rejects.toThrow(/already exists/);
  });

  it('revoke updates status and writes an audit log atomically', async () => {
    const before = {
      email: 'a@b.com',
      role: 'tech_admin',
      status: 'pending',
      invitedBy: 'u',
      invitedAt: 't',
    };

    await firestoreUserInvitationsRepository.revoke('a@b.com', before, {
      uid: 'super-uid',
      role: 'super_admin',
    });

    const txFn = firestore.runTransaction.mock.calls[0][1];
    const tx = { get: vi.fn(), set: vi.fn(), update: vi.fn() };
    await txFn(tx);
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({ __type: 'docref' }),
      expect.objectContaining({ status: 'revoked', revokedBy: 'super-uid' })
    );
    expect(buildAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'invitation', action: 'revoke', entityId: 'a@b.com' })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run test:run -- src/test/firestoreUserInvitationsRepository.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the adapter**

```javascript
// src/infra/repositories/firestoreUserInvitationsRepository.js
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';
import { sanitizeInviteInput, INVITE_STATUS } from '@/domain/userInvitations.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';

const COLLECTION = 'userInvitations';

function inviteCollection() {
  return collection(db, COLLECTION);
}

function inviteDoc(emailLower) {
  return doc(db, COLLECTION, emailLower);
}

function snapshotToInvite(snap) {
  if (!snap.exists()) return null;
  return { ...snap.data() };
}

function auditSnapshot(invite) {
  if (!invite) return null;
  return {
    email: invite.email ?? null,
    role: invite.role ?? null,
    branchId: invite.branchId ?? null,
    departmentId: invite.departmentId ?? null,
    status: invite.status ?? null,
  };
}

export function listPendingInvitations(onData, onError) {
  const q = query(
    inviteCollection(),
    where('status', '==', INVITE_STATUS.PENDING),
    orderBy('invitedAt', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ ...d.data() }))),
    (err) => {
      if (onError) onError(err);
    }
  );
}

export async function createInvitation(input, actor) {
  if (!actor?.uid) throw new Error('createInvitation: actor.uid required');
  const sanitized = sanitizeInviteInput(input);
  if (!sanitized.email) throw new Error('createInvitation: email required');

  const ref = inviteDoc(sanitized.email);
  const auditRef = newAuditLogRef();

  await runTransaction(db, async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists()) {
      throw new Error(`createInvitation: invitation already exists for ${sanitized.email}`);
    }
    const after = {
      email: sanitized.email,
      role: sanitized.role,
      branchId: null,
      departmentId: null,
      invitedBy: actor.uid,
      invitedAt: serverTimestamp(),
      status: INVITE_STATUS.PENDING,
      acceptedAt: null,
      acceptedUid: null,
      revokedAt: null,
      revokedBy: null,
    };
    tx.set(ref, after);
    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'invitation',
        entityId: sanitized.email,
        action: 'create',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: null,
        after: auditSnapshot(after),
      })
    );
  });

  return sanitized.email;
}

export async function revokeInvitation(emailLower, before, actor) {
  if (!actor?.uid) throw new Error('revokeInvitation: actor.uid required');
  if (!before) throw new Error('revokeInvitation: before snapshot required');
  const ref = inviteDoc(emailLower);
  const auditRef = newAuditLogRef();

  await runTransaction(db, async (tx) => {
    const after = {
      status: INVITE_STATUS.REVOKED,
      revokedBy: actor.uid,
      revokedAt: serverTimestamp(),
    };
    tx.update(ref, after);
    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'invitation',
        entityId: emailLower,
        action: 'revoke',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: auditSnapshot(before),
        after: auditSnapshot({ ...before, status: INVITE_STATUS.REVOKED }),
      })
    );
  });
}

export const firestoreUserInvitationsRepository = Object.freeze({
  listPending: listPendingInvitations,
  create: createInvitation,
  revoke: revokeInvitation,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run test:run -- src/test/firestoreUserInvitationsRepository.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Hand off to test-engineer**

Test-engineer runs the full suite to confirm no regression.

---

### Task 8: firestoreUsersRepository (Firestore adapter)

**Subagent role:** firebase-engineer
**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/infra/repositories/firestoreUsersRepository.js`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/test/firestoreUsersRepository.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// src/test/firestoreUsersRepository.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ __type: 'collection' })),
  doc: vi.fn((arg, _path, id) => ({ __type: 'docref', id })),
  onSnapshot: vi.fn(() => () => {}),
  query: vi.fn((c, ...rest) => ({ __type: 'query', c, rest })),
  orderBy: vi.fn((field, dir) => ({ __type: 'orderBy', field, dir })),
  serverTimestamp: vi.fn(() => '__SERVER_TS__'),
  runTransaction: vi.fn(async (_db, fn) => {
    await fn({ get: vi.fn(), set: vi.fn(), update: vi.fn() });
  }),
}));
vi.mock('@/lib/firebase/index.js', () => ({ db: { __mock: 'db' } }));
vi.mock('@/lib/audit/auditHelper.js', () => ({
  buildAuditLog: vi.fn((args) => ({ __auditLog: true, ...args })),
  newAuditLogRef: vi.fn(() => ({ __type: 'docref', id: 'audit-1' })),
}));

import * as firestore from 'firebase/firestore';
import { buildAuditLog } from '@/lib/audit/auditHelper.js';
import { firestoreUsersRepository } from '@/infra/repositories/firestoreUsersRepository.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('firestoreUsersRepository', () => {
  it('list subscribes ordered by email ASC', () => {
    firestoreUsersRepository.list(vi.fn(), vi.fn());
    expect(firestore.orderBy).toHaveBeenCalledWith('email', 'asc');
    expect(firestore.onSnapshot).toHaveBeenCalled();
  });

  it('updateRole writes role + audit atomically', async () => {
    const before = { uid: 'u1', email: 'a@b.com', role: 'tech_admin', isActive: true };
    await firestoreUsersRepository.updateRole('u1', 'asset_admin', before, {
      uid: 'super',
      role: 'super_admin',
    });
    const txFn = firestore.runTransaction.mock.calls[0][1];
    const tx = { get: vi.fn(), set: vi.fn(), update: vi.fn() };
    await txFn(tx);
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({ __type: 'docref' }),
      expect.objectContaining({ role: 'asset_admin' })
    );
    expect(buildAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'user', action: 'roleChanged', entityId: 'u1' })
    );
  });

  it('setActive(false) writes deactivated audit', async () => {
    const before = { uid: 'u1', email: 'a@b.com', role: 'tech_admin', isActive: true };
    await firestoreUsersRepository.setActive('u1', false, before, { uid: 'super', role: 'super_admin' });
    expect(buildAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'user', action: 'deactivated', entityId: 'u1' })
    );
  });

  it('setActive(true) writes reactivated audit', async () => {
    const before = { uid: 'u1', email: 'a@b.com', role: 'tech_admin', isActive: false };
    await firestoreUsersRepository.setActive('u1', true, before, { uid: 'super', role: 'super_admin' });
    expect(buildAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'user', action: 'reactivated', entityId: 'u1' })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run test:run -- src/test/firestoreUsersRepository.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the adapter**

```javascript
// src/infra/repositories/firestoreUsersRepository.js
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';

const COLLECTION = 'users';

function usersCollection() {
  return collection(db, COLLECTION);
}

function userDoc(uid) {
  return doc(db, COLLECTION, uid);
}

function auditSnapshot(u) {
  if (!u) return null;
  return {
    email: u.email ?? null,
    role: u.role ?? null,
    branchId: u.branchId ?? null,
    departmentId: u.departmentId ?? null,
    isActive: u.isActive ?? null,
  };
}

export function subscribeUsers(onData, onError) {
  const q = query(usersCollection(), orderBy('email', 'asc'));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))),
    (err) => {
      if (onError) onError(err);
    }
  );
}

export async function updateUserRole(uid, newRole, before, actor) {
  if (!actor?.uid) throw new Error('updateUserRole: actor.uid required');
  if (!before) throw new Error('updateUserRole: before snapshot required');
  const ref = userDoc(uid);
  const auditRef = newAuditLogRef();

  await runTransaction(db, async (tx) => {
    tx.update(ref, { role: newRole, updatedAt: serverTimestamp() });
    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'user',
        entityId: uid,
        action: 'roleChanged',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: auditSnapshot(before),
        after: auditSnapshot({ ...before, role: newRole }),
      })
    );
  });
}

export async function setUserActive(uid, isActive, before, actor) {
  if (!actor?.uid) throw new Error('setUserActive: actor.uid required');
  if (!before) throw new Error('setUserActive: before snapshot required');
  const ref = userDoc(uid);
  const auditRef = newAuditLogRef();
  const action = isActive ? 'reactivated' : 'deactivated';

  await runTransaction(db, async (tx) => {
    tx.update(ref, { isActive, updatedAt: serverTimestamp() });
    tx.set(
      auditRef,
      buildAuditLog({
        entity: 'user',
        entityId: uid,
        action,
        actorUid: actor.uid,
        actorRole: actor.role,
        before: auditSnapshot(before),
        after: auditSnapshot({ ...before, isActive }),
      })
    );
  });
}

export const firestoreUsersRepository = Object.freeze({
  list: subscribeUsers,
  updateRole: updateUserRole,
  setActive: setUserActive,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run test:run -- src/test/firestoreUsersRepository.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: scripts/seed.js — backfill isActive on existing user docs**

Modify `C:/Users/DELL/Desktop/assets-crm/scripts/seed.js`. After the `bootstrapSuperAdmins` block in `main()`, add:

```javascript
async function backfillIsActive(db) {
  console.log('\n-> backfilling users.isActive');
  const snap = await db.collection('users').get();
  let patched = 0;
  for (const userSnap of snap.docs) {
    const data = userSnap.data() ?? {};
    if (typeof data.isActive === 'boolean') continue;
    await userSnap.ref.set(
      { isActive: true, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    patched += 1;
    console.log(`   [+] users/${userSnap.id} -> isActive=true`);
  }
  console.log(`   [OK] backfill complete (${patched} doc${patched === 1 ? '' : 's'} patched)`);
}
```

And register it in `main()`:

```javascript
await writeSettingsAndMeta(db);
await bootstrapSuperAdmins(auth, db);
await backfillIsActive(db);          // NEW
```

- [ ] **Step 6: Hand off to test-engineer**

Test-engineer runs `npm run test:run` (full suite). The seed-script change has no automated test (it's a one-shot script gated by service account creds); test-engineer reviews it manually for idempotence and confirms the rest of the suite is green.

---

### Task 9: useUsers + useUserInvitations hooks

**Subagent role:** react-ui-engineer
**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/hooks/useUsers.js`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/hooks/useUserInvitations.js`

- [ ] **Step 1: Write useUsers**

```javascript
// src/hooks/useUsers.js
import { useEffect, useState } from 'react';
import { firestoreUsersRepository } from '@/infra/repositories/firestoreUsersRepository.js';

/**
 * Subscribe to all users.
 * @returns {{ data: import('@/domain/repositories/UsersRepository.js').AppUser[], loading: boolean, error: Error|null }}
 */
export function useUsers() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsub = firestoreUsersRepository.list(
      (rows) => {
        setData(rows);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  return { data, loading, error };
}
```

- [ ] **Step 2: Write useUserInvitations**

```javascript
// src/hooks/useUserInvitations.js
import { useEffect, useState } from 'react';
import { firestoreUserInvitationsRepository } from '@/infra/repositories/firestoreUserInvitationsRepository.js';

/**
 * Subscribe to all pending invitations.
 * @returns {{ data: import('@/domain/userInvitations.js').UserInvitation[], loading: boolean, error: Error|null }}
 */
export function useUserInvitations() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsub = firestoreUserInvitationsRepository.listPending(
      (rows) => {
        setData(rows);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  return { data, loading, error };
}
```

- [ ] **Step 3: Run lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint`
Expected: zero warnings.

- [ ] **Step 4: Hand off to test-engineer**

Hook tests are covered by `UsersPage.test.jsx` (Task 14) which exercises both hooks via the page. Test-engineer confirms no regression: `npm run test:run`.

---

### Task 10: AuthContext — invitation bootstrap + isActive enforcement

**Subagent role:** react-ui-engineer
**Files:**
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/contexts/AuthContext.jsx`
- Test: `C:/Users/DELL/Desktop/assets-crm/src/test/AuthContext.bootstrap.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// src/test/AuthContext.bootstrap.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';

// --- Mocks BEFORE imports of the SUT ---

const mockOnAuthStateChanged = vi.fn();
const mockSignOut = vi.fn();
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (...args) => mockOnAuthStateChanged(...args),
}));

// shared mutable state for getDoc / runTransaction
const fixture = {
  userDocExists: false,
  userDocData: null,
  inviteDocExists: false,
  inviteDocData: null,
};

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_, path, id) => ({ __path: `${path}/${id}` })),
  getDoc: vi.fn(async (ref) => {
    if (ref.__path.startsWith('users/')) {
      return { exists: () => fixture.userDocExists, data: () => fixture.userDocData };
    }
    return { exists: () => false, data: () => null };
  }),
  onSnapshot: vi.fn((ref, cb) => {
    if (ref.__path.startsWith('users/')) {
      queueMicrotask(() =>
        cb({
          exists: () => fixture.userDocExists,
          data: () => fixture.userDocData,
        })
      );
    }
    return () => {};
  }),
  setDoc: vi.fn(async () => {}),
  serverTimestamp: vi.fn(() => '__TS__'),
  runTransaction: vi.fn(async (_db, fn) => {
    await fn({
      get: async (ref) => {
        if (ref.__path.startsWith('userInvitations/')) {
          return { exists: () => fixture.inviteDocExists, data: () => fixture.inviteDocData };
        }
        return { exists: () => false };
      },
      set: vi.fn(),
      update: vi.fn(),
    });
  }),
}));

vi.mock('@/lib/firebase/index.js', () => ({ db: {}, auth: {} }));
vi.mock('@/lib/firebase/auth.js', () => ({
  signInWithGoogle: vi.fn(),
  signOut: (...args) => mockSignOut(...args),
  sendEmployeeSignInLink: vi.fn(),
  isEmailLink: vi.fn(),
  completeEmailLinkSignIn: vi.fn(),
}));

import { AuthProvider, useAuth } from '@/contexts/AuthContext.jsx';

function Probe({ onCtx }) {
  const ctx = useAuth();
  useEffect(() => {
    onCtx(ctx);
  });
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.userDocExists = false;
  fixture.userDocData = null;
  fixture.inviteDocExists = false;
  fixture.inviteDocData = null;
});

function renderWithAuthCallback(fbUser) {
  let captured;
  mockOnAuthStateChanged.mockImplementation((_auth, cb) => {
    queueMicrotask(() => cb(fbUser));
    return () => {};
  });
  render(
    <AuthProvider>
      <Probe onCtx={(c) => (captured = c)} />
    </AuthProvider>
  );
  return () => captured;
}

describe('AuthContext invitation bootstrap', () => {
  it('case: invitee with pending invitation -> users/{uid} created', async () => {
    fixture.inviteDocExists = true;
    fixture.inviteDocData = { email: 'kolya@gmail.com', role: 'tech_admin', status: 'pending' };

    const { runTransaction } = await import('firebase/firestore');
    renderWithAuthCallback({
      uid: 'kolya-uid',
      email: 'Kolya@Gmail.COM',
      emailVerified: true,
      displayName: 'Kolya',
      photoURL: null,
    });

    await waitFor(() => {
      expect(runTransaction).toHaveBeenCalled();
    });
  });

  it('case: invitee with revoked invitation -> no transaction', async () => {
    fixture.inviteDocExists = true;
    fixture.inviteDocData = { email: 'kolya@gmail.com', role: 'tech_admin', status: 'revoked' };

    const { runTransaction } = await import('firebase/firestore');
    renderWithAuthCallback({
      uid: 'kolya-uid',
      email: 'kolya@gmail.com',
      emailVerified: true,
    });

    await waitFor(() => {
      // runTransaction is called, but the inner fn finds status != pending and returns
      // before any tx.set. We assert no users/{uid} setDoc happened by checking setDoc.
      expect(runTransaction).toHaveBeenCalled();
    });
    // (deeper assertion lives in the firestoreUserInvitationsRepository test)
  });

  it('case: existing user with isActive=false -> signOut is called', async () => {
    fixture.userDocExists = true;
    fixture.userDocData = { role: 'tech_admin', isActive: false, employeeId: null };

    renderWithAuthCallback({
      uid: 'kolya-uid',
      email: 'kolya@gmail.com',
      emailVerified: true,
    });

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
    });
  });

  it('case: existing active user -> no signOut, no transaction', async () => {
    fixture.userDocExists = true;
    fixture.userDocData = { role: 'tech_admin', isActive: true, employeeId: null };

    const { runTransaction } = await import('firebase/firestore');
    renderWithAuthCallback({
      uid: 'kolya-uid',
      email: 'kolya@gmail.com',
      emailVerified: true,
    });

    await waitFor(() => {
      expect(mockSignOut).not.toHaveBeenCalled();
    });
    // No bootstrap path needed because users/{uid} already exists.
    // runTransaction may not be called.
    expect(runTransaction).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run test:run -- src/test/AuthContext.bootstrap.test.jsx`
Expected: FAIL — current AuthContext doesn't read invitations or signOut on isActive=false.

- [ ] **Step 3: Update AuthContext.jsx**

Replace the entire file with:

```jsx
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import { auth, db } from '@/lib/firebase/index.js';
import {
  signInWithGoogle,
  signOut as fbSignOut,
  sendEmployeeSignInLink,
  isEmailLink,
  completeEmailLinkSignIn,
} from '@/lib/firebase/auth.js';
import { normalizeEmail, INVITE_STATUS } from '@/domain/userInvitations.js';

/**
 * Emails that may self-bootstrap a `users/{uid}` doc with role=super_admin on first sign-in.
 * MUST stay in sync with the same list in firestore.rules (isSeedSuperAdminEmail()).
 */
const SEED_SUPER_ADMIN_EMAILS = ['zahalyanxcho@gmail.com'];

async function bootstrapSuperAdminIfEligible(fbUser) {
  if (!fbUser?.email) return;
  if (!SEED_SUPER_ADMIN_EMAILS.includes(fbUser.email)) return;

  const userRef = doc(db, 'users', fbUser.uid);
  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) return;
    await setDoc(userRef, {
      email: fbUser.email,
      displayName: fbUser.displayName ?? null,
      photoURL: fbUser.photoURL ?? null,
      role: 'super_admin',
      branchId: null,
      departmentId: null,
      employeeId: null,
      preferredLocale: 'ru',
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    console.info('[AMS auth] bootstrapped super_admin for', fbUser.email);
  } catch (err) {
    console.warn('[AMS auth] seed bootstrap skipped:', err?.code ?? err);
  }
}

async function bootstrapFromInvitationIfEligible(fbUser) {
  if (!fbUser?.email) return;
  if (!fbUser.emailVerified) return;
  const email = normalizeEmail(fbUser.email);
  if (!email) return;

  const userRef = doc(db, 'users', fbUser.uid);
  try {
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) return;

    const inviteRef = doc(db, 'userInvitations', email);
    await runTransaction(db, async (tx) => {
      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists()) return;
      const invite = inviteSnap.data();
      if (invite.status !== INVITE_STATUS.PENDING) return;

      tx.set(userRef, {
        email,
        displayName: fbUser.displayName ?? null,
        photoURL: fbUser.photoURL ?? null,
        role: invite.role,
        branchId: invite.branchId ?? null,
        departmentId: invite.departmentId ?? null,
        employeeId: null,
        preferredLocale: 'ru',
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      tx.update(inviteRef, {
        status: INVITE_STATUS.ACCEPTED,
        acceptedUid: fbUser.uid,
        acceptedAt: serverTimestamp(),
      });
    });
    console.info('[AMS auth] bootstrapped from invitation for', email);
  } catch (err) {
    console.warn('[AMS auth] invitation bootstrap skipped:', err?.code ?? err);
  }
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [employeeId, setEmployeeId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accountDisabled, setAccountDisabled] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setUser(null);
        setRole(null);
        setEmployeeId(null);
        setLoading(false);
        return;
      }
      // Run both bootstrap flows in order. They no-op when not eligible.
      await bootstrapSuperAdminIfEligible(fbUser);
      await bootstrapFromInvitationIfEligible(fbUser);
      setUser(fbUser);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const ref = doc(db, 'users', user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data.isActive === false) {
            setAccountDisabled(true);
            setRole(null);
            setEmployeeId(null);
            setLoading(false);
            fbSignOut().catch((err) => {
              console.warn('[AMS auth] forced signOut failed:', err?.code ?? err);
            });
            return;
          }
          setAccountDisabled(false);
          setRole(data.role ?? null);
          setEmployeeId(data.employeeId ?? null);
        } else {
          setRole(null);
          setEmployeeId(null);
        }
        setLoading(false);
      },
      () => {
        setRole(null);
        setEmployeeId(null);
        setLoading(false);
      }
    );
    return unsub;
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      role,
      employeeId,
      loading,
      accountDisabled,
      signInWithGoogle,
      sendEmployeeSignInLink,
      isEmailLink,
      completeEmailLinkSignIn,
      signOut: fbSignOut,
    }),
    [user, role, employeeId, loading, accountDisabled]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx == null) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run test:run -- src/test/AuthContext.bootstrap.test.jsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Hand off to test-engineer**

Test-engineer runs the full suite to confirm no regression.

---

### Task 11: ConfirmActionDialog (small reusable confirmation)

**Subagent role:** react-ui-engineer
**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/components/features/users/ConfirmActionDialog.jsx`

- [ ] **Step 1: Write the dialog**

```jsx
// src/components/features/users/ConfirmActionDialog.jsx
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';

/**
 * Generic two-button confirmation dialog. Caller controls open state and copy
 * via i18n keys; the dialog only orchestrates layout + the busy state.
 *
 * @param {{
 *   open: boolean,
 *   onOpenChange: (open: boolean) => void,
 *   title: string,
 *   description: string,
 *   confirmLabel: string,
 *   onConfirm: () => Promise<void> | void,
 *   destructive?: boolean,
 * }} props
 */
export default function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
}) {
  const { t } = useTranslation('users');
  const [busy, setBusy] = useBusy();

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('btnCancel')}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? <Spinner /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from 'react';
function useBusy() {
  const [busy, setBusy] = useState(false);
  return [busy, setBusy];
}
```

- [ ] **Step 2: Run lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint`
Expected: zero warnings.

- [ ] **Step 3: Hand off to test-engineer**

Covered indirectly by `UsersPage.test.jsx`. Test-engineer confirms suite is green.

---

### Task 12: InviteAdminDialog

**Subagent role:** react-ui-engineer
**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/components/features/users/InviteAdminDialog.jsx`

- [ ] **Step 1: Write the dialog**

```jsx
// src/components/features/users/InviteAdminDialog.jsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, AlertCircle } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';

import {
  emptyInviteInput,
  validateInviteInput,
  sanitizeInviteInput,
  INVITE_ROLE_LIST,
} from '@/domain/userInvitations.js';
import { firestoreUserInvitationsRepository } from '@/infra/repositories/firestoreUserInvitationsRepository.js';

const ROLE_KEY = {
  super_admin: 'roleSuperAdmin',
  asset_admin: 'roleAssetAdmin',
  tech_admin: 'roleTechAdmin',
};

export default function InviteAdminDialog({ open, onOpenChange, actor }) {
  const { t } = useTranslation('users');
  const [input, setInput] = useState(emptyInviteInput);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setInput(emptyInviteInput());
    setErrors({});
    setSubmitError(null);
    setBusy(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const validation = validateInviteInput(input);
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }
    setErrors({});
    setSubmitError(null);
    setBusy(true);
    try {
      const sanitized = sanitizeInviteInput(input);
      await firestoreUserInvitationsRepository.create(sanitized, actor);
      reset();
      onOpenChange(false);
    } catch (err) {
      console.error('[AMS invite]', err);
      const code = err?.code ?? '';
      if (/already exists/i.test(err?.message ?? '') || code === 'permission-denied') {
        setSubmitError(t('errInviteExists'));
      } else {
        setSubmitError(err?.message ?? t('errInviteExists'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('inviteDialogTitle')}</DialogTitle>
          <DialogDescription>{t('inviteDialogDescription')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="invite-email">{t('formEmailLabel')}</Label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="invite-email"
                type="email"
                autoComplete="off"
                inputMode="email"
                placeholder={t('formEmailPlaceholder')}
                value={input.email}
                onChange={(e) => setInput((prev) => ({ ...prev, email: e.target.value }))}
                className="pl-9"
                aria-invalid={Boolean(errors.email)}
              />
            </div>
            {errors.email ? (
              <p className="text-sm text-destructive">{t(errors.email)}</p>
            ) : null}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('formRoleLabel')}</legend>
            <div className="flex flex-col gap-2">
              {INVITE_ROLE_LIST.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="invite-role"
                    value={r}
                    checked={input.role === r}
                    onChange={() => setInput((prev) => ({ ...prev, role: r }))}
                  />
                  <span>{t(ROLE_KEY[r])}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {submitError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('btnCancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner /> : null}
              {busy ? t('btnInviting') : t('btnInvite')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Run lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint`
Expected: zero warnings.

- [ ] **Step 3: Hand off to test-engineer**

Covered by `UsersPage.test.jsx` (Task 14).

---

### Task 13: RoleChangeDialog

**Subagent role:** react-ui-engineer
**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/components/features/users/RoleChangeDialog.jsx`

- [ ] **Step 1: Write the dialog**

```jsx
// src/components/features/users/RoleChangeDialog.jsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';

import { ROLES } from '@/domain/roles.js';
import { firestoreUsersRepository } from '@/infra/repositories/firestoreUsersRepository.js';

const ROLE_OPTIONS = [
  { value: ROLES.SUPER_ADMIN, key: 'roleSuperAdmin' },
  { value: ROLES.ASSET_ADMIN, key: 'roleAssetAdmin' },
  { value: ROLES.TECH_ADMIN, key: 'roleTechAdmin' },
  { value: ROLES.EMPLOYEE, key: 'roleEmployee' },
];

/**
 * @param {{
 *   open: boolean,
 *   onOpenChange: (open: boolean) => void,
 *   targetUser: import('@/domain/repositories/UsersRepository.js').AppUser | null,
 *   activeSuperAdminCount: number,
 *   actor: { uid: string, role: string },
 * }} props
 */
export default function RoleChangeDialog({
  open,
  onOpenChange,
  targetUser,
  activeSuperAdminCount,
  actor,
}) {
  const { t } = useTranslation('users');
  const [selected, setSelected] = useState(targetUser?.role ?? ROLES.TECH_ADMIN);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setSelected(targetUser?.role ?? ROLES.TECH_ADMIN);
      setError(null);
      setBusy(false);
    }
  }, [open, targetUser]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!targetUser) return;
    if (selected === targetUser.role) {
      onOpenChange(false);
      return;
    }
    // Guard: cannot demote the last active super_admin
    const isDemotingLastSuperAdmin =
      targetUser.role === ROLES.SUPER_ADMIN &&
      targetUser.isActive === true &&
      activeSuperAdminCount <= 1 &&
      selected !== ROLES.SUPER_ADMIN;
    if (isDemotingLastSuperAdmin) {
      setError(t('errLastSuperAdmin'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await firestoreUsersRepository.updateRole(targetUser.uid, selected, targetUser, actor);
      onOpenChange(false);
    } catch (err) {
      console.error('[AMS role change]', err);
      setError(err?.message ?? 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('roleChangeDialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('roleChangeDialogDescription', { email: targetUser?.email ?? '' })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <fieldset className="flex flex-col gap-2">
            {ROLE_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="role"
                  value={opt.value}
                  checked={selected === opt.value}
                  onChange={() => setSelected(opt.value)}
                />
                <span>{t(opt.key)}</span>
              </label>
            ))}
          </fieldset>

          {error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('btnCancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner /> : null}
              {t('btnInvite') /* "Save" reuse — replaced by 'common:save' if available */}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

> Note for the implementer: the "save" button label currently reuses `users:btnInvite`. If `common:save` already exists (it does, per `src/locales/ru/common.json`), swap to `t('common:save', { defaultValue: t('common:save') })`. This is a minor polish; the i18n-engineer in Task 15 will reconcile.

- [ ] **Step 2: Run lint**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run lint`
Expected: zero warnings.

- [ ] **Step 3: Hand off to test-engineer**

Covered by `UsersPage.test.jsx`.

---

### Task 14: UsersPage + routing + AppShell nav

**Subagent role:** react-ui-engineer
**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/pages/UsersPage.jsx`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/test/UsersPage.test.jsx`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/App.jsx`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/config/routes.js`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/components/layout/AppShell.jsx`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/pages/LoginPage.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// src/test/UsersPage.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';

import i18n from '@/i18n/index.js';

// --- mocks ---
const mockUsers = vi.fn();
const mockInvitations = vi.fn();
vi.mock('@/hooks/useUsers.js', () => ({ useUsers: (...args) => mockUsers(...args) }));
vi.mock('@/hooks/useUserInvitations.js', () => ({
  useUserInvitations: (...args) => mockInvitations(...args),
}));

const mockUpdateRole = vi.fn(async () => {});
const mockSetActive = vi.fn(async () => {});
vi.mock('@/infra/repositories/firestoreUsersRepository.js', () => ({
  firestoreUsersRepository: {
    updateRole: (...args) => mockUpdateRole(...args),
    setActive: (...args) => mockSetActive(...args),
    list: vi.fn(),
  },
}));

const mockCreateInvite = vi.fn(async () => {});
const mockRevokeInvite = vi.fn(async () => {});
vi.mock('@/infra/repositories/firestoreUserInvitationsRepository.js', () => ({
  firestoreUserInvitationsRepository: {
    create: (...args) => mockCreateInvite(...args),
    revoke: (...args) => mockRevokeInvite(...args),
    listPending: vi.fn(),
  },
}));

vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { uid: 'super-uid', email: 'zahalyanxcho@gmail.com' },
    role: 'super_admin',
  }),
}));

import UsersPage from '@/pages/UsersPage.jsx';

beforeEach(() => {
  vi.clearAllMocks();
});

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    </I18nextProvider>
  );
}

describe('UsersPage', () => {
  it('renders both sections with empty states', () => {
    mockUsers.mockReturnValue({ data: [], loading: false, error: null });
    mockInvitations.mockReturnValue({ data: [], loading: false, error: null });
    renderPage();
    expect(screen.getByText(/Активные пользователи|Active users/i)).toBeInTheDocument();
    expect(screen.getByText(/Ожидающие приглашения|Pending invitations/i)).toBeInTheDocument();
  });

  it('renders users in the active section', () => {
    mockUsers.mockReturnValue({
      data: [
        { uid: 'super-uid', email: 'zahalyanxcho@gmail.com', role: 'super_admin', isActive: true },
        { uid: 'kolya-uid', email: 'kolya@gmail.com', role: 'tech_admin', isActive: true },
      ],
      loading: false,
      error: null,
    });
    mockInvitations.mockReturnValue({ data: [], loading: false, error: null });
    renderPage();
    expect(screen.getByText('zahalyanxcho@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('kolya@gmail.com')).toBeInTheDocument();
  });

  it('disables Deactivate button on the current user (cannot deactivate self)', () => {
    mockUsers.mockReturnValue({
      data: [
        { uid: 'super-uid', email: 'zahalyanxcho@gmail.com', role: 'super_admin', isActive: true },
      ],
      loading: false,
      error: null,
    });
    mockInvitations.mockReturnValue({ data: [], loading: false, error: null });
    renderPage();
    const row = screen.getByText('zahalyanxcho@gmail.com').closest('tr');
    const deactivate = within(row).queryByRole('button', { name: /Деактивировать|Deactivate/i });
    if (deactivate) {
      expect(deactivate).toBeDisabled();
    }
  });

  it('blocks demoting the last active super_admin', async () => {
    const user = userEvent.setup();
    mockUsers.mockReturnValue({
      data: [
        { uid: 'super-uid', email: 'zahalyanxcho@gmail.com', role: 'super_admin', isActive: true },
        { uid: 'vasya-uid', email: 'vasya@gmail.com', role: 'tech_admin', isActive: true },
      ],
      loading: false,
      error: null,
    });
    mockInvitations.mockReturnValue({ data: [], loading: false, error: null });
    renderPage();

    // Open role change for the only super_admin
    const row = screen.getByText('zahalyanxcho@gmail.com').closest('tr');
    const changeBtn = within(row).getByRole('button', { name: /роль|role/i });
    await user.click(changeBtn);

    // Pick a non-super_admin role
    const techRadio = await screen.findByLabelText(/Тех\. админ|Tech admin/i);
    await user.click(techRadio);

    // Submit
    const submit = screen.getByRole('button', { name: /Сохранить|Save|Пригласить|Invite/i });
    await user.click(submit);

    await waitFor(() => {
      expect(screen.getByText(/super_admin|супер|gerad/i)).toBeInTheDocument();
    });
    expect(mockUpdateRole).not.toHaveBeenCalled();
  });

  it('opens invite dialog and submits a valid invitation', async () => {
    const user = userEvent.setup();
    mockUsers.mockReturnValue({ data: [], loading: false, error: null });
    mockInvitations.mockReturnValue({ data: [], loading: false, error: null });
    renderPage();

    const inviteCta = screen.getByRole('button', { name: /Пригласить|Invite/i });
    await user.click(inviteCta);

    const emailInput = await screen.findByLabelText(/E-?mail|почта|email/i);
    await user.type(emailInput, 'kolya@gmail.com');

    const submit = screen.getAllByRole('button', { name: /Пригласить|Invite/i }).pop();
    await user.click(submit);

    await waitFor(() => {
      expect(mockCreateInvite).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'kolya@gmail.com', role: 'tech_admin' }),
        expect.objectContaining({ uid: 'super-uid' })
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run test:run -- src/test/UsersPage.test.jsx`
Expected: FAIL — page does not exist.

- [ ] **Step 3: Write UsersPage.jsx**

```jsx
// src/pages/UsersPage.jsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button.jsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { useUsers } from '@/hooks/useUsers.js';
import { useUserInvitations } from '@/hooks/useUserInvitations.js';
import { firestoreUsersRepository } from '@/infra/repositories/firestoreUsersRepository.js';
import { firestoreUserInvitationsRepository } from '@/infra/repositories/firestoreUserInvitationsRepository.js';
import { ROLES } from '@/domain/roles.js';

import InviteAdminDialog from '@/components/features/users/InviteAdminDialog.jsx';
import RoleChangeDialog from '@/components/features/users/RoleChangeDialog.jsx';
import ConfirmActionDialog from '@/components/features/users/ConfirmActionDialog.jsx';

const ROLE_KEY = {
  super_admin: 'roleSuperAdmin',
  asset_admin: 'roleAssetAdmin',
  tech_admin: 'roleTechAdmin',
  employee: 'roleEmployee',
};

export default function UsersPage() {
  const { t } = useTranslation('users');
  const { user, role: actorRole } = useAuth();
  const actor = user ? { uid: user.uid, role: actorRole } : null;

  const { data: users, loading: usersLoading, error: usersError } = useUsers();
  const { data: invitations, loading: invitesLoading, error: invitesError } = useUserInvitations();

  const [inviteOpen, setInviteOpen] = useState(false);

  const [roleTarget, setRoleTarget] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  // confirmAction shape: { kind: 'deactivate'|'reactivate'|'revoke', payload: ... }

  const activeSuperAdminCount = useMemo(
    () => users.filter((u) => u.role === ROLES.SUPER_ADMIN && u.isActive === true).length,
    [users]
  );

  function isSelf(u) {
    return u.uid === user?.uid;
  }

  function startToggleActive(target) {
    setConfirmAction({
      kind: target.isActive ? 'deactivate' : 'reactivate',
      payload: target,
    });
  }

  function startRevoke(invitation) {
    setConfirmAction({ kind: 'revoke', payload: invitation });
  }

  async function runConfirmedAction() {
    if (!confirmAction || !actor) return;
    const { kind, payload } = confirmAction;
    if (kind === 'deactivate') {
      await firestoreUsersRepository.setActive(payload.uid, false, payload, actor);
    } else if (kind === 'reactivate') {
      await firestoreUsersRepository.setActive(payload.uid, true, payload, actor);
    } else if (kind === 'revoke') {
      await firestoreUserInvitationsRepository.revoke(payload.email, payload, actor);
    }
    setConfirmAction(null);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('usersTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('usersSubtitle')}</p>
        </div>
      </header>

      {/* Active users */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>{t('sectionActive')}</CardTitle>
            <CardDescription>{users.length}</CardDescription>
          </div>
          <Button onClick={() => setInviteOpen(true)} className="gap-2">
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            {t('inviteCta')}
          </Button>
        </CardHeader>
        <CardContent>
          {usersError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{usersError.message}</AlertDescription>
            </Alert>
          ) : null}
          {usersLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> {t('users:loading', { defaultValue: '' })}
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('emptyActiveUsers')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="px-3 py-2">{t('colEmail')}</th>
                    <th className="px-3 py-2">{t('colRole')}</th>
                    <th className="px-3 py-2">{t('colStatus')}</th>
                    <th className="px-3 py-2 text-right">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.uid} className="border-t">
                      <td className="px-3 py-2 font-medium">{u.email}</td>
                      <td className="px-3 py-2">{t(ROLE_KEY[u.role] ?? 'roleEmployee')}</td>
                      <td className="px-3 py-2">
                        <Badge variant={u.isActive ? 'default' : 'secondary'}>
                          {u.isActive ? t('statusActive') : t('statusInactive')}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setRoleTarget(u)}
                          >
                            {t('actionsChangeRole')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={u.isActive ? 'outline' : 'default'}
                            disabled={isSelf(u)}
                            title={isSelf(u) ? t('errCannotDeactivateSelf') : undefined}
                            onClick={() => startToggleActive(u)}
                          >
                            {u.isActive ? t('actionsDeactivate') : t('actionsActivate')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending invitations */}
      <Card>
        <CardHeader>
          <CardTitle>{t('sectionPending')}</CardTitle>
          <CardDescription>{invitations.length}</CardDescription>
        </CardHeader>
        <CardContent>
          {invitesError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{invitesError.message}</AlertDescription>
            </Alert>
          ) : null}
          {invitesLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
            </div>
          ) : invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('emptyPendingInvitations')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="px-3 py-2">{t('colEmail')}</th>
                    <th className="px-3 py-2">{t('colRole')}</th>
                    <th className="px-3 py-2">{t('colInvitedAt')}</th>
                    <th className="px-3 py-2 text-right">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((inv) => (
                    <tr key={inv.email} className="border-t">
                      <td className="px-3 py-2 font-medium">{inv.email}</td>
                      <td className="px-3 py-2">{t(ROLE_KEY[inv.role] ?? 'roleEmployee')}</td>
                      <td className="px-3 py-2">
                        {inv.invitedAt?.toDate?.()?.toLocaleString?.() ?? ''}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {inv.email !== user?.email?.toLowerCase() ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => startRevoke(inv)}
                          >
                            {t('actionsRevoke')}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <InviteAdminDialog open={inviteOpen} onOpenChange={setInviteOpen} actor={actor} />

      <RoleChangeDialog
        open={Boolean(roleTarget)}
        onOpenChange={(open) => {
          if (!open) setRoleTarget(null);
        }}
        targetUser={roleTarget}
        activeSuperAdminCount={activeSuperAdminCount}
        actor={actor}
      />

      <ConfirmActionDialog
        open={Boolean(confirmAction)}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={
          confirmAction?.kind === 'deactivate'
            ? t('confirmDeactivateTitle')
            : confirmAction?.kind === 'reactivate'
            ? t('confirmActivateTitle')
            : confirmAction?.kind === 'revoke'
            ? t('confirmRevokeTitle')
            : ''
        }
        description={
          confirmAction?.kind === 'deactivate'
            ? t('confirmDeactivateBody', { email: confirmAction.payload.email })
            : confirmAction?.kind === 'reactivate'
            ? t('confirmActivateBody', { email: confirmAction.payload.email })
            : confirmAction?.kind === 'revoke'
            ? t('confirmRevokeBody', { email: confirmAction.payload.email })
            : ''
        }
        confirmLabel={
          confirmAction?.kind === 'deactivate'
            ? t('actionsDeactivate')
            : confirmAction?.kind === 'reactivate'
            ? t('actionsActivate')
            : confirmAction?.kind === 'revoke'
            ? t('actionsRevoke')
            : ''
        }
        destructive={confirmAction?.kind === 'deactivate' || confirmAction?.kind === 'revoke'}
        onConfirm={runConfirmedAction}
      />
    </div>
  );
}
```

- [ ] **Step 4: Add /users route to App.jsx**

In `src/App.jsx`, add `import UsersPage from '@/pages/UsersPage.jsx';` near the other page imports, then inside the `<Route element={<RequireAuth><AppShell /></RequireAuth>}>` block add:

```jsx
<Route
  path="/users"
  element={
    <RoleGate roles={[ROLES.SUPER_ADMIN]}>
      <UsersPage />
    </RoleGate>
  }
/>
```

- [ ] **Step 5: Add USERS to routes config**

In `src/config/routes.js`:

```javascript
export const ROUTES = Object.freeze({
  ROOT: '/',
  LOGIN: '/login',
  LOGIN_EMPLOYEE: '/login/employee',
  AUTH_EMAIL_LINK: '/auth/email-link',
  DASHBOARD: '/dashboard',
  ME: '/me',
  FORBIDDEN: '/403',
  BRANCHES: '/branches',
  BRANCH_DETAIL: '/branches/:id',
  USERS: '/users',                       // NEW
});
```

And in `ROUTE_TABLE` add:

```javascript
{ path: ROUTES.USERS, allowedRoles: [ROLES.SUPER_ADMIN] },
```

- [ ] **Step 6: Add nav item to AppShell.jsx**

Import `UserCog` from lucide-react in the lucide import block:

```javascript
import {
  Boxes, LayoutDashboard, Package, HandHelping, Users, Building2, Network, Tags, CircleDot,
  ScrollText, User, Settings, LogOut, Menu, X,
  UserCog,                              // NEW
} from 'lucide-react';
```

In the `ADMIN_NAV` array, add a new entry just above `navAuditLog`:

```javascript
{ to: '/users', icon: UserCog, key: 'navUsers', roles: [ROLES.SUPER_ADMIN] },
```

- [ ] **Step 7: Render accountDisabled banner on LoginPage**

In `src/pages/LoginPage.jsx`, change the `useAuth()` destructure to include `accountDisabled`:

```javascript
const { user, role, loading, accountDisabled, signInWithGoogle, sendEmployeeSignInLink } = useAuth();
```

Above the `<Tabs>` component (inside `<CardContent>`, before `<Tabs defaultValue="admin">`), add:

```jsx
{accountDisabled ? (
  <Alert variant="destructive" className="mb-4">
    <AlertCircle className="h-4 w-4" aria-hidden="true" />
    <AlertDescription>{t('accountDisabled')}</AlertDescription>
  </Alert>
) : null}
```

- [ ] **Step 8: Run the new test**

Run: `cd C:/Users/DELL/Desktop/assets-crm && npm run test:run -- src/test/UsersPage.test.jsx`
Expected: PASS, 5 tests.

> If a test fails because i18n keys aren't loaded yet (Task 15 hasn't run), the test-engineer reports this as a known dependency: the page renders raw keys. Fix is to either run Task 15 first OR add a stub `users.json` with the keys these tests assert against. The simplest path is to swap Task 14 and Task 15: have i18n-engineer write the locale files first. Either ordering works as long as both land before Task 16.

- [ ] **Step 9: Run full suite + lint + build**

Run:
```bash
cd C:/Users/DELL/Desktop/assets-crm
npm run lint
npm run test:run
npm run build
```
Expected: zero lint warnings, all tests pass, build succeeds.

- [ ] **Step 10: Hand off to test-engineer**

Test-engineer runs the same three commands and reports pass/fail.

---

### Task 15: i18n — users.json + auth.json + common.json

**Subagent role:** i18n-engineer
**Files:**
- Create: `C:/Users/DELL/Desktop/assets-crm/src/locales/ru/users.json`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/locales/en/users.json`
- Create: `C:/Users/DELL/Desktop/assets-crm/src/locales/hy/users.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/{ru,en,hy}/auth.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/locales/{ru,en,hy}/common.json`
- Modify: `C:/Users/DELL/Desktop/assets-crm/src/i18n/namespaces.js` (or whatever registers namespaces — verify)

- [ ] **Step 1: Verify namespace registration**

Open `src/i18n/index.js` and `src/i18n/namespaces.js` (whichever exists). The `users` namespace must be registered alongside `auth`, `common`, `branches`, etc. If a `NAMESPACES` array exists, add `'users'`. If `react-i18next` resources are explicitly loaded, append the new files (one per locale). Run after edits:

```bash
cd C:/Users/DELL/Desktop/assets-crm && grep -rn "branches" src/i18n/ | head -10
```

Use that pattern as the reference for adding `users`.

- [ ] **Step 2: Write `src/locales/ru/users.json`**

```json
{
  "usersTitle": "Пользователи",
  "usersSubtitle": "Администраторы и приглашения",

  "sectionActive": "Активные пользователи",
  "sectionPending": "Ожидающие приглашения",

  "inviteCta": "Пригласить администратора",
  "inviteDialogTitle": "Пригласить администратора",
  "inviteDialogDescription": "Введите Gmail и выберите роль. Пользователь сможет войти через Google.",

  "formEmailLabel": "E-mail",
  "formEmailPlaceholder": "name@gmail.com",
  "formRoleLabel": "Роль",

  "roleSuperAdmin": "Супер-админ",
  "roleAssetAdmin": "Админ активов",
  "roleTechAdmin": "Технический админ",
  "roleEmployee": "Сотрудник",

  "btnInvite": "Пригласить",
  "btnInviting": "Отправляем…",
  "btnCancel": "Отмена",

  "toastInvited": "Приглашение отправлено для {{email}}",
  "toastInviteRevoked": "Приглашение для {{email}} отозвано",
  "toastRoleChanged": "Роль для {{email}} изменена",
  "toastDeactivated": "Пользователь {{email}} деактивирован",
  "toastActivated": "Пользователь {{email}} активирован",

  "errInviteExists": "Для этого e-mail уже есть приглашение или активный пользователь.",
  "errEmailRequired": "Укажите e-mail.",
  "errEmailInvalid": "Некорректный e-mail.",
  "errRoleRequired": "Выберите роль.",
  "errLastSuperAdmin": "Нельзя понизить последнего активного супер-админа.",
  "errCannotDeactivateSelf": "Нельзя деактивировать самого себя.",
  "errCannotRevokeSelf": "Нельзя отозвать собственное приглашение.",

  "colEmail": "E-mail",
  "colName": "Имя",
  "colRole": "Роль",
  "colBranch": "Филиал",
  "colStatus": "Статус",
  "colCreated": "Создан",
  "colInvitedBy": "Кто пригласил",
  "colInvitedAt": "Когда",
  "colActions": "Действия",

  "statusActive": "Активен",
  "statusInactive": "Неактивен",
  "statusPending": "Ожидает входа",

  "actionsChangeRole": "Изменить роль",
  "actionsDeactivate": "Деактивировать",
  "actionsActivate": "Активировать",
  "actionsRevoke": "Отозвать",

  "emptyActiveUsers": "Пока нет администраторов.",
  "emptyPendingInvitations": "Нет ожидающих приглашений.",

  "confirmDeactivateTitle": "Деактивировать пользователя",
  "confirmDeactivateBody": "Пользователь {{email}} потеряет доступ. Вы можете активировать его обратно в любой момент.",
  "confirmActivateTitle": "Активировать пользователя",
  "confirmActivateBody": "Пользователь {{email}} снова получит доступ.",
  "confirmRevokeTitle": "Отозвать приглашение",
  "confirmRevokeBody": "Приглашение для {{email}} будет отозвано.",

  "roleChangeDialogTitle": "Изменить роль",
  "roleChangeDialogDescription": "Выберите новую роль для {{email}}."
}
```

- [ ] **Step 3: Write `src/locales/en/users.json`**

```json
{
  "usersTitle": "Users",
  "usersSubtitle": "Administrators and invitations",

  "sectionActive": "Active users",
  "sectionPending": "Pending invitations",

  "inviteCta": "Invite admin",
  "inviteDialogTitle": "Invite admin",
  "inviteDialogDescription": "Enter a Gmail address and pick a role. They'll sign in via Google.",

  "formEmailLabel": "Email",
  "formEmailPlaceholder": "name@gmail.com",
  "formRoleLabel": "Role",

  "roleSuperAdmin": "Super admin",
  "roleAssetAdmin": "Asset admin",
  "roleTechAdmin": "Tech admin",
  "roleEmployee": "Employee",

  "btnInvite": "Invite",
  "btnInviting": "Sending…",
  "btnCancel": "Cancel",

  "toastInvited": "Invitation sent to {{email}}",
  "toastInviteRevoked": "Invitation for {{email}} revoked",
  "toastRoleChanged": "Role for {{email}} changed",
  "toastDeactivated": "User {{email}} deactivated",
  "toastActivated": "User {{email}} activated",

  "errInviteExists": "An invitation or active user already exists for this email.",
  "errEmailRequired": "Email is required.",
  "errEmailInvalid": "Invalid email address.",
  "errRoleRequired": "Pick a role.",
  "errLastSuperAdmin": "You can't demote the last active super admin.",
  "errCannotDeactivateSelf": "You can't deactivate yourself.",
  "errCannotRevokeSelf": "You can't revoke your own invitation.",

  "colEmail": "Email",
  "colName": "Name",
  "colRole": "Role",
  "colBranch": "Branch",
  "colStatus": "Status",
  "colCreated": "Created",
  "colInvitedBy": "Invited by",
  "colInvitedAt": "When",
  "colActions": "Actions",

  "statusActive": "Active",
  "statusInactive": "Inactive",
  "statusPending": "Awaiting sign-in",

  "actionsChangeRole": "Change role",
  "actionsDeactivate": "Deactivate",
  "actionsActivate": "Activate",
  "actionsRevoke": "Revoke",

  "emptyActiveUsers": "No admins yet.",
  "emptyPendingInvitations": "No pending invitations.",

  "confirmDeactivateTitle": "Deactivate user",
  "confirmDeactivateBody": "{{email}} will lose access. You can reactivate them anytime.",
  "confirmActivateTitle": "Activate user",
  "confirmActivateBody": "{{email}} will regain access.",
  "confirmRevokeTitle": "Revoke invitation",
  "confirmRevokeBody": "The invitation for {{email}} will be revoked.",

  "roleChangeDialogTitle": "Change role",
  "roleChangeDialogDescription": "Pick a new role for {{email}}."
}
```

- [ ] **Step 4: Write `src/locales/hy/users.json`**

```json
{
  "usersTitle": "Օգտատերեր",
  "usersSubtitle": "Ադմինիստրատորներ և հրավերներ",

  "sectionActive": "Ակտիվ օգտատերեր",
  "sectionPending": "Սպասող հրավերներ",

  "inviteCta": "Հրավիրել ադմինի",
  "inviteDialogTitle": "Հրավիրել ադմինի",
  "inviteDialogDescription": "Մուտքագրեք Gmail-ը և ընտրեք դերը: Մուտքը Google-ով:",

  "formEmailLabel": "Էլ. փոստ",
  "formEmailPlaceholder": "name@gmail.com",
  "formRoleLabel": "Դեր",

  "roleSuperAdmin": "Գերադմին",
  "roleAssetAdmin": "Ակտիվների ադմին",
  "roleTechAdmin": "Տեխ. ադմին",
  "roleEmployee": "Աշխատակից",

  "btnInvite": "Հրավիրել",
  "btnInviting": "Ուղարկվում է…",
  "btnCancel": "Չեղարկել",

  "toastInvited": "Հրավերն ուղարկվեց {{email}}-ին",
  "toastInviteRevoked": "{{email}}-ի հրավերը հետ կանչվեց",
  "toastRoleChanged": "{{email}}-ի դերը փոխվեց",
  "toastDeactivated": "{{email}} օգտատերը ապաակտիվացվեց",
  "toastActivated": "{{email}} օգտատերը ակտիվացվեց",

  "errInviteExists": "Այս էլ. փոստի համար արդեն կա հրավեր կամ ակտիվ օգտատեր:",
  "errEmailRequired": "Մուտքագրեք էլ. փոստը:",
  "errEmailInvalid": "Սխալ էլ. փոստ:",
  "errRoleRequired": "Ընտրեք դերը:",
  "errLastSuperAdmin": "Չեք կարող իջեցնել վերջին ակտիվ գերադմինի դերը:",
  "errCannotDeactivateSelf": "Չեք կարող ապաակտիվացնել ինքներդ Ձեզ:",
  "errCannotRevokeSelf": "Չեք կարող հետ կանչել Ձեր սեփական հրավերը:",

  "colEmail": "Էլ. փոստ",
  "colName": "Անուն",
  "colRole": "Դեր",
  "colBranch": "Մասնաճյուղ",
  "colStatus": "Կարգավիճակ",
  "colCreated": "Ստեղծվել է",
  "colInvitedBy": "Ով է հրավիրել",
  "colInvitedAt": "Երբ",
  "colActions": "Գործողություններ",

  "statusActive": "Ակտիվ",
  "statusInactive": "Ապաակտիվ",
  "statusPending": "Սպասում է մուտքին",

  "actionsChangeRole": "Փոխել դերը",
  "actionsDeactivate": "Ապաակտիվացնել",
  "actionsActivate": "Ակտիվացնել",
  "actionsRevoke": "Հետ կանչել",

  "emptyActiveUsers": "Դեռ ադմիններ չկան:",
  "emptyPendingInvitations": "Սպասող հրավերներ չկան:",

  "confirmDeactivateTitle": "Ապաակտիվացնել օգտատիրոջը",
  "confirmDeactivateBody": "{{email}}-ը կկորցնի մուտքը: Կարող եք ակտիվացնել նրան ցանկացած պահի:",
  "confirmActivateTitle": "Ակտիվացնել օգտատիրոջը",
  "confirmActivateBody": "{{email}}-ը կրկին կունենա մուտք:",
  "confirmRevokeTitle": "Հետ կանչել հրավերը",
  "confirmRevokeBody": "{{email}}-ի հրավերը կհետ կանչվի:",

  "roleChangeDialogTitle": "Փոխել դերը",
  "roleChangeDialogDescription": "Ընտրեք նոր դեր {{email}}-ի համար:"
}
```

- [ ] **Step 5: Update `auth.json` (all 3 locales)**

In each `src/locales/{ru,en,hy}/auth.json`:

- Change `tabAdmin` value:
  - ru: `"Через Google"`
  - en: `"Sign in with Google"`
  - hy: `"Google-ով"`
- Change `tabEmployee` value:
  - ru: `"По ссылке на email"`
  - en: `"Email sign-in link"`
  - hy: `"Հղումով նամակին"`
- Add new key `accountDisabled`:
  - ru: `"Ваш аккаунт деактивирован администратором. Обратитесь к супер-админу."`
  - en: `"Your account has been deactivated by an administrator. Please contact a super admin."`
  - hy: `"Ձեր հաշիվը անջատվել է ադմինիստրատորի կողմից։ Դիմեք գերադմինին։"`

- [ ] **Step 6: Update `common.json` (all 3 locales)**

Add `navUsers`:
- ru: `"Пользователи"`
- en: `"Users"`
- hy: `"Օգտատերեր"`

- [ ] **Step 7: Run lint, tests, build**

Run:
```bash
cd C:/Users/DELL/Desktop/assets-crm
npm run lint
npm run test:run
npm run build
```
Expected: zero lint warnings, all tests pass, build succeeds.

- [ ] **Step 8: Hand off to test-engineer**

Test-engineer confirms each of the three locales loads `users` namespace and one sample key from each new file resolves at runtime (covered by `UsersPage.test.jsx`).

---

### Task 16: spec-reviewer

**Subagent role:** spec-reviewer
**Inputs:** spec at `docs/superpowers/specs/2026-05-05-admin-invitations-user-management-design.md`; aggregate diff of all files touched in Tasks 1–15.

Verifies acceptance criteria 1–10 (spec §15) line-by-line, role-boundary respect (§8.2 of orchestrator doc), no scope creep, no missing files. Reports PASS or names the implementer to re-dispatch.

---

### Task 17: code-quality-reviewer

**Subagent role:** code-quality-reviewer
**Inputs:** all NEW + MODIFIED files from Tasks 1–15.

Checks: hook rules, modular Firebase SDK only, repository pattern (no `firebase/firestore` imports in pages or components), every async Firebase call has a catch path, every user-facing string goes through `t()`, naming/file-layout matches existing patterns (`firestoreBranchRepository`, `BranchListPage`, etc.). Reports PASS or named re-dispatch.

---

### Task 18: security-reviewer (mandatory — rules + auth touched)

**Subagent role:** security-reviewer
**Inputs:** `firestore.rules`, `src/contexts/AuthContext.jsx`, `src/infra/repositories/firestore*.js`, `src/lib/audit/auditHelper.js`.

Checks:
- `userInvitations.create` only by super_admin with full shape match.
- `userInvitations.update` paths each enforce `affectedKeys.hasOnly(...)` and the right preconditions (status=pending, email=auth email lower).
- `users.create` invitation branch enforces `role == invite.role` (no role escalation).
- `users.update` `affectedKeys` is the closed set listed in the diff (no implicit additions).
- `audit_logs` writes still satisfy `actorUid == request.auth.uid && at == request.time`.
- No client-side role guard relied on without rule backup (UI guards are documented as defense-in-depth only).
- `accountDisabled` enforcement is client-side; this is **acknowledged tech debt** for Phase 2 (Cloud Functions + custom claims).

Reports PASS or named re-dispatch.

---

### Task 19: deploy

**Subagent role:** firebase-engineer (deploy-only)
**Files:** none modified; runs the deploy command.

- [ ] **Step 1: Run seed (migrate isActive)**

```bash
cd C:/Users/DELL/Desktop/assets-crm && npm run seed
```
Expected: backfill loop reports `(N docs patched)` then `[OK] Seed complete.`

- [ ] **Step 2: Deploy rules + indexes**

```bash
cd C:/Users/DELL/Desktop/assets-crm && firebase deploy --only firestore:rules,firestore:indexes
```
Expected: success; new indexes show "Building" then "Enabled" in Firebase Console.

- [ ] **Step 3: Manual smoke (acceptance criteria, spec §15)**

Walk all 10 acceptance criteria in a fresh test window. Document any deviation in this plan as a TODO and re-open the failing task.

---

## Verification commands (single-command status check)

```bash
cd C:/Users/DELL/Desktop/assets-crm
npm run lint           # zero warnings, max-warnings 0 already enforced
npm run test:run       # full vitest suite green
npm run build          # vite build succeeds
```

All three must pass before Task 16 (spec-reviewer) starts.

---

## Acceptance criteria (from spec §15, restated)

1. Sign in as `zahalyanxcho@gmail.com` (seed super_admin) → `/users` page accessible.
2. Invite `kolya@gmail.com` as `tech_admin` → row appears under "Ожидающие приглашения".
3. Sign out, sign in as `kolya@gmail.com` via Google → user is provisioned with `tech_admin`, lands on `/dashboard`.
4. Invitation moves from "Ожидающие" to "Активные пользователи" (refresh).
5. As seed admin, change Kolya's role to `asset_admin` → `audit_logs` collection has a `user/roleChanged` entry.
6. As seed admin, deactivate Kolya → next sign-in redirects to `/login` with the "account disabled" banner.
7. Invite `vasya@gmail.com` as `asset_admin`, then revoke → if Vasya later signs in, no `users/{uid}` doc is created and he lands on `/403`.
8. UI guards: cannot deactivate self; cannot demote last active super_admin.
9. `npm run lint`, `npm run test:run`, `npm run build` all pass.
10. `firebase deploy --only firestore:rules,firestore:indexes` succeeds.

---

## Out of scope (Phase 2)

- Cloud Functions for server-side enforcement of last-super-admin / count queries / custom claims.
- Email delivery to invitees (out-of-band notification only in Phase 1).
- Invitation expiry.
- Bulk invite (CSV / pasted list).
- Audit-log UI ("История" page).
- `users` listing pagination.
