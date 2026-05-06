# AMS — Asset Management System

React 19 + Vite + Tailwind + shadcn/ui frontend, hosted on Vercel.
Firebase Auth + Firestore + Cloud Storage + Cloud Functions backend.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in your Firebase web-app config
npm run dev
```

App runs at `http://localhost:5173`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server with HMR. |
| `npm run build` | Type-check and build the production bundle into `dist/`. |
| `npm run preview` | Serve the production build locally. |
| `npm test` | Run Vitest in watch mode. |
| `npm run test:run` | Run Vitest once (for CI). |
| `npm run test:ui` | Open the Vitest UI dashboard. |
| `npm run lint` | Lint with ESLint. |
| `npm run format` | Format with Prettier. |

## Project structure

```
src/
  components/   # React components (shadcn/ui under components/ui/, app components alongside)
  config/       # Route table + constants
  contexts/     # React contexts (AuthContext)
  domain/       # Pure business types and constants (roles.js, JSDoc typedefs)
  hooks/        # React hooks
  i18n/         # i18next init + namespace constants
  infra/        # Repositories that talk to Firebase
  lib/          # Firebase singletons, audit helper, localize() helper
  locales/      # ru/, en/, hy/ — translation JSON files
  pages/        # Route components
  test/         # Vitest setup + Firebase mocks
docs/
  AMS_Plan_v3.md           # Original spec
  features/                # Per-feature specifications (Phase 1 detailed + Phase 2/3 stubs)
.claude/agents/            # Subagent definitions
firestore.rules
firestore.indexes.json
storage.rules
firebase.json
```

## Firebase setup (one-time, you do this manually)

1. Install the CLI:
   ```bash
   npm install -g firebase-tools
   ```
2. Sign in:
   ```bash
   firebase login
   ```
3. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com).
4. Link this directory to that project:
   ```bash
   firebase use --add
   ```
5. Enable in the Firebase console:
   - **Authentication** → Google provider + Email link (passwordless).
   - **Firestore Database** (in production mode).
   - **Cloud Storage**.
   - **Extensions** → install **Trigger Email** from Firebase Extensions.
6. Add a Web App in Project Settings → copy the config values into `.env.local`.
7. Deploy security rules:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes,storage
   ```
8. Seed the bootstrap admin (script is added in a later step):
   ```bash
   AMS_SEED_SUPER_ADMIN=zahalyanxcho@gmail.com node scripts/seed.js
   ```

## Hosting

The frontend is built to deploy to **Vercel**. The backend lives entirely in Firebase (no Firebase Hosting). On Vercel, set the same `VITE_FIREBASE_*` environment variables in the project's settings.

## Documentation

Per-feature specs live under `docs/features/`. Start with [docs/features/README.md](docs/features/README.md) for the catalog and implementation order.
