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

const HEAD_OFFICE_NAME_PATTERN = /(главн|head|hq|կենտր|գլխ)/i;

function isHeadOfficeName(name) {
  if (!name || typeof name !== 'object') return false;
  return ['ru', 'en', 'hy'].some((lng) => {
    const v = name[lng];
    return typeof v === 'string' && HEAD_OFFICE_NAME_PATTERN.test(v);
  });
}

async function bootstrapHeadOfficeBranch(db, auth) {
  console.log('\n-> bootstrapping head office branch');

  const branchesSnap = await db.collection('branches').get();
  const branches = branchesSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));

  const existingPrimary = branches.find((b) => b.isPrimary === true);
  if (existingPrimary) {
    console.log(`   [=] head office already set: branches/${existingPrimary.id}. Skipping.`);
    return;
  }

  let actorUid = null;
  try {
    const seedAdmin = await auth.getUserByEmail(SEED_SUPER_ADMINS[0]);
    actorUid = seedAdmin?.uid ?? null;
  } catch {
    actorUid = null;
  }
  if (!actorUid) {
    console.log(
      `   [!] Cannot resolve seed super_admin UID (${SEED_SUPER_ADMINS[0]} hasn't signed in yet).\n` +
        '       Sign in once, then re-run seed.'
    );
    return;
  }

  // Promote an existing branch whose name matches the head-office pattern.
  const matchByName = branches.find((b) => isHeadOfficeName(b.name));
  if (matchByName) {
    console.log(`   [+] promoting branches/${matchByName.id} -> isPrimary=true`);
    const before = { ...matchByName };
    delete before.id;
    delete before.ref;
    await db.runTransaction(async (tx) => {
      tx.update(matchByName.ref, {
        isPrimary: true,
        updatedBy: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
      });
      const auditRef = db.collection('audit_logs').doc();
      tx.set(auditRef, {
        entity: 'branch',
        entityId: matchByName.id,
        action: 'update',
        actorUid,
        actorRole: 'super_admin',
        before: { isPrimary: Boolean(before.isPrimary) },
        after: { isPrimary: true },
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    console.log(`   [OK] branches/${matchByName.id} is now head office`);
    return;
  }

  // Otherwise create a brand-new head office branch.
  console.log('   [+] creating new branch "Главный Офис" with isPrimary=true');
  const newRef = db.collection('branches').doc();
  await db.runTransaction(async (tx) => {
    tx.set(newRef, {
      branchId: newRef.id,
      name: { ru: 'Главный Офис', en: 'Head Office', hy: 'Գլխավոր Օֆիս' },
      type: 'branch',
      address: '',
      responsibleEmployeeId: null,
      isActive: true,
      isPrimary: true,
      createdBy: actorUid,
      updatedBy: actorUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const auditRef = db.collection('audit_logs').doc();
    tx.set(auditRef, {
      entity: 'branch',
      entityId: newRef.id,
      action: 'create',
      actorUid,
      actorRole: 'super_admin',
      before: null,
      after: {
        name: { ru: 'Главный Офис', en: 'Head Office', hy: 'Գլխավոր Օֆիս' },
        type: 'branch',
        address: '',
        responsibleEmployeeId: null,
        isActive: true,
        isPrimary: true,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  console.log(`   [OK] branches/${newRef.id} created (head office)`);
}

// ---------------------------------------------------------------------------
// Asset-status catalog bootstrap.
//
// Writes the five base statuses requested by the user on 2026-05-07 if they
// don't already exist. Doc id = the stable code identifier so re-runs are
// safe (idempotent: existing docs are left untouched, missing ones are
// added).
//
// Source of truth for what to seed lives ONLY here, in lockstep with
// `src/domain/assetStatuses.js` which exports the same code identifiers.
// If you change one, change the other.
// ---------------------------------------------------------------------------

const ASSET_STATUS_SEEDS = [
  {
    id: 'warehouse',
    name: { ru: 'Склад', en: 'Warehouse', hy: 'Պահեստ' },
    color: '#64748b',
    isFinal: false,
    isAssignable: false,
    sortOrder: 1,
  },
  {
    id: 'assigned',
    name: { ru: 'Выдан', en: 'Assigned', hy: 'Տրված' },
    color: '#16a34a',
    isFinal: false,
    isAssignable: true,
    sortOrder: 2,
  },
  {
    id: 'in_repair',
    name: { ru: 'В ремонте', en: 'In Repair', hy: 'Վերանորոգման մեջ' },
    color: '#eab308',
    isFinal: false,
    isAssignable: false,
    sortOrder: 3,
  },
  {
    id: 'written_off',
    name: { ru: 'Списан', en: 'Written Off', hy: 'Դուրսգրված' },
    color: '#dc2626',
    isFinal: true,
    isAssignable: false,
    sortOrder: 4,
  },
  {
    id: 'disposed',
    name: { ru: 'Утилизирован', en: 'Disposed', hy: 'Ոչնչացված' },
    color: '#7f1d1d',
    isFinal: true,
    isAssignable: false,
    sortOrder: 5,
  },
];

async function bootstrapAssetStatuses(db, auth) {
  console.log('\n-> bootstrapping asset_statuses catalog');

  let actorUid = null;
  try {
    const seedAdmin = await auth.getUserByEmail(SEED_SUPER_ADMINS[0]);
    actorUid = seedAdmin?.uid ?? null;
  } catch {
    actorUid = null;
  }
  if (!actorUid) {
    console.log(
      `   [!] Cannot resolve seed super_admin UID (${SEED_SUPER_ADMINS[0]} hasn't signed in yet).\n` +
        '       Sign in once, then re-run seed.'
    );
    return;
  }

  let added = 0;
  for (const seed of ASSET_STATUS_SEEDS) {
    const ref = db.collection('asset_statuses').doc(seed.id);
    const existing = await ref.get();
    if (existing.exists) {
      console.log(`   [=] asset_statuses/${seed.id} already present, skipping`);
      continue;
    }
    await db.runTransaction(async (tx) => {
      tx.set(ref, {
        statusId: seed.id,
        name: seed.name,
        color: seed.color,
        isFinal: seed.isFinal,
        isAssignable: seed.isAssignable,
        sortOrder: seed.sortOrder,
        isActive: true,
        createdBy: actorUid,
        updatedBy: actorUid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      const auditRef = db.collection('audit_logs').doc();
      tx.set(auditRef, {
        entity: 'asset_status',
        entityId: seed.id,
        action: 'seed',
        actorUid,
        actorRole: 'super_admin',
        before: null,
        after: {
          name: seed.name,
          color: seed.color,
          isFinal: seed.isFinal,
          isAssignable: seed.isAssignable,
          sortOrder: seed.sortOrder,
          isActive: true,
        },
        at: FieldValue.serverTimestamp(),
      });
    });
    added += 1;
    console.log(`   [+] asset_statuses/${seed.id} created`);
  }

  console.log(
    `   [OK] asset_statuses bootstrap complete (${added} added, ${
      ASSET_STATUS_SEEDS.length - added
    } already present)`
  );
}

// ---------------------------------------------------------------------------
// Categories catalog bootstrap.
//
// Three base categories per the user decision on 2026-05-07:
//   - device    (Устройство)  - prefix 400, single-language (RU)
//   - furniture (Мебель)      - prefix 500, multi-language (ru/en/hy)
//   - license   (Лицензии)    - prefix LIC, single-language (RU)
//
// For single-language categories (`requiresMultilang: false`) the same
// string is mirrored across all three locale keys at seed time, so
// downstream `localize()` calls work uniformly. The flag drives the
// FORM rendering only, never the storage shape.
//
// Each new category also gets its `category_counters/{categoryId}` doc
// initialized to `{ next: 1 }` in the same transaction so the asset-create
// flow (Step 2) can increment it without first having to bootstrap.
//
// Idempotent: existing category docs are left untouched, missing ones are
// added. Counter docs are only initialized when the category is being
// added in this run.
// ---------------------------------------------------------------------------

const CATEGORY_SEEDS = [
  {
    id: 'device',
    nameRu: 'Устройство',
    inventoryCodePrefix: '400',
    requiresMultilang: false,
  },
  {
    id: 'furniture',
    name: { ru: 'Мебель', en: 'Furniture', hy: 'Կահույք' },
    inventoryCodePrefix: '500',
    requiresMultilang: true,
  },
  {
    id: 'license',
    nameRu: 'Лицензии',
    inventoryCodePrefix: 'LIC',
    requiresMultilang: false,
  },
];

function categoryNameFromSeed(seed) {
  if (seed.requiresMultilang) return seed.name;
  // Mirror the single-language name across all three locale keys so the
  // storage shape stays uniform.
  const v = seed.nameRu;
  return { ru: v, en: v, hy: v };
}

async function bootstrapCategories(db, auth) {
  console.log('\n-> bootstrapping categories catalog');

  let actorUid = null;
  try {
    const seedAdmin = await auth.getUserByEmail(SEED_SUPER_ADMINS[0]);
    actorUid = seedAdmin?.uid ?? null;
  } catch {
    actorUid = null;
  }
  if (!actorUid) {
    console.log(
      `   [!] Cannot resolve seed super_admin UID (${SEED_SUPER_ADMINS[0]} hasn't signed in yet).\n` +
        '       Sign in once, then re-run seed.'
    );
    return;
  }

  let added = 0;
  for (const seed of CATEGORY_SEEDS) {
    const ref = db.collection('categories').doc(seed.id);
    const existing = await ref.get();
    if (existing.exists) {
      console.log(`   [=] categories/${seed.id} already present, skipping`);
      continue;
    }

    const name = categoryNameFromSeed(seed);
    const counterRef = db.collection('category_counters').doc(seed.id);

    await db.runTransaction(async (tx) => {
      tx.set(ref, {
        categoryId: seed.id,
        name,
        inventoryCodePrefix: seed.inventoryCodePrefix,
        requiresMultilang: seed.requiresMultilang,
        isActive: true,
        createdBy: actorUid,
        updatedBy: actorUid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(counterRef, {
        next: 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
      const auditRef = db.collection('audit_logs').doc();
      tx.set(auditRef, {
        entity: 'category',
        entityId: seed.id,
        action: 'seed',
        actorUid,
        actorRole: 'super_admin',
        before: null,
        after: {
          name,
          inventoryCodePrefix: seed.inventoryCodePrefix,
          requiresMultilang: seed.requiresMultilang,
          isActive: true,
        },
        at: FieldValue.serverTimestamp(),
      });
    });
    added += 1;
    console.log(
      `   [+] categories/${seed.id} created (prefix=${seed.inventoryCodePrefix}) + counter init`
    );
  }

  console.log(
    `   [OK] categories bootstrap complete (${added} added, ${
      CATEGORY_SEEDS.length - added
    } already present)`
  );
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
  await backfillIsActive(db);
  await bootstrapHeadOfficeBranch(db, auth);
  await bootstrapAssetStatuses(db, auth);
  await bootstrapCategories(db, auth);

  console.log('\n[OK] Seed complete.');
}

main().catch((err) => {
  console.error('\n[X] Seed failed:', err);
  process.exit(1);
});
