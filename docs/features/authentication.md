# Authentication & Sessions

**Phase:** 1 (MVP)
**Status:** spec
**Owner agents:** firebase-engineer, react-ui-engineer, security-reviewer
**Spec reference:** `docs/AMS_Plan_v3.md` §3, §16

## Purpose & user value

AMS has two distinct user populations with different security postures:

- **Admins** (Super Admin, Asset Admin, Tech Admin) need a real signed-in session with full SPA access. They sign in via **Google OAuth** with a server-enforced check that their email's domain is on a runtime-configurable allow-list.
- **Employees** rarely need to interact with AMS — typically only to view what's been issued to them. They sign in via a **passwordless email link** (Firebase `signInWithEmailLink`). Clicking the link in their inbox creates a short-lived session scoped to read-only self-service.

This split keeps onboarding friction near zero for employees (no password to manage) while giving admins a proper auditable session.

## In scope

- Google OAuth sign-in for admin roles, with `beforeCreate` Cloud Function checking the email domain against `/settings/auth.allowedDomains`.
- Passwordless email-link sign-in for employees via Firebase `signInWithEmailLink`.
- Sign-out flow for both populations.
- Session persistence (Firebase default — local storage on browser).
- Protected-route redirection: unauthenticated → `/login`; mismatched role → `/dashboard` (or 403 page).
- The settings doc `/settings/auth` (with Super Admin–only write access) holding the allowed-domain list.

## Out of scope

- Email + password sign-in (deliberately not offered in MVP).
- Multi-factor authentication (Phase 2+ if required by customer).
- Custom JWT, SAML, OIDC, or any non-Firebase auth path.
- Account creation UI for admins — admins are added by Super Admin via the `users` collection (manual or seed-script).
- Self-service password reset.

## Domain entities involved

- **User** — represented as a Firestore doc at `users/{uid}` with `{ uid, email, displayName, role, branchId?, departmentId?, createdAt }`. Created server-side in the `beforeCreate` flow for admins; created on first email-link sign-in for employees (with default `role: 'employee'` if matched against the `employees` collection by email, otherwise the sign-up is denied).
- **AuthSettings** — singleton at `/settings/auth` with `{ allowedDomains: string[], updatedAt, updatedBy }`.

## Key user flows

### Admin sign-in (Google OAuth)

1. [unauthenticated] visits any protected route → redirected to `/login`.
2. [unauthenticated] clicks "Sign in with Google" on `/login`.
3. Firebase Auth opens Google OAuth popup → user authenticates with Google.
4. Cloud Function `beforeCreate` (only on first sign-in) reads `/settings/auth.allowedDomains`. If email domain not in list → throw `https-callable` error → Firebase rejects sign-up → UI shows "Your email domain is not authorized."
5. On success, Firestore `users/{uid}` is created with `role: 'super_admin'` ONLY if the user is in the seed admins list; otherwise the function rejects and the sign-up fails. (See "Open questions" — first-admin bootstrap.)
6. Subsequent sign-ins skip `beforeCreate` and just authenticate.
7. App reads `users/{uid}.role` and routes to `/dashboard`.

### Employee sign-in (email link)

1. Employee receives a notification email containing a "View my assets" link → clicks it.
2. Link opens `/auth/email-link` with the action code in the URL.
3. App calls `isSignInWithEmailLink(auth, window.location.href)` → `true`.
4. App needs the email to complete sign-in. If stored in `localStorage` (set when the link was originally requested), use it; otherwise show a form: "Enter your corporate email to confirm."
5. App calls `signInWithEmailLink(auth, email, window.location.href)` → Firebase Auth signs the employee in.
6. On the first such sign-in, a `users/{uid}` doc is created with `role: 'employee'` IF the email matches a row in `employees` collection (employees must be pre-registered by an admin). If no match → sign-out + show "Your email is not registered."
7. App routes to `/me` (employee self-service page).

### Employee requesting a fresh link

1. Employee navigates to `/login/employee` directly (e.g., they lost the original email).
2. Form: "Enter your corporate email" → on submit, `sendSignInLinkToEmail(auth, email, actionCodeSettings)`.
3. App stores the email in `localStorage` for the upcoming completion step.
4. UI confirms "Check your email."
5. The Trigger Email extension delivers the link via SMTP — the link is the standard Firebase magic link.

## UI surfaces

- `/login` — `LoginPage` (admin Google-OAuth button, also a "I'm an employee" link to `/login/employee`)
- `/login/employee` — `EmployeeLinkRequestPage` (email input + send link button)
- `/auth/email-link` — `EmailLinkLandingPage` (handles the magic link)
- `/logout` — `LogoutPage` (or just a header dropdown action)
- 403 page — `ForbiddenPage` (when role doesn't match the route)

shadcn/ui primitives: `Button`, `Input`, `Form`, `Card`, `Alert`.

## Firestore collections & shape

### `users/{uid}`

```jsdoc
/**
 * @typedef {Object} User
 * @property {string} uid
 * @property {string} email
 * @property {string} displayName
 * @property {'super_admin'|'asset_admin'|'tech_admin'|'employee'} role
 * @property {string|null} employeeId  // links to employees doc if role==='employee'
 * @property {string|null} branchId    // for admins scoped to a branch (super_admin sees all)
 * @property {string|null} departmentId
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {import('firebase/firestore').Timestamp} lastSignInAt
 */
```

### `settings/auth` (singleton doc)

```jsdoc
/**
 * @typedef {Object} AuthSettings
 * @property {string[]} allowedDomains  // e.g. ['example.com', 'subsidiary.example.com']
 * @property {string[]} seedSuperAdmins // emails of users who become super_admin on first sign-in
 * @property {import('firebase/firestore').Timestamp} updatedAt
 * @property {string} updatedBy        // uid
 */
```

### Indexes
- None required for auth itself; `users` indexed by `email` (auto) for the employee-sign-up email lookup.

### Write triggers
- `beforeCreate` Cloud Function (Firebase Auth blocking trigger): rejects sign-up if email domain not in `/settings/auth.allowedDomains`, OR (for non-Google providers) if email not in `employees` collection.
- `users/{uid}` doc creation: written from the `beforeCreate` function (or its `beforeSignIn` companion) using admin SDK; client never writes a `users` doc directly.
- Audit-helper write: every successful sign-in writes an `audit_logs` row `{ entity: 'auth', action: 'sign_in', actorUid, ... }`.

## Storage paths
- None for auth itself. Employee profile photos (Phase 2+) would live at `employees/{employeeId}/avatar.{ext}`.

## Permissions / role gates

| Action | super_admin | asset_admin | tech_admin | employee |
|---|---|---|---|---|
| Read `users/{self}` | ✅ | ✅ | ✅ | ✅ |
| Read `users/{other}` | ✅ | ❌ | ❌ | ❌ |
| Update `users/{self}.role` | ❌ (via `beforeCreate` only) | ❌ | ❌ | ❌ |
| Update `users/{any}.role` | ✅ | ❌ | ❌ | ❌ |
| Read `settings/auth` | ✅ | ✅ | ✅ | ❌ |
| Write `settings/auth` | ✅ | ❌ | ❌ | ❌ |

Firestore rule sketch:

```
match /users/{uid} {
  allow read: if request.auth.uid == uid || isSuperAdmin();
  allow update: if isSuperAdmin()
                && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['role','branchId','departmentId','displayName']);
  allow create, delete: if false;  // only via beforeCreate / admin SDK
}
match /settings/auth {
  allow read: if isAdmin();
  allow write: if isSuperAdmin();
}
```

## Open questions

- **First-admin bootstrap.** If the system has zero `users` docs, the `beforeCreate` function rejects everyone (deny by default). Resolution proposal: the seed script (run once during deploy) writes the initial `/settings/auth` doc with the bootstrap operator's email in `seedSuperAdmins`, and grants them `super_admin` on first sign-in. Confirm the seed-script approach in the Stage-C plan.
- **Domain check vs. specific email check.** The spec says "Google OAuth restricted to corporate domain." Should we ALSO allow specific allow-listed external emails (e.g., a contractor admin)? Current model: domain list only. If individual external admins are needed, add a `seedAdditionalAdmins` array in `settings/auth`.
- **Employee email domain.** Employees may have non-corporate emails (e.g., personal Gmail) for some companies. The current model: employees must have an email that matches a row in the `employees` collection — domain doesn't matter for employees. Confirm.
- **Email-link expiration.** Firebase's default is 1 hour. Confirm or override via `actionCodeSettings`.

## Acceptance criteria

- [ ] Admin with allowed-domain email signs in via Google OAuth → routes to `/dashboard` with their role applied.
- [ ] Admin with non-allowed-domain email is blocked at `beforeCreate` → UI shows "Your email domain is not authorized."
- [ ] Admin with `seedSuperAdmins` email becomes `super_admin` on first sign-in.
- [ ] Employee with email registered in `employees` collection completes email-link sign-in → routes to `/me`.
- [ ] Employee with email NOT in `employees` collection is rejected → UI shows "Your email is not registered."
- [ ] Sign-out clears Firebase auth state and redirects to `/login`.
- [ ] Visiting any protected route while unauthenticated redirects to `/login`.
- [ ] Audit log row written for every successful sign-in (`audit_logs` has `{ entity: 'auth', action: 'sign_in', actorUid, ... }`).
- [ ] Test: `beforeCreate` rejects when `/settings/auth.allowedDomains` is empty/missing (deny by default).
- [ ] Test: rules-tests assert `users/{uid}` cannot self-promote `role` field.

## Dependencies

- **Depends on:** internationalization (login page UI strings), Firebase project + Trigger Email extension installed (devops-engineer task).
- **Depended on by:** roles-and-permissions, employee-self-service, every protected feature.
