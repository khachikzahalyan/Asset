/**
 * Emulator-based rules tests for /employees and /email_index.
 *
 * SKIPPED until a JRE is available locally or in CI. See ./README.md.
 *
 * The same matrix is mirrored as a pure-JS unit test in
 *   src/test/employees.rulesMirror.test.js
 * which runs in every CI pass.
 *
 * To enable:
 *   1. Install a JRE.
 *   2. `npx firebase emulators:start --only firestore` (port 8080).
 *   3. Replace `describe.skip(...)` with `describe(...)`.
 *   4. From firestore-tests/: `npm install && npm test` (or wire into root
 *      via `npm run test:rules`).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// `assertSucceeds` / `assertFails` will be imported lazily inside the
// describe block so the unused-import lint rule doesn't trip while the
// suite is fully skipped. The import path is the same as the real test
// would use.
let testEnv;

describe.skip('firestore rules — /employees and /email_index (EMULATOR)', () => {
  beforeAll(async () => {
    const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
    const { readFileSync } = await import('node:fs');
    testEnv = await initializeTestEnvironment({
      projectId: 'ams-rules-test',
      firestore: {
        rules: readFileSync('../firestore.rules', 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    });
  });

  afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  beforeEach(async () => {
    if (testEnv) await testEnv.clearFirestore();
  });

  it('placeholder — see employees.rulesMirror.test.js for current coverage', () => {
    expect(true).toBe(true);
  });
});
