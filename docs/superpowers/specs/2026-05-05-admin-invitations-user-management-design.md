# Admin Invitations & User Management — Design Spec

**Feature code name:** `admin-invitations-user-management`
**Spec author:** orchestrator
**Spec date:** 2026-05-05
**Stage:** Phase 1 (MVP), Stage C
**Status:** approved by user (2026-05-06) — ready for implementation plan
**Related features:** `docs/features/authentication.md`, `docs/features/audit-trail.md`, `docs/features/roles-and-permissions.md`

---

## 1. Goal

Give the founding `super_admin` (currently `zahalyanxcho@gmail.com`) a real way to grow the admin team without service-account scripts: open a `/users` page, click **Invite**, paste a Gmail address, pick a role (`super_admin` / `asset_admin` / `tech_admin`) — and that person becomes a fully-roled user the moment they sign in with Google for the first time.

The user phrased the requirement verbatim:

> «это хорошая решение, где супер админ может назначить кого то по gmail — Assets Admin or Tech Admin, в будущем в логах (раздел История) понятно будет кто что делал, в архитектуре нам надо внедрить такую схему логику, на пример зашли через Супер Админ назначили `kolya@gmail.com` — Tech Admin, `vasya@gmail.com` — Asset Admin»

Audit-trail integration is part of the goal: every admin action on this surface (`invitation.created`, `invitation.revoked`, `user.roleChanged`, `user.deactivated`, `user.reactivated`) lands in `audit_logs/` so the future "История" page can answer *who invited whom and when*.

This is a **client-only / Spark-plan** implementation. No Cloud Functions. No custom claims. The invitation handshake is a self-bootstrap pattern enforced by Firestore security rules — directly analogous to the existing seed-super-admin bootstrap.

---

## 2. Use cases

### UC-1 — Invite a new admin
1. `super_admin` opens `/users`.
2. Clicks **Invite admin**, enters `kolya@gmail.com`, picks role `tech_admin`, submits.
3. `userInvitations/kolya@gmail.com` is written with `status: 'pending'`.
4. UI immediately shows the row under **Ожидающие приглашения** with "Pending invitation" badge.
5. `audit_logs/{auto}` gets `{ entity: 'invitation', action: 'create', ... }`.
6. Out of band, super_admin tells Kolya to log in.

### UC-2 — Invitee first sign-in (the magic moment)
1. Kolya opens AMS, picks the **«Через Google»** tab, signs in with `kolya@gmail.com`.
2. `onAuthStateChanged` fires in `AuthContext` → no `users/{uid}` doc exists.
3. Bootstrap flow runs: read `userInvitations/kolya@gmail.com`, see `status === 'pending'`.
4. Run a Firestore transaction:
   - `tx.set(users/{uid}, { ...invitedFields, isActive: true, createdAt, updatedAt })`
   - `tx.update(userInvitations/kolya@gmail.com, { status: 'accepted', acceptedAt, acceptedUid: uid })`
5. `users/{uid}` snapshot resolves with role; UI redirects to `/dashboard` with full admin access.
6. Audit log already exists from UC-1; we deliberately do **not** add a second `invitation.accepted` entry (rationale in §6 Q2).

### UC-3 — Change an existing admin's role
1. `super_admin` opens `/users`, finds Vasya in **Активные пользователи**.
2. Clicks the role cell → picks `asset_admin` instead of `tech_admin`.
3. UI confirms; transaction updates `users/{uid}.role` and writes `audit_logs/{auto}` with `{ entity: 'user', action: 'roleChanged', before: { role: 'tech_admin' }, after: { role: 'asset_admin' } }`.

### UC-4 — Deactivate an admin
1. Super_admin opens `/users`, finds the row, clicks **Деактивировать**.
2. Confirmation dialog. Confirm.
3. Transaction sets `users/{uid}.isActive = false` and writes `audit_logs/{auto}` `{ entity: 'user', action: 'deactivated' }`.
4. Next time Vasya tries to sign in, `RequireAuth` (or a deeper check in `AuthContext`) sees `isActive === false`, calls `signOut`, and redirects to `/403` with a "your account is disabled" message.
5. Reactivation is the symmetric flow → `audit_logs/{auto}` `{ action: 'reactivated' }`.

### UC-5 — Revoke a pending invitation
1. Super_admin opens `/users`, scrolls to **Ожидающие приглашения**, finds an invitation that should not have been sent.
2. Clicks **Отозвать**.
3. Transaction sets `userInvitations/{email}.status = 'revoked'`, `revokedAt = serverTimestamp()`, `revokedBy = uid`.
4. `audit_logs/{auto}` `{ entity: 'invitation', action: 'revoked' }`.
5. If that invitee later tries to sign in with Google, the bootstrap flow sees `status !== 'pending'` and refuses to create `users/{uid}`. They land on `/403` (no role) → AuthContext signs them out → "no invitation" message.

### UC-6 — Already-accepted email cannot be re-used
- If `userInvitations/{email}.status === 'accepted'` and the same person somehow signs in again with no `users/{uid}` (e.g. doc was manually deleted), the bootstrap refuses to re-issue a role. Manual recovery: delete the accepted invitation doc, create a new pending one. (We surface this only as an admin-side fact; UC-6 is documented for completeness, not a UI flow.)

---

## 3. Data model

### 3.1 `userInvitations/{emailLower}` — NEW collection

Doc id is the lowercased, trimmed email — gives us free uniqueness without a query. Rationale: the bootstrap flow needs to look up an invitation by email, not by random id.

```
userInvitations/{emailLower}
{
  email:          string,            // canonical lowercased email (mirrors doc id)
  role:           'super_admin' | 'asset_admin' | 'tech_admin',
  branchId:       string | null,     // optional pre-assignment, MVP keeps null
  departmentId:   string | null,     // same
  invitedBy:      string,            // uid of the inviting super_admin
  invitedAt:      Timestamp,         // serverTimestamp()
  status:         'pending' | 'accepted' | 'revoked',

  // populated only when status transitions
  acceptedAt:     Timestamp | null,
  acceptedUid:    string | null,
  revokedAt:      Timestamp | null,
  revokedBy:      string | null,     // uid of the super_admin who revoked
}
```

**Why not a sub-id under `users`?** Because at invite-time we don't know the uid. The whole point of an invitation is to bind email → role *before* Firebase Auth has minted a uid.

**Why not store the invitation under `users/{uid}`?** Same reason. The doc must be lookable from a session that has no uid context yet — the brand-new sign-in.

**Email normalization:** doc id and `email` field are both `email.trim().toLowerCase()`. The bootstrap flow normalizes `request.auth.token.email` the same way before lookup. Rules enforce match (see §4).

### 3.2 `users/{uid}` — extension

Two changes to the existing schema:

1. **NEW field** `isActive: boolean` (default `true`). Used by `RequireAuth` / `AuthContext` to deny access without deleting the doc.
2. **NEW** behavior: `users/{uid}` may be created by a non-super_admin user **iff** there is a matching pending invitation (the bootstrap path).

Final shape:
```
users/{uid}
{
  email:           string,
  displayName:     string | null,
  photoURL:        string | null,
  role:            'super_admin' | 'asset_admin' | 'tech_admin' | 'employee',
  branchId:        string | null,
  departmentId:    string | null,
  employeeId:      string | null,
  preferredLocale: 'ru' | 'en' | 'hy',
  isActive:        boolean,           // NEW
  createdAt:       Timestamp,
  updatedAt:       Timestamp,
}
```

### 3.3 Existing `audit_logs` — no schema change

We use the existing collection. Whitelisted entities already include `'user'` and `'auth'` in `auditHelper.js`. We need to **add `'invitation'`** to `ALLOWED_ENTITIES`.

Audit entries written by this feature:

| `entity`     | `action`      | `entityId`        | Triggered by             |
|--------------|---------------|-------------------|--------------------------|
| `invitation` | `create`      | `emailLower`      | UC-1                     |
| `invitation` | `revoke`      | `emailLower`      | UC-5                     |
| `user`       | `roleChanged` | `uid`             | UC-3                     |
| `user`       | `deactivated` | `uid`             | UC-4                     |
| `user`       | `reactivated` | `uid`             | UC-4 (symmetric)         |

Each entry uses the standard shape from `buildAuditLog()`: `before` / `after` plucked snapshots, `changedKeys` auto-derived, `actorUid = request.auth.uid`, `actorRole` = caller's role, `at = serverTimestamp()`.

**No audit entry on UC-2** (bootstrap acceptance). Rationale in §6 Q2.

### 3.4 Indexes

Likely needed for the `/users` page list views. Minimum two composite indexes (verify with the actual queries during implementation; `firestore.indexes.json` updates):

- `userInvitations`: `(status ASC, invitedAt DESC)` — drives the "pending invitations" list.
- `users`: `(isActive ASC, role ASC, email ASC)` — drives the active-users list with filters.

These get added to `firestore.indexes.json` and deployed alongside the rules.

---

## 4. Firestore rules diff

### 4.1 New helpers

```
function isValidInviteRole(role) {
  return role in ['super_admin', 'asset_admin', 'tech_admin'];
}

function emailFromAuth() {
  return request.auth.token.email != null
         ? request.auth.token.email.lower()
         : null;
}
```

(`.lower()` is available in security-rules; doublecheck during implementation. If not, store `email` already-lowercased in the auth token check and compare strictly.)

### 4.2 `/userInvitations/{email}` — new ruleset

```
match /userInvitations/{email} {

  // super_admin manages the queue.
  allow read: if isAdmin();   // any admin can see; only super_admin acts

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

  // Two legitimate update shapes:
  //   (a) super_admin revokes a still-pending invite
  //   (b) the invitee themselves accepts on first sign-in
  // Anything else: deny.
  allow update: if (
                    // (a) revoke
                    isSuperAdmin()
                    && resource.data.status == 'pending'
                    && request.resource.data.status == 'revoked'
                    && request.resource.data.revokedBy == request.auth.uid
                    && request.resource.data.revokedAt == request.time
                    && request.resource.data.diff(resource.data).affectedKeys()
                       .hasOnly(['status', 'revokedBy', 'revokedAt'])
                  ) || (
                    // (b) self-accept
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

  // No deletes. Revoked invitations stay as audit residue.
  allow delete: if false;
}
```

### 4.3 `/users/{uid}` — extended

```
match /users/{uid} {
  allow read: if (request.auth != null && request.auth.uid == uid) || isSuperAdmin();

  // Two create paths now:
  //   (1) seed super-admin self-bootstrap (existing — preserved verbatim).
  //   (2) invitation-accepted self-bootstrap (NEW).
  allow create: if request.auth != null
                && request.auth.uid == uid
                && (
                     // (1) seed super-admin
                     (
                       isSeedSuperAdminEmail()
                       && request.resource.data.role == 'super_admin'
                       && request.resource.data.email == request.auth.token.email
                       && request.resource.data.isActive == true
                     ) || (
                       // (2) invitation acceptance — role MUST match the pending invitation
                       request.auth.token.email_verified == true
                       && exists(/databases/$(database)/documents/userInvitations/$(request.auth.token.email.lower()))
                       && get(/databases/$(database)/documents/userInvitations/$(request.auth.token.email.lower())).data.status == 'pending'
                       && request.resource.data.role == get(/databases/$(database)/documents/userInvitations/$(request.auth.token.email.lower())).data.role
                       && request.resource.data.email == request.auth.token.email.lower()
                       && request.resource.data.isActive == true
                     )
                   );

  // affectedKeys widened to include isActive.
  allow update: if isSuperAdmin()
                && request.resource.data.diff(resource.data).affectedKeys()
                   .hasOnly(['role', 'branchId', 'departmentId', 'displayName',
                             'preferredLocale', 'employeeId', 'isActive', 'updatedAt']);

  allow delete: if false;
}
```

> Implementation note: the path `userInvitations/$(request.auth.token.email.lower())` is read **twice** in the create rule. In rules, every `get()` costs a read and there is no `let` in `allow ... if` predicates. We accept the 2x cost for the bootstrap moment (rare). If the rules engine rejects this for verbosity reasons during implementation, the firebase-engineer pulls the role check into a small helper function.

### 4.4 `audit_logs` — already exists

No structural change. Just relax the entity whitelist in `src/lib/audit/auditHelper.js` to include `'invitation'`. Rules don't validate `entity` field shape — they validate `actorUid == request.auth.uid` and `at == request.time`, both of which still hold.

---

## 5. AuthContext bootstrap flow

Current `AuthContext.jsx` already handles seed-super-admin self-bootstrap via `bootstrapSuperAdminIfEligible`. We extend it (or add a sibling) to handle the invitation case **after** the seed check.

### 5.1 Algorithm (runs inside `onAuthStateChanged` when `fbUser` is non-null)

```
async function bootstrapFromInvitationIfEligible(fbUser):
  if not fbUser.email:                       return
  if not fbUser.emailVerified:               return            # belt and braces; rules enforce too
  email = fbUser.email.toLowerCase().trim()

  userRef = doc(db, 'users', fbUser.uid)
  userSnap = await getDoc(userRef)
  if userSnap.exists():                      return            # already provisioned

  inviteRef = doc(db, 'userInvitations', email)

  await runTransaction(db, async tx -> {
    inviteSnap = await tx.get(inviteRef)
    if not inviteSnap.exists():                      return    # no invite — let RoleGate send to /403
    invite = inviteSnap.data()
    if invite.status != 'pending':                   return    # revoked or already accepted

    tx.set(userRef, {
      email:           email,
      displayName:     fbUser.displayName ?? null,
      photoURL:        fbUser.photoURL ?? null,
      role:            invite.role,
      branchId:        invite.branchId ?? null,
      departmentId:    invite.departmentId ?? null,
      employeeId:      null,
      preferredLocale: 'ru',
      isActive:        true,
      createdAt:       serverTimestamp(),
      updatedAt:       serverTimestamp(),
    })
    tx.update(inviteRef, {
      status:       'accepted',
      acceptedUid:  fbUser.uid,
      acceptedAt:   serverTimestamp(),
    })
  })
```

### 5.2 Order of operations in AuthContext

```
on auth state change with non-null fbUser:
  1. await bootstrapSuperAdminIfEligible(fbUser)   // existing, no-op for non-seeds
  2. await bootstrapFromInvitationIfEligible(fbUser)  // NEW
  3. setUser(fbUser)                                // triggers users/{uid} onSnapshot
```

Both bootstrap calls are best-effort: if rules reject (no invite, wrong email, etc.) we swallow the error, log it via `console.warn`, and let the downstream `users/{uid}` onSnapshot resolve with `role = null` — which `RequireAuth` / `RoleGate` already handles by redirecting to `/403`.

### 5.3 isActive enforcement (the new gate)

Two places must respect `isActive`:

1. **`AuthContext`**: when the `users/{uid}` snapshot says `isActive === false`, immediately call `signOut(auth)` and emit a one-time `disabledAccount` flag through context (e.g. `accountDisabled: true`).
2. **`/login`**: when `accountDisabled` is true, render an inline alert above the tabs: «Ваш аккаунт деактивирован администратором». i18n key `accountDisabled` in `auth.json`.

We do **not** rely on Firestore rules to block reads from a disabled user — they could still read their own `users/{uid}` doc. That's fine; the moment we see `isActive === false` we log them out client-side. A future Phase-2 hardening (Cloud Functions + custom claims with `disabled: true`) is the proper enforcement, tracked as future work.

### 5.4 Existing `users/{uid}` documents — backfill

Existing user docs (the seed super_admin and any branch-CRUD-era docs) lack `isActive`. Plain Firestore queries with `where('isActive', '==', true)` would silently miss these.

**Migration approach (simpler of the two options the user offered):** add a one-shot block to the existing `scripts/seed.js` — after the bootstrap loop, scan all `users/`, and for any doc missing `isActive`, set it to `true` via admin SDK (which bypasses rules). This keeps a single seed entry-point and doesn't add a second script. Idempotent: running it again finds zero docs to patch.

---

## 6. Decisions answered

This section locks down the questions raised before implementation.

### Q1 — Deactivation: hard or soft? **Soft (`isActive` flag).**

Add `isActive: boolean` to `users/{uid}`. Reasoning: keeps audit history queryable by uid, lets us reactivate without losing branch/department/employee links, matches the soft-delete pattern already used by `branches`. UI offers **Деактивировать** ↔ **Активировать**. Rules `affectedKeys` widened to include `isActive` (and `updatedAt`).

### Q2 — Audit-log entry on invitation acceptance? **No.**

The `userInvitations/{email}` doc itself, with its `acceptedAt` and `acceptedUid` fields after the bootstrap transaction, **is** the audit trail for acceptance. Writing a separate `audit_logs` entry at that moment is impossible without a race: the user has not yet been provisioned with a role at the moment of acceptance, so `audit_logs` rules (`isAdmin()`) reject the write. Adding a special-case `audit_logs` rule to allow self-bootstrap writes would broaden the audit-log attack surface for negligible benefit.

The future "История" page reads both collections and joins on email/uid, presenting the invitation row as the acceptance event.

### Q3 — UI-only safety guards? **Yes, all three.**

Implement client-side; do not enforce in rules (would require count-queries that need Cloud Functions):

| Guard                                                  | Implementation                                                                                                                  |
|--------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------|
| Cannot deactivate yourself                              | Disable **Деактивировать** when `targetUser.uid === currentUser.uid`. Tooltip explains.                                          |
| Cannot demote the last active super_admin               | Before role-change submit: count `users` where `role === 'super_admin' && isActive === true`. If `count === 1 && target is that user`, block, show toast. |
| Cannot revoke your own pending invitation               | n/a in practice (a super_admin can't have a pending invitation — they already have a `users/{uid}` doc). Defense-in-depth: hide the **Отозвать** button if `invitation.email === currentUser.email`. |

A Phase-2 hardening pass moves these to Cloud Functions where they can be enforced server-side with proper count-queries and transactions.

---

## 7. UI

### 7.1 New page: `/users`

Route: `/users`, gated by `RoleGate roles={[ROLES.SUPER_ADMIN]}`. Title: «Пользователи» (i18n key `usersTitle` in a new `users.json` namespace).

Layout (single page, two cards):

**Card 1 — Активные пользователи**
- Header: «Активные пользователи» + counter, button **Пригласить администратора** (top-right).
- Table columns: Email · Имя · Роль · Филиал · Статус (Active / Inactive badge) · Created · Actions.
- Row actions popover:
  - **Изменить роль** → opens role-picker dialog (radio list: super_admin / asset_admin / tech_admin / employee). Submitting writes through `usersRepo.updateRole(uid, newRole, before, actor)`.
  - **Деактивировать** / **Активировать** → confirmation dialog → `usersRepo.setActive(uid, isActive, before, actor)`.
  - Row actions disabled for the current user (per Q3).
- Filter: free-text email search (client-side; the `users` collection in Phase 1 will be tiny).

**Card 2 — Ожидающие приглашения**
- Header: «Ожидающие приглашения» + counter.
- Table columns: Email · Роль · Кто пригласил · Когда · Actions.
- Row actions:
  - **Отозвать** → confirmation dialog → `userInvitationsRepo.revoke(email, actor)`.
- Empty state: "Нет ожидающих приглашений. Нажмите «Пригласить администратора»."

**Invite dialog** (opened from Card 1's button):
- Field: email (required, valid-email format, lowercase-trimmed on submit).
- Field: role (radio: super_admin / asset_admin / tech_admin). Default tech_admin.
- Submit: `userInvitationsRepo.create({ email, role }, actor)`.
- On success: close dialog, toast "Приглашение отправлено для kolya@gmail.com".
- On already-exists: show inline error "Для этого email уже существует приглашение или активный пользователь."

Dialog client-side validates: email is well-formed; not already in `users`; not already `pending` in `userInvitations`. (Firestore rules also enforce uniqueness because the doc id is the email.)

### 7.2 LoginPage tab rename

Existing tabs: «Администратор» / «Сотрудник». New labels: «Через Google» / «По ссылке на email».

**Cleaner approach** (decided): keep i18n keys `tabAdmin` / `tabEmployee` for backwards compatibility but change their *values*. No code-side rename. This avoids touching `LoginPage.jsx` other than the JSX label sources, and avoids breaking any test that asserts on the keys.

New values across all three locales:

| Key          | ru                       | en                  | hy                              |
|--------------|--------------------------|---------------------|---------------------------------|
| `tabAdmin`   | «Через Google»           | «Sign in with Google» | «Google-ով»                    |
| `tabEmployee`| «По ссылке на email»     | «Email sign-in link» | «Հղումով նամակին»               |

The icons (`ShieldCheck` / `UserRound`) stay as-is — they still read as a coarse "admin path / employee path" cue.

### 7.3 Disabled-account message on /login

Added text rendered above tabs when `accountDisabled` flag is set. i18n key `accountDisabled` in `auth.json` (all three locales).

### 7.4 Nav

`/users` link added to `AppShell` sidebar, visible only when `role === 'super_admin'`. i18n key `nav.users` in `common.json`.

---

## 8. i18n keys

### 8.1 New namespace: `users`

`src/locales/{ru,en,hy}/users.json`. All keys:

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

### 8.2 Updates to `auth.json` (all three locales)

- `tabAdmin` value updated (see §7.2).
- `tabEmployee` value updated (see §7.2).
- New key: `accountDisabled` — "Ваш аккаунт деактивирован администратором. Обратитесь к супер-админу." / EN / HY.

### 8.3 Updates to `common.json`

- New: `nav.users` — «Пользователи» / "Users" / «Օգտատերեր».

### 8.4 i18n strategy compliance

Per the project's 4-tier i18n strategy:
- **Tier 1 (chrome — translated by devs):** every key listed above. ru/en/hy. Author writes ru, copy-pastes to en/hy with translation.
- **Tier 2 (system enums):** role names use `roleSuperAdmin` / `roleAssetAdmin` / `roleTechAdmin` / `roleEmployee` keys, not raw `super_admin` strings.
- **Tier 3 (free text):** N/A here (no user-typed long-form text).
- **Tier 4 (brands/models):** N/A.

---

## 9. File tree

### NEW (15 files)

```
docs/superpowers/specs/2026-05-05-admin-invitations-user-management-design.md   (this file)
docs/features/admin-invitations.md                                               (user-facing feature doc, optional v2 deliverable)

src/domain/userInvitations.js                          (typedef + invite-input validator + INVITE_ROLES)
src/domain/repositories/UserInvitationsRepository.js   (JSDoc port)
src/domain/repositories/UsersRepository.js             (JSDoc port — was missing; we add the port now)

src/infra/repositories/firestoreUserInvitationsRepository.js   (Firestore adapter, runTransaction-based)
src/infra/repositories/firestoreUsersRepository.js             (Firestore adapter for the users-management actions)

src/hooks/useUserInvitations.js                        ({ data, loading, error } over invitations.status=pending)
src/hooks/useUsers.js                                  ({ data, loading, error } over users)

src/pages/UsersPage.jsx                                (the /users page: two cards + dialogs)
src/components/features/users/InviteAdminDialog.jsx
src/components/features/users/RoleChangeDialog.jsx
src/components/features/users/ConfirmActionDialog.jsx (small reuse — could collapse into existing dialog primitive)

src/locales/ru/users.json
src/locales/en/users.json
src/locales/hy/users.json

src/test/userInvitations.test.js                       (domain validators)
src/test/firestoreUserInvitationsRepository.test.js
src/test/firestoreUsersRepository.test.js
src/test/AuthContext.bootstrap.test.jsx                (matrix from §11)
src/test/UsersPage.test.jsx                            (RTL smoke + UI guards)
```

### MODIFIED (8 files)

```
firestore.rules                                  (NEW userInvitations rules; users.create extended; users.update affectedKeys widened)
firestore.indexes.json                           (add 2 composite indexes per §3.4)
scripts/seed.js                                  (add isActive backfill loop)

src/lib/audit/auditHelper.js                     (add 'invitation' to ALLOWED_ENTITIES)

src/contexts/AuthContext.jsx                     (call bootstrapFromInvitationIfEligible; expose accountDisabled flag; signOut on isActive=false)

src/App.jsx                                      (add /users route, super_admin only)
src/config/routes.js                             (add USERS = '/users')

src/components/layout/AppShell.jsx               (add nav link, super_admin only)

src/pages/LoginPage.jsx                          (render accountDisabled alert above tabs)

src/locales/{ru,en,hy}/auth.json                 (tabAdmin/tabEmployee value updates; new accountDisabled key)
src/locales/{ru,en,hy}/common.json               (nav.users key)
```

All paths absolute when dispatched to subagents (prefix `C:/Users/DELL/Desktop/assets-crm/`).

---

## 10. Audit log entries (full list)

Every entry uses `buildAuditLog()` from `src/lib/audit/auditHelper.js`. Atomic with the corresponding write via `runTransaction`.

| Trigger                | entity       | entityId        | action          | before                                | after                                    |
|------------------------|--------------|-----------------|-----------------|---------------------------------------|------------------------------------------|
| Invite created (UC-1)   | `invitation` | `emailLower`    | `create`        | `null`                                | `{ email, role, branchId, departmentId, status: 'pending' }` |
| Invite revoked (UC-5)   | `invitation` | `emailLower`    | `revoke`        | `{ status: 'pending' }`               | `{ status: 'revoked' }`                 |
| User role changed (UC-3)| `user`       | `uid`           | `roleChanged`   | `{ role: 'tech_admin', branchId, … }` | `{ role: 'asset_admin', branchId, … }`  |
| User deactivated (UC-4) | `user`       | `uid`           | `deactivated`   | `{ isActive: true }`                  | `{ isActive: false }`                   |
| User reactivated (UC-4) | `user`       | `uid`           | `reactivated`   | `{ isActive: false }`                 | `{ isActive: true }`                    |

**No entry** on UC-2 (invitation acceptance). The invitation doc's transition is the trail.

---

## 11. Tests

### 11.1 Domain (`src/test/userInvitations.test.js`)
- `validateInviteInput` — required email, valid format, role in whitelist, normalization (trim, lowercase).
- `INVITE_ROLES` shape.

### 11.2 Repositories
- `firestoreUserInvitationsRepository.test.js` — mock `firebase/firestore`, verify `runTransaction` calls, verify audit-log payload built from invite doc.
- `firestoreUsersRepository.test.js` — `setActive` and `updateRole` paths, audit-log payload, `before`/`after` shape.

### 11.3 AuthContext bootstrap matrix (`src/test/AuthContext.bootstrap.test.jsx`)
| Case                          | users/{uid} | userInvitations/{email}              | Expected outcome                                  |
|-------------------------------|-------------|--------------------------------------|---------------------------------------------------|
| Seed super_admin first sign-in | absent      | n/a (whitelisted email)              | seed bootstrap creates users/{uid}; role resolves |
| Invitee, pending invite        | absent      | exists, status=pending               | tx: users/{uid} created with invited role; invite → accepted |
| Invitee, revoked invite        | absent      | exists, status=revoked               | no users/{uid} created; role=null; redirected /403 |
| Invitee, accepted invite       | absent      | exists, status=accepted              | no users/{uid} created; role=null; redirected /403 |
| Invitee, no invite             | absent      | none                                 | no users/{uid} created; role=null; redirected /403 |
| Existing user, isActive=true   | exists, active | n/a                                | normal sign-in; role from doc                     |
| Existing user, isActive=false  | exists, inactive | n/a                              | AuthContext signOuts; accountDisabled=true; LoginPage shows banner |

### 11.4 UsersPage UI (`src/test/UsersPage.test.jsx`) — Testing Library + user-event
- Renders two sections; empty states.
- Invite flow: form validation, submit calls `userInvitationsRepo.create`.
- Cannot deactivate self: button disabled, tooltip present.
- Cannot demote last active super_admin: when fixture has only 1 active super_admin and target is that uid, role-change dialog blocks submit with toast.
- Revoke pending invitation: confirmation → calls repo.revoke.

### 11.5 Rules emulator (only if firebase-tools is set up; else best-effort defer)
- `userInvitations.create` allowed only for super_admin with valid shape.
- `userInvitations.update` two legitimate shapes; everything else denied.
- `users.create` via invitation acceptance: role MUST match invite; mismatched role denied.
- `users.update` with `affectedKeys` outside the whitelist denied.

If rules-emulator scaffolding doesn't exist yet, the security-reviewer flags this and adds a TODO without blocking merge — but the rules diff is reviewed line-by-line during phase 5c.

---

## 12. Migration plan

### 12.1 Existing `users/{uid}` documents

Run-once backfill embedded in `scripts/seed.js` (see §5.4). Order:
1. Deploy new rules (`isActive` allowed in `affectedKeys`) **first**.
2. Then `npm run seed` — patches existing user docs with `isActive: true`.
3. Then ship the UI.

If we ship UI before patching, listing queries that filter by `where('isActive', '==', true)` would miss the seed super_admin and lock him out. The seed script run is mandatory before the UI is exercised in production.

### 12.2 No data migration for invitations

Brand-new collection. Nothing to backfill.

### 12.3 Deploy command

```
firebase deploy --only firestore:rules,firestore:indexes
```

(Storage rules untouched — Storage is not yet activated in this project.)

---

## 13. Out of scope (Phase 2)

- Cloud Functions for server-side enforcement of: last-super-admin check, count-queries, custom claims for `disabled` flag.
- Email delivery: AMS does not auto-email the invitee. The super_admin tells them out-of-band ("заходи через Google по своему gmail"). Sending an actual email is a Phase-2 hosted-function job.
- Invitation expiry. MVP invitations are forever-pending until accepted or revoked.
- Bulk invite (CSV / pasted list).
- Self-invite for `employee` role — employees flow through the existing email-link path, not invitations.
- Audit-log UI (the "История" page itself).
- `users` listing pagination — Phase 1 user count is small enough that client-side filter is fine.

---

## 14. Open questions

None blocking. Two items the reviewers should confirm during their passes:

1. **Rules `lower()` availability.** If the security-rules engine version doesn't support `.lower()` (older deployments do), firebase-engineer normalizes via direct comparison: `request.resource.data.email == request.auth.token.email` (with the dialog forcing lowercased input client-side and enforcing `email == documentId`). This is a small adapter-level change, not a design change.
2. **Whether to store `displayName` snapshot at invite time.** Currently the invitation only carries `email + role`. We pull the displayName from `fbUser.displayName` at acceptance time. If a super_admin wants to seed a "preferred display name" on the invitation, that's a Phase-1.1 follow-up — easy add to the invite dialog.

Neither blocks implementation. If a reviewer surfaces a third issue in their pass, it joins this list and the writing-plans phase decides whether to schedule it now or defer.

---

## 15. Acceptance criteria

A reviewer can stamp this feature done when, on a clean test environment:

1. Sign in as `zahalyanxcho@gmail.com` (seed super_admin) → `/users` page accessible.
2. Invite `kolya@gmail.com` as `tech_admin` → row appears under "Ожидающие приглашения".
3. Sign out, sign in as `kolya@gmail.com` via Google → user is provisioned with `tech_admin`, lands on `/dashboard`.
4. The invitation row in the seed admin's view moves from "Ожидающие" to "Активные пользователи" with status `accepted`.
5. As seed admin, change Kolya's role to `asset_admin` → `audit_logs` collection has a `user/roleChanged` entry, Kolya's session reflects new role on next render.
6. As seed admin, deactivate Kolya → next time Kolya tries to sign in, he's redirected to `/login` with the "account disabled" banner.
7. Invite `vasya@gmail.com` as `asset_admin`, then revoke before he signs in → if Vasya later signs in, he is redirected to `/403` with no `users/{uid}` doc created.
8. UI guards: try to deactivate yourself → blocked. Try to demote last active super_admin → blocked.
9. `npm run lint`, `npm run test:run`, `npm run build` all pass.
10. `firebase deploy --only firestore:rules,firestore:indexes` succeeds.

When all 10 hold, the user's exit condition — *clean working feature with code with written best patterns* — is met.
