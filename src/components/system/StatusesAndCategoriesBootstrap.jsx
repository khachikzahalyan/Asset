import { useEffect, useRef } from 'react';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { useAssetStatuses } from '@/hooks/useAssetStatuses.js';
import { useCategories } from '@/hooks/useCategories.js';
import { firestoreAssetStatusRepository } from '@/infra/repositories/firestoreAssetStatusRepository.js';
import { firestoreCategoryRepository } from '@/infra/repositories/firestoreCategoryRepository.js';
import { ROLES } from '@/domain/roles.js';
import { db } from '@/lib/firebase/index.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

/**
 * Asset-status seeds — kept verbatim in lockstep with `scripts/seed.js`
 * (`ASSET_STATUS_SEEDS`). The doc id in `asset_statuses/{id}` is the
 * stable code identifier so the bootstrap is idempotent across re-runs.
 */
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

/**
 * Category seeds — kept verbatim in lockstep with `scripts/seed.js`
 * (`CATEGORY_SEEDS`). For single-language categories the same string
 * is mirrored into all three locale keys by the repository's sanitizer
 * (`requiresMultilang === false` branch).
 *
 * Each new category also gets `category_counters/{categoryId}` initialized
 * to `{ next: 1 }` so the asset-create flow (Step 2) can increment it
 * without first having to bootstrap.
 */
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

function categoryNameInputFromSeed(seed) {
  if (seed.requiresMultilang) return seed.name;
  // Single-language category: feed the RU value into all three locale keys
  // so the sanitizer's mirror branch produces a uniform 3-locale doc.
  const v = seed.nameRu;
  return { ru: v, en: v, hy: v };
}

/**
 * Side-effect-only component. Renders nothing.
 *
 * On first super_admin sign-in (or any subsequent one if the catalogs are
 * empty), seeds the asset_statuses and categories collections from the
 * lists above. Idempotent: a single attempt per page load, and each seed
 * uses a stable doc id so re-runs never produce duplicates.
 *
 * Mirrors `HeadOfficeBootstrap` so the user can run AMS without having to
 * obtain a Firebase service-account key locally — the catalogs that
 * `npm run seed` would normally write are bootstrapped from the app
 * itself when the seed super_admin first lands on the dashboard.
 *
 * What it touches:
 *   - asset_statuses/{warehouse|assigned|in_repair|written_off|disposed}
 *   - categories/{device|furniture|license}
 *   - category_counters/{device|furniture|license}  (one-time `{ next: 1 }`)
 *
 * What it does NOT touch:
 *   - settings/auth, meta/info, users/{uid}: those still belong to the
 *     server-side seed script (require admin SDK privileges).
 *   - branches: `HeadOfficeBootstrap` owns that.
 */
export default function StatusesAndCategoriesBootstrap() {
  const { user, role } = useAuth();
  const { data: statuses, loading: statusesLoading } = useAssetStatuses();
  const { data: categories, loading: categoriesLoading } = useCategories();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    if (role !== ROLES.SUPER_ADMIN) return;
    if (!user) return;
    if (statusesLoading || categoriesLoading) return;

    const needStatuses = statuses.length === 0;
    const needCategories = categories.length === 0;
    if (!needStatuses && !needCategories) return;

    attempted.current = true;
    const actor = { uid: user.uid, role };

    void seedCatalogs({
      actor,
      needStatuses,
      needCategories,
    }).catch((err) => {
      console.warn(
        '[AMS] catalogs bootstrap skipped:',
        err?.code ?? err?.message ?? err
      );
    });
  }, [user, role, statuses, categories, statusesLoading, categoriesLoading]);

  return null;
}

async function seedCatalogs({ actor, needStatuses, needCategories }) {
  if (needStatuses) {
    let added = 0;
    for (const seed of ASSET_STATUS_SEEDS) {
      try {
        await firestoreAssetStatusRepository.create(
          {
            name: seed.name,
            color: seed.color,
            isFinal: seed.isFinal,
            isAssignable: seed.isAssignable,
            sortOrder: seed.sortOrder,
            isActive: true,
          },
          actor,
          { id: seed.id }
        );
        added += 1;
      } catch (err) {
        // Doc already exists (race with another tab) — keep going.
        console.warn(
          `[AMS] asset_statuses/${seed.id} bootstrap skipped:`,
          err?.code ?? err?.message ?? err
        );
      }
    }
    if (added > 0) {
      console.info(`[AMS] asset_statuses bootstrap: ${added} created`);
    }
  }

  if (needCategories) {
    let added = 0;
    for (const seed of CATEGORY_SEEDS) {
      try {
        await firestoreCategoryRepository.create(
          {
            name: categoryNameInputFromSeed(seed),
            inventoryCodePrefix: seed.inventoryCodePrefix,
            requiresMultilang: seed.requiresMultilang,
            isActive: true,
          },
          actor,
          { id: seed.id }
        );

        // Categories repository deliberately does NOT touch the counter
        // doc (see firestoreCategoryRepository.js header comment). Init
        // the matching `category_counters/{seed.id}` here so the
        // asset-create flow has something to increment.
        await ensureCategoryCounter(seed.id, actor);

        added += 1;
      } catch (err) {
        console.warn(
          `[AMS] categories/${seed.id} bootstrap skipped:`,
          err?.code ?? err?.message ?? err
        );
      }
    }
    if (added > 0) {
      console.info(`[AMS] categories bootstrap: ${added} created`);
    }
  }
}

async function ensureCategoryCounter(categoryId, actor) {
  const ref = doc(db, 'category_counters', categoryId);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, {
    next: 1,
    updatedAt: serverTimestamp(),
  });
  // Counter init is infrastructure but per the audit invariant we record a
  // `counter_initialized` row so the audit log stays a complete picture of
  // every Firestore mutation in the app. Two separate writes (counter,
  // audit) — not atomic, but the bootstrap is idempotent and audit-only
  // skew on a one-time write is acceptable.
  await setDoc(
    newAuditLogRef(),
    buildAuditLog({
      entity: 'category',
      entityId: categoryId,
      action: 'counter_initialized',
      actorUid: actor.uid,
      actorRole: actor.role,
      after: { next: 1 },
    })
  );
}
