# Internationalization (i18n)

**Phase:** 1 (MVP)
**Status:** spec
**Owner agents:** i18n-engineer, react-ui-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` (Russian-language spec — implicit i18n requirement)

## Purpose & user value

AMS supports three locales at launch: **Russian (ru)**, **English (en)**, **Armenian (hy)**. The user explicitly raised the practical concern that requiring all data to be entered in three languages would be unworkable. AMS resolves this with a **4-tier strategy** that translates UI chrome by developers, requires multi-language input only for system enumerations, stores user free-text as typed, and keeps technical fields English-only.

## In scope

- i18next + react-i18next + i18next-browser-languagedetector setup.
- Language switcher in the app header (persisted to user preference doc + browser localStorage).
- Three locale resource directories: `src/locales/ru/`, `src/locales/en/`, `src/locales/hy/`.
- Namespace structure: `auth`, `assets`, `branches`, `employees`, `departments`, `categories`, `statuses`, `dashboard`, `common`, `errors`, `validation`, `me` (employee self-service), `settings`.
- A reusable `<MultiLangInput name="..." />` component for Tier-2 fields.
- A `localize(value, locale)` helper for resolving Tier-2 stored objects.
- Locale-aware date/number/currency formatting via `Intl.DateTimeFormat` and `Intl.NumberFormat`.
- A user-preference field on `users/{uid}.preferredLocale` for persistence across devices.

## Out of scope

- RTL (right-to-left) language support — none of the 3 locales need it.
- Live translation API integration — admins type Tier-2 values manually (AI auto-fill suggestion is a nice-to-have for Phase 2, not a blocker).
- Translation memory / glossary tools.
- In-app translation editor (admins typing translations live).
- Per-tenant translation overrides.

## Domain entities involved

- **User.preferredLocale** — `'ru'|'en'|'hy'` field on the User entity.
- All Tier-2 entities (statuses, categories, departments, notification templates) store their display fields as `{ ru: string, en: string, hy: string }`.

## The 4-tier strategy

| Tier | Content | Translation rule | Implementation |
|---|---|---|---|
| **1. UI chrome** | Buttons, labels, validation, email templates | Translated by developers via i18next files | `t('namespace.key')` |
| **2. System enumerations** | Statuses, Categories, Departments, Notification templates | Super Admin enters all 3 languages once via `<MultiLangInput>`. AI auto-translate suggestion is optional. Stored as `{ ru, en, hy }` | `localize(value, locale)` |
| **3. User free-text** | Asset names, comments, repair descriptions, employee names | Stored as typed; rendered as-is. No language fields, no translation | Plain `<Input>`, plain string |
| **4. English-only** | Brand, model, license name/key, IMEI, serial number, inventory code | Strictly English. No language fields | Plain `<Input>`, validated as ASCII or English-only |

## Key user flows

### Switching language

1. User clicks language switcher in app header.
2. Dropdown shows: `Русский / English / Հայերեն`.
3. On select: `i18n.changeLanguage(lang)` + write to `users/{uid}.preferredLocale`.
4. UI re-renders with the new locale.
5. Tier-2 values re-resolve via `localize()` to the new locale.

### Editing a Tier-2 field (e.g. asset status name)

1. Super Admin opens `/settings/statuses` → clicks "Edit" on a status.
2. Form shows `<MultiLangInput name="name" value={status.name} />` rendering 3 inputs side-by-side: Русский / English / Հայերեն.
3. Optional "Auto-translate" button: fills missing locales from the most-filled one (Phase 2 feature; out of MVP).
4. On submit: form validates that AT LEAST ONE locale is non-empty (configurable; default could be all-three required for statuses).
5. Stored as `{ name: { ru, en, hy } }`.

### Reading a Tier-2 field (rendered)

```jsx
const { t, i18n } = useTranslation('statuses');
const status = useStatus(statusId);
const displayName = localize(status.name, i18n.language);
return <Badge>{displayName}</Badge>;
```

`localize(value, locale)` algorithm:
1. If `value[locale]` truthy → return it.
2. Else fallback ru → en → hy → first-truthy of any locale → empty string.

## UI surfaces

- Language switcher (in `MainHeader` / `AppShell`).
- `<MultiLangInput>` reusable component (in `src/components/common/MultiLangInput/`).
- `<MultiLangText value={...} />` reusable read-only component (renders via `localize()`).

## Files & structure

```
src/
  i18n/
    index.js                # i18next init + browser detector
    namespaces.js           # exported namespace constants
  locales/
    ru/
      common.json
      auth.json
      assets.json
      branches.json
      employees.json
      departments.json
      categories.json
      statuses.json
      dashboard.json
      errors.json
      validation.json
      me.json
      settings.json
    en/  (same files)
    hy/  (same files)
  components/
    common/
      MultiLangInput/
        MultiLangInput.jsx
        MultiLangInput.test.jsx
      MultiLangText/
        MultiLangText.jsx
  lib/
    localize.js             # localize() helper
```

## Firestore impact

`users/{uid}` adds field:

```jsdoc
/** @property {'ru'|'en'|'hy'} preferredLocale */
```

Tier-2 entities (statuses, categories, departments) store `name` (and other display fields) as `{ ru: string, en: string, hy: string }`. See those features' specs for full shapes.

## Validation rule for `<MultiLangInput>`

- All three locales must be present as keys (validated by Firestore rule `request.resource.data.name.keys().hasOnly(['ru','en','hy'])`).
- At least one locale must be non-empty (required for system enums shown to all users).
- Each value: `is string`, length ≤ 200 (configurable per field).

## Permissions / role gates

- Reading translations: any signed-in user.
- Writing translations: only the Super Admin via the relevant catalog page (statuses, categories, departments).
- Setting `preferredLocale`: the user themselves.

## Open questions

- **Default locale.** Should new users default to `ru` (most likely majority), or use the browser's `navigator.language`? Default proposal: browser language detector first, fallback to `ru` if not in `['ru','en','hy']`.
- **Required-locales policy for system enums.** Required all-three? Required one + auto-fallback? Default proposal: form requires Russian (since spec is Russian); other two locales optional with explicit "translate" affordance, fallback rendering handled by `localize()`.
- **AI auto-translate.** Proposal: Phase 2 add-on. Hooks into Google Cloud Translation API or LLM via Cloud Function. Not in MVP.
- **Currency / number formatting.** AMS may show prices (Phase 2 — purchase price, repair cost). Currency is presumably the customer's local currency; intl-formatting via locale handles thousand separators automatically. Decide currency per-customer (`'AMD'`, `'USD'`, `'EUR'`). Capture in `/settings/general`.

## Acceptance criteria

- [ ] App initializes with one of `ru` / `en` / `hy` based on `users/{uid}.preferredLocale` if signed in, else browser language detector, else `ru`.
- [ ] All UI chrome strings go through `t('namespace.key')`. CI lint flags any literal-string JSX outside whitelisted dev components.
- [ ] All three locale directories ship complete (no missing keys); CI fails if a key exists in `ru` but not in `en` or `hy`.
- [ ] `<MultiLangInput>` renders 3 labeled inputs and emits `{ ru, en, hy }` shape. Tested.
- [ ] `localize(value, locale)` returns expected fallback chain. Tested with: empty value, missing locale, all-empty, partial. Tested.
- [ ] Language switcher persists choice to `users/{uid}.preferredLocale` and `localStorage`.
- [ ] Status / category / department forms use `<MultiLangInput>` (not a plain `<Input>`).
- [ ] Asset name, employee name, comments use plain `<Input>` (Tier 3) — not multi-lang.
- [ ] Inventory code, brand, model fields use plain `<Input>` (Tier 4) — validated English-only.

## Dependencies

- **Depends on:** none (foundational scaffolding).
- **Depended on by:** every other feature (Tier-1 strings everywhere); statuses, categories, departments specifically use `<MultiLangInput>`.
