#!/usr/bin/env node
/**
 * AMS seed / bootstrap script.
 *
 * Idempotent. Safe to re-run.
 *
 * What it does:
 *   1. Writes settings/auth     → { seedSuperAdmins: [...] }
 *   2. Writes meta/info         → { seededAt, version, appName }
 *   3. For each email in SEED_SUPER_ADMINS:
 *        - Looks up Firebase Auth user by email.
 *        - If found AND no users/{uid} doc exists → creates one with role=super_admin.
 *        - If not found → logs a hint (the user hasn't signed in yet).
 *
 * Typical workflow:
 *   - First run (before sign-in): writes settings docs, prints hint to sign in.
 *   - User signs in via Google in the app → Firebase Auth creates the user.
 *   - Second run: finds the auth user, grants super_admin role → user can access dashboard.
 *
 * Setup (one-time):
 *   1. Firebase Console → Project settings → Service accounts → Generate new private key.
 *   2. Save the downloaded JSON as ./serviceAccountKey.json (already gitignored).
 *
 * Run:
 *   npm run seed
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SA_PATH = resolve(__dirname, '..', 'serviceAccountKey.json');

const SEED_SUPER_ADMINS = ['zahalyanxcho@gmail.com'];

function loadServiceAccount() {
  try {
    const raw = readFileSync(SA_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(
      `\n[X] Could not read ${SA_PATH}.\n` +
        '   Download a service account key from:\n' +
        '   Firebase Console -> Project settings -> Service accounts -> Generate new private key\n' +
        '   Save it as ./serviceAccountKey.json and re-run.\n'
    );
    throw err;
  }
}

async function writeSettingsAndMeta(db) {
  console.log('-> settings/auth');
  await db
    .collection('settings')
    .doc('auth')
    .set(
      {
        seedSuperAdmins: SEED_SUPER_ADMINS,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  console.log('-> meta/info');
  await db
    .collection('meta')
    .doc('info')
    .set(
      {
        seededAt: FieldValue.serverTimestamp(),
        version: 1,
        appName: 'AMS',
      },
      { merge: true }
    );
}

async function bootstrapSuperAdmins(auth, db) {
  for (const email of SEED_SUPER_ADMINS) {
    console.log(`\n-> bootstrapping ${email}`);

    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
    } catch (err) {
      if (err?.code === 'auth/user-not-found') {
        console.log(
          `   [!] No Firebase Auth user found for ${email}.\n` +
            '       Sign in once with Google in the app (http://localhost:5173/login),\n' +
            '       then re-run this script to grant the super_admin role.'
        );
        continue;
      }
      throw err;
    }

    const uid = userRecord.uid;
    const userDocRef = db.collection('users').doc(uid);
    const existing = await userDocRef.get();

    if (existing.exists && existing.data()?.role === 'super_admin') {
      console.log(`   [=] ${email} already has role=super_admin. Skipping.`);
      continue;
    }

    await userDocRef.set(
      {
        email: userRecord.email,
        displayName: userRecord.displayName ?? null,
        photoURL: userRecord.photoURL ?? null,
        role: 'super_admin',
        branchId: null,
        departmentId: null,
        employeeId: null,
        preferredLocale: 'ru',
        createdAt: existing.exists ? existing.data()?.createdAt ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log(`   [OK] users/${uid} -> role=super_admin`);
  }
}

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

async function main() {
  if (getApps().length === 0) {
    initializeApp({ credential: cert(loadServiceAccount()) });
  }
  const db = getFirestore();
  const auth = getAuth();

  await writeSettingsAndMeta(db);
  await bootstrapSuperAdmins(auth, db);
  await backfillIsActive(db);          // NEW

  console.log('\n[OK] Seed complete.');
}

main().catch((err) => {
  console.error('\n[X] Seed failed:', err);
  process.exit(1);
});
