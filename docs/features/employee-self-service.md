# Employee Self-Service

**Phase:** 1 (MVP)
**Status:** spec
**Owner agents:** firebase-engineer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §3, §6, §9

## Purpose & user value

Employees should never have to call IT to ask "what's currently assigned to me?". The self-service page `/me` is their read-only window into AMS:

- List of currently-assigned assets (inventory code, name, status, act-of-acceptance scan link).
- Their own profile data (name, branch, department).
- A localized greeting and language switcher.

Sign-in is the passwordless email-link flow (covered by `authentication.md`). Once signed in, the only route an employee can reach is `/me`. Any attempt to navigate elsewhere lands on `/403`.

## In scope

- A `/me` route, gated to `role === 'employee'`.
- Display of `users/{uid}.employeeId` → `employees/{employeeId}` profile card.
- Display of currently-active assignments (`assignments` where `assigneeType == 'employee' && assigneeId == myEmployeeId && endedAt == null`).
- Read-only links to act-of-acceptance scans (Storage URLs).
- Language switcher (changes `users/{uid}.preferredLocale`).
- Sign-out button.
- Empty-state when no assets are assigned ("You currently hold no assets").

## Out of scope

- Editing own profile fields (employees cannot self-edit name/email — admin-only).
- Submitting a "report damage" or "request repair" ticket. Phase 2 (`notifications-system.md` + a small ticket flow).
- Viewing past assignments (history). Phase 2 — keeps the screen simple.
- Avatar upload. Phase 2.
- Push notifications / email on new assignment. Phase 2.

## Domain entities involved

- **User** — `users/{uid}`.
- **Employee** — `employees/{employeeId}` referenced by `User.employeeId`.
- **Assignment** — read-only filter on assigneeType/assigneeId.
- **Asset** — read-only via the assignment.
- **Branch / Department / Status / Category** — for label resolution.

## Key user flows

### First sign-in

1. Employee receives an email with the magic link.
2. Clicks link → `/auth/email-link` → handles sign-in (see `authentication.md`).
3. After successful sign-in:
   - If `users/{uid}` exists with `role: 'employee'` → redirect to `/me`.
   - If no `users/{uid}` doc and email matches an `employees` row → `beforeCreate`/server creates `users/{uid}` with `role: 'employee'` and `employeeId`. Redirect to `/me`.
   - Else: sign out, show "Your email is not registered."

### Viewing /me

1. `<RequireAuth>` and `<RoleGate roles={['employee']}>` resolve.
2. Page reads `users/{uid}` → gets `employeeId`.
3. Two parallel reads:
   - `employees/{employeeId}` for profile card.
   - Live subscription on `assignments` filtered by `assigneeType == 'employee' && assigneeId == employeeId && endedAt == null`.
4. For each active assignment, fetch the linked asset (cached) for inventory code + name + status badge.
5. Render:
   - Header: "Hello, {firstName}" + branch (localized) + department (localized) + language switcher + sign-out.
   - List: each assignment → asset card with inventory code, name, category badge, status badge, "Issued on {date}", "View act" link.
   - Empty state if list is empty.

### Switching language

1. Employee clicks language switcher.
2. `i18n.changeLanguage(lang)` + write `users/{uid}.preferredLocale = lang`.
3. Page re-renders with new locale (Tier-1 strings via `t()`, Tier-2 names via `localize()`).

### Signing out

1. Click "Sign out" → `firebase.auth.signOut()`.
2. Redirect to `/login`.
3. Audit row written for `auth.sign_out`.

## UI surfaces

- `/me` — `EmployeeSelfServicePage`.
  - `<EmployeeProfileCard />`
  - `<MyAssignmentsList />`
    - `<AssignmentCard assignment={...} asset={...} />`
  - `<LanguageSwitcher />`
  - `<SignOutButton />`
- Mobile-responsive layout: profile card collapses into a header strip on small screens; assignment list stacks vertically.

shadcn/ui primitives: `Card`, `Badge`, `Button`, `Avatar`, `DropdownMenu` (language switcher), `Skeleton`.

## Firestore queries

Read-only:
- `users/{uid}` — single doc.
- `employees/{employeeId}` — single doc.
- `assignments` `where('assigneeType','==','employee').where('assigneeId','==',employeeId).where('endedAt','==',null)` — onSnapshot for live updates.
- `assets/{assetId}` — fetched per-assignment; small N so individual gets are fine.

Indexes: composite `(assigneeType ASC, assigneeId ASC, endedAt ASC, startedAt DESC)` already declared in `asset-assignment-and-acts.md`.

## Storage paths

Read-only access to `acts/{assetId}/{assignmentId}-issue.{ext}` for the employee's own assignments. Storage rule already defined in `asset-assignment-and-acts.md` (employee can read if they're the current assignee).

## Permissions / role gates

| Action | super_admin | asset_admin | tech_admin | employee |
|---|---|---|---|---|
| Visit `/me` | ❌ (admins go to `/dashboard`) | ❌ | ❌ | ✅ |
| Read own employee row | ✅ | ✅ | ✅ | ✅ |
| Read own active assignments | ✅ | ✅ | ✅ | ✅ |
| Read own act scan | ✅ | ✅ | ✅ | ✅ |

The route is exclusively employee-only. Admins visiting `/me` redirect to `/dashboard`.

## Open questions

- **Show department's shared assets too?** If the employee belongs to a department, do they see assets assigned to that department on `/me`? Default: no in MVP (only personal assignments). Phase 2 may add a "Shared with my department" section.
- **Branch contact info on /me.** Useful for employees needing to find their branch manager; trivially shown if `Branch.responsibleEmployeeId` is set. Default proposal: show branch + manager contact line if available.
- **Requesting a repair / reporting damage.** Useful but not MVP. Phase 2 builds it as a `repairs` write path callable by employees with appropriate audit-and-notify wiring.
- **Mobile-first?** Spec says "responsive Mobile". `/me` is the mobile-most-likely page. Should we treat it as mobile-primary? Default: design at 360px first, scale up.

## Acceptance criteria

- [ ] `/me` is reachable only by users with `role === 'employee'`.
- [ ] Page shows employee profile card (first/last name, email, branch, department).
- [ ] Page shows live list of currently-assigned assets with localized status badges.
- [ ] Each assignment card has a "View act" link to the act-of-acceptance scan.
- [ ] Empty state renders when no active assignments.
- [ ] Language switcher updates `users/{uid}.preferredLocale` and re-renders the UI.
- [ ] Sign-out clears Firebase auth state and redirects to `/login`.
- [ ] Mobile layout works at 360px width.
- [ ] Storage rules verified: employee can fetch their own act scans, not others'.

## Dependencies

- **Depends on:** authentication, employees, asset-registry, asset-assignment-and-acts, internationalization, roles-and-permissions.
- **Depended on by:** none directly (terminal feature for employee role).
