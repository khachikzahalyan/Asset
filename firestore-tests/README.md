# Firestore rules emulator tests

These tests exercise `firestore.rules` against the **real** Firebase emulator
using `@firebase/rules-unit-testing`. They are the source of truth for
rule-level authorization.

## Status

**Currently skipped in CI** because the AMS dev workstation does not have
Java installed (the Firestore emulator is a Java process). A pure-JS mirror
of the same rule logic lives at `src/test/employees.rulesMirror.test.js` and
runs as part of the regular `npm test` pass; the mirror covers every case
in `docs/superpowers/plans/employees-foundation.md` §9.3.

When Java becomes available locally or in CI:

1. Install a JRE (Eclipse Temurin LTS works well) and add it to `PATH`.
2. From repo root run `npx firebase emulators:start --only firestore`
   in one terminal.
3. From repo root run `npm run test:rules`.
4. The skip marker on `describe.skip(...)` in `employees.rules.test.js`
   should then be removed and the file should pass against the rules in
   `firestore.rules`.

## Why both files

The mirror is a contract test on a JS function that copies the rule logic.
It is **fast and deterministic** but only catches bugs that exist in both
the rule AND the mirror — a subtle rules-engine semantic the mirror got
wrong will not be caught.

The emulator test is the real thing: it parses `firestore.rules` and runs
the actual rules engine. It is the gate that should run before deploying
rules to production.

## Files

- `employees.rules.test.js` — rule cases for the `/employees` and
  `/email_index` collections.
- `vitest.config.js` — local Vitest config so the workspace can be run
  from its own folder without disturbing the root config.
