# Roles & Permissions

**Phase:** 1 (MVP)
**Status:** spec
**Owner agents:** firebase-engineer, security-reviewer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §3, §16

## Purpose & user value

AMS has four roles with sharply different scopes. The role determines (a) which routes the user can reach, (b) which Firestore collections and Storage paths the user can read/write, and (c) what UI surfaces are visible. Both the UI and Firestore rules enforce the same matrix; **UI gates are convenience, Firestore rules are the real gate.**

## In scope

- The four-role enum: `super_admin`, `asset_admin`, `tech_admin`, `employee`.
- A central permission matrix defining what each role can do for every entity in MVP.
- Firestore rule helper functions: `isSignedIn()`, `getRole()`, `isSuperAdmin()`, `isAssetAdmin()`, `isTechAdmin()`, `isEmployee()`, `isAdmin()` (any of the three admin roles).
- Storage rule helpers using the same role check.
- React components: `<RequireAuth>` (auth gate), `<RoleGate roles={[...]}>` (role gate).
- A `useAuth()` hook exposing `{ user, role, loading, signIn, signOut }`.
- Single source of truth: a `roles.js` constants module shared between rules helpers, UI gates, and seed scripts.

## Out of scope

- Field-level permissions (e.g. "Tech Admin can edit only the technical-attributes section of an asset") beyond what's expressed as a doc-level rule. If field-level enforcement is needed, reach for Cloud Functions in Phase 2+.
- Custom claims via Firebase Auth (Phase 2 optimization for rule-eval performance).
- Per-branch scoping for asset_admin (the spec implies asset_admin sees all branches; revisit if customer asks otherwise).
- Per-role notification settings (covered by `notifications-system` Phase 2).

## Domain entities involved

- **Role** — enum with 4 values. Code identifier matches Firestore-rule literal.
- **User** — `users/{uid}.role` is the source of truth for a user's role.

## Key user flows

### Role check on a protected page

1. Component imports `useAuth()`.
2. `<RequireAuth>` blocks render until `loading: false`.
3. `<RoleGate roles={['super_admin', 'asset_admin']}>` checks `user.role` against the list. If included → render children. Otherwise → redirect to `/403`.

### Role check inside a write

1. UI button only renders when `<RoleGate>` permits.
2. User clicks → repository call.
3. Repository writes to Firestore.
4. Firestore rule re-evaluates the user's role via `get(/databases/.../users/$(request.auth.uid)).data.role`.
5. Rule allows or denies. If allowed, audit-helper writes the audit row in the same transaction.

## UI surfaces

- `<RequireAuth>` wrapper (in `src/components/auth/`).
- `<RoleGate roles={[...]} fallback={null}>` wrapper.
- `/403` — `ForbiddenPage`.
- `useAuth()` hook (in `src/hooks/`).
- Role-conditional rendering in headers / nav menus (e.g. "Settings" link only for super_admin).

## Firestore collections & shape

No new collections — the role lives on `users/{uid}.role`. See `authentication.md` for the User typedef.

### Rule helpers (`firestore.rules` top section)

```
function isSignedIn() { return request.auth != null; }
function getRole() {
  return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role;
}
function isSuperAdmin() { return isSignedIn() && getRole() == 'super_admin'; }
function isAssetAdmin() { return isSignedIn() && getRole() == 'asset_admin'; }
function isTechAdmin()  { return isSignedIn() && getRole() == 'tech_admin'; }
function isEmployee()   { return isSignedIn() && getRole() == 'employee'; }
function isAdmin()      { return isSuperAdmin() || isAssetAdmin() || isTechAdmin(); }
```

Cache the role in a `let` if used multiple times in one rule to avoid double-`get` quota issues.

## Permission matrix (MVP)

Read access (R), write access (W), conditional (✱). Detailed conditions in each feature spec.

| Entity | super_admin | asset_admin | tech_admin | employee |
|---|---|---|---|---|
| `users/{self}` | R | R | R | R |
| `users/{other}` | RW | — | — | — |
| `settings/auth` | RW | R | R | — |
| `branches` | RW | R | R | — |
| `departments` | RW | R | R | — |
| `employees` | RW | RW | R | R (self only) |
| `asset_statuses` | RW | R | R | — |
| `categories` | RW | R | R | — |
| `assets` | RW | RW | RW (technical fields only via Phase 2) | R (own assignments only) |
| `assignments` | RW | RW | R | R (own only) |
| `audit_logs` | R | R | R | — |
| `audit_logs` write/update/delete | ❌ helper-only | ❌ helper-only | ❌ helper-only | ❌ |

Phase-2 entities (out of MVP scope but reserved):

| Entity | super_admin | asset_admin | tech_admin | employee |
|---|---|---|---|---|
| `category_attributes` | RW | R | RW | — |
| `asset_attribute_values` | RW | RW | RW | — |
| `batches` | RW | RW | R | — |
| `repairs` | RW | R | RW | R (own only) |
| `licenses` | RW | RW | RW | R (own only) |
| `notification_settings` | RW | R | R | — |
| `approval_requests` | RW | RW (create) | — | — |

## Permissions / role gates (route table)

| Route | Roles allowed |
|---|---|
| `/login`, `/login/employee`, `/auth/email-link` | unauthenticated |
| `/me` | employee |
| `/dashboard` | super_admin, asset_admin, tech_admin |
| `/branches`, `/branches/:id` | super_admin (W), asset_admin (R), tech_admin (R) |
| `/departments` | super_admin (W), asset_admin (R), tech_admin (R) |
| `/employees`, `/employees/:id` | super_admin (W), asset_admin (W), tech_admin (R) |
| `/assets`, `/assets/:id` | super_admin (W), asset_admin (W), tech_admin (R, W on technical fields Phase 2) |
| `/settings/statuses` | super_admin |
| `/settings/categories` | super_admin |
| `/settings/auth` | super_admin |

## Open questions

- **Tech Admin write scope on assets.** Spec implies Tech Admin can edit technical attributes (RAM, SSD, etc.) but not assignment / status / location. In MVP, technical attributes don't exist yet (Phase 2 feature) — so for MVP, Tech Admin is effectively read-only on assets. Confirm this is acceptable for MVP.
- **Asset Admin per-branch scoping.** Should Asset Admin see only their own branch, or all branches? Spec implies all-branches (single Asset Admin role, not per-branch). Default: all-branches; revisit if customer asks for per-branch scoping.
- **Custom claims promotion.** Reading the role from Firestore on every rule eval costs 1 read per write. For high-volume writes, promote role to a Firebase Auth custom claim. Defer to Phase 2 unless quota becomes a problem in MVP.

## Acceptance criteria

- [ ] `roles.js` constants module exports `ROLES = { SUPER_ADMIN, ASSET_ADMIN, TECH_ADMIN, EMPLOYEE }` (UPPER_SNAKE keys, lower-snake values matching the Firestore literal).
- [ ] `useAuth()` returns `{ user, role, loading, signIn, signOut }`.
- [ ] `<RequireAuth>` redirects to `/login` if `user === null`, blocks render while `loading: true`.
- [ ] `<RoleGate roles={[...]}>` redirects to `/403` if `role` not in list.
- [ ] `firestore.rules` defines and uses `isSignedIn()`, `getRole()`, `isSuperAdmin()`, `isAssetAdmin()`, `isTechAdmin()`, `isEmployee()`, `isAdmin()`.
- [ ] Rules tests cover the matrix above for `users`, `branches`, `assets`, `audit_logs`, `settings/auth` for each role × action combination (deny-by-default verified).
- [ ] No client write path can elevate a user's role: `users` rule blocks `role` field updates except by super_admin.
- [ ] No `audit_logs` update or delete can succeed under any role (including super_admin).

## Dependencies

- **Depends on:** authentication.
- **Depended on by:** every feature that has a write path (i.e., all of them).
