import { useEffect, useRef } from 'react';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { useAssetStatuses } from '@/hooks/useAssetStatuses.js';
import { useAssetSubtypes } from '@/hooks/useAssetSubtypes.js';
import { useCategories } from '@/hooks/useCategories.js';
import { firestoreAssetStatusRepository } from '@/infra/repositories/firestoreAssetStatusRepository.js';
import { firestoreAssetSubtypeRepository } from '@/infra/repositories/firestoreAssetSubtypeRepository.js';
import { firestoreCategoryRepository } from '@/infra/repositories/firestoreCategoryRepository.js';
import { ROLES } from '@/domain/roles.js';
import { db } from '@/lib/firebase/index.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

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
    name: { ru: 'Устройства', en: 'Devices', hy: 'Սարքեր' },
    inventoryCodePrefix: '400',
    requiresMultilang: true,
    attachableTo: ['branch', 'warehouse', 'employee', 'department'],
    // Devices receive an inventory code from `category_counters/device`.
    assignsInventoryCode: true,
    // Device assets can act as the host target when assigning a license.
    canHostLicense: true,
  },
  {
    id: 'furniture',
    name: { ru: 'Мебель', en: 'Furniture', hy: 'Կահույք' },
    inventoryCodePrefix: '500',
    requiresMultilang: true,
    attachableTo: ['branch', 'warehouse', 'employee', 'department'],
    // Furniture receives an inventory code from `category_counters/furniture`.
    assignsInventoryCode: true,
    canHostLicense: false,
  },
  {
    id: 'license',
    name: { ru: 'Лицензии', en: 'Licenses', hy: 'Լիցենզիաներ' },
    inventoryCodePrefix: 'LIC',
    requiresMultilang: true,
    attachableTo: ['asset', 'employee'],
    // Licenses are identified by license key, not inventory code.
    assignsInventoryCode: false,
    canHostLicense: false,
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
 * Wave-A asset sub-type seeds. Stable doc ids are `<categoryId>_<slug>`.
 *
 * Per user override (Wave A, 2026-05-07): MINIMAL generic catalog only.
 * 5–7 per category, no brand names. License entries carry the generic
 * class only ("Antivirus", not "Kaspersky"). Real-world specific names
 * come in at runtime through the SubtypeManagementPage CRUD.
 *
 * All seeds are multi-lang (`requiresMultilang: true`) per the i18n
 * 4-tier strategy: catalog enums are Tier-2 system data and must render
 * in the operator's chosen UI language.
 *
 * `attachableTo` shape: array of holder kinds (subset of ASSIGNMENT_KIND_LIST).
 *   - Devices and Furniture: full set [branch, warehouse, employee, department].
 *   - All license classes (incl. OS): [asset, employee] — per user override
 *     2026-05-08, the per-category default is uniform; super_admin can narrow
 *     individual subtypes via the form when needed.
 */
const FURNITURE_DEVICE_ATTACHABLE_TO = ['branch', 'warehouse', 'employee', 'department'];
const LICENSE_DEFAULT_ATTACHABLE_TO = ['asset', 'employee'];

const ASSET_SUBTYPE_SEEDS = [
  // ----- Furniture -----
  { id: 'furniture_desk',       categoryId: 'furniture', name: { ru: 'Стол',       en: 'Desk',       hy: 'Սեղան' },     requiresMultilang: true, attachableTo: FURNITURE_DEVICE_ATTACHABLE_TO, sortOrder: 10 },
  { id: 'furniture_chair',      categoryId: 'furniture', name: { ru: 'Стул',       en: 'Chair',      hy: 'Աթոռ' },      requiresMultilang: true, attachableTo: FURNITURE_DEVICE_ATTACHABLE_TO, sortOrder: 20 },
  { id: 'furniture_cabinet',    categoryId: 'furniture', name: { ru: 'Шкаф',       en: 'Cabinet',    hy: 'Պահարան' },   requiresMultilang: true, attachableTo: FURNITURE_DEVICE_ATTACHABLE_TO, sortOrder: 30 },
  { id: 'furniture_sofa',       categoryId: 'furniture', name: { ru: 'Диван',      en: 'Sofa',       hy: 'Բազմոց' },    requiresMultilang: true, attachableTo: FURNITURE_DEVICE_ATTACHABLE_TO, sortOrder: 40 },
  { id: 'furniture_whiteboard', categoryId: 'furniture', name: { ru: 'Доска',      en: 'Board',      hy: 'Գրատախտակ' }, requiresMultilang: true, attachableTo: FURNITURE_DEVICE_ATTACHABLE_TO, sortOrder: 50 },
  { id: 'furniture_safe',       categoryId: 'furniture', name: { ru: 'Сейф',       en: 'Safe',       hy: 'Չհրկիզվող պահարան' }, requiresMultilang: true, attachableTo: FURNITURE_DEVICE_ATTACHABLE_TO, sortOrder: 60 },
  { id: 'furniture_rack',       categoryId: 'furniture', name: { ru: 'Стеллаж',    en: 'Rack',       hy: 'Դարակաշար' }, requiresMultilang: true, attachableTo: FURNITURE_DEVICE_ATTACHABLE_TO, sortOrder: 70 },

  // ----- Device -----
  { id: 'device_server',  categoryId: 'device', name: { ru: 'Сервер',             en: 'Server',         hy: 'Սերվեր' },          requiresMultilang: true, attachableTo: FURNITURE_DEVICE_ATTACHABLE_TO, sortOrder: 10 },
  { id: 'device_laptop',  categoryId: 'device', name: { ru: 'Ноутбук',            en: 'Laptop',         hy: 'Նոութբուք' },       requiresMultilang: true, attachableTo: FURNITURE_DEVICE_ATTACHABLE_TO, sortOrder: 20 },
  { id: 'device_desktop', categoryId: 'device', name: { ru: 'Настольный ПК',      en: 'Desktop',        hy: 'Աշխատասեղանային համակարգիչ' }, requiresMultilang: true, attachableTo: FURNITURE_DEVICE_ATTACHABLE_TO, sortOrder: 30 },
  { id: 'device_monitor', categoryId: 'device', name: { ru: 'Монитор',            en: 'Monitor',        hy: 'Մոնիտոր' },         requiresMultilang: true, attachableTo: FURNITURE_DEVICE_ATTACHABLE_TO, sortOrder: 40 },
  { id: 'device_phone',   categoryId: 'device', name: { ru: 'Телефон',            en: 'Phone',          hy: 'Հեռախոս' },         requiresMultilang: true, attachableTo: FURNITURE_DEVICE_ATTACHABLE_TO, sortOrder: 50 },
  { id: 'device_printer', categoryId: 'device', name: { ru: 'Принтер',            en: 'Printer',        hy: 'Տպիչ' },            requiresMultilang: true, attachableTo: FURNITURE_DEVICE_ATTACHABLE_TO, sortOrder: 60 },
  { id: 'device_network', categoryId: 'device', name: { ru: 'Сетевое устройство', en: 'Network Device', hy: 'Ցանցային սարք' },   requiresMultilang: true, attachableTo: FURNITURE_DEVICE_ATTACHABLE_TO, sortOrder: 70 },

  // ----- License (generic class only) -----
  { id: 'license_os',            categoryId: 'license', name: { ru: 'Операционная система',   en: 'Operating System',       hy: 'Օպերացիոն համակարգ' }, requiresMultilang: true, attachableTo: LICENSE_DEFAULT_ATTACHABLE_TO, sortOrder: 10 },
  { id: 'license_office_suite',  categoryId: 'license', name: { ru: 'Офисный пакет',          en: 'Office Suite',           hy: 'Գրասենյակային փաթեթ' }, requiresMultilang: true, attachableTo: LICENSE_DEFAULT_ATTACHABLE_TO, sortOrder: 20 },
  { id: 'license_antivirus',     categoryId: 'license', name: { ru: 'Антивирус',              en: 'Antivirus',              hy: 'Հակավիրուս' },         requiresMultilang: true, attachableTo: LICENSE_DEFAULT_ATTACHABLE_TO, sortOrder: 30 },
  { id: 'license_design',        categoryId: 'license', name: { ru: 'ПО для дизайна',         en: 'Design Software',        hy: 'Դիզայնի ծրագիր' },     requiresMultilang: true, attachableTo: LICENSE_DEFAULT_ATTACHABLE_TO, sortOrder: 40 },
  { id: 'license_dev',           categoryId: 'license', name: { ru: 'Инструмент разработки',  en: 'Development Tool',       hy: 'Մշակման գործիք' },     requiresMultilang: true, attachableTo: LICENSE_DEFAULT_ATTACHABLE_TO, sortOrder: 50 },
  { id: 'license_communication', categoryId: 'license', name: { ru: 'ПО для связи',           en: 'Communication Software', hy: 'Հաղորդակցման ծրագիր' }, requiresMultilang: true, attachableTo: LICENSE_DEFAULT_ATTACHABLE_TO, sortOrder: 60 },
  { id: 'license_remote_access', categoryId: 'license', name: { ru: 'Удалённый доступ',       en: 'Remote Access',          hy: 'Հեռակա մուտք' },       requiresMultilang: true, attachableTo: LICENSE_DEFAULT_ATTACHABLE_TO, sortOrder: 70 },
];

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
  const { all: subtypes, loading: subtypesLoading } = useAssetSubtypes({
    includeInactive: true,
  });
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    if (role !== ROLES.SUPER_ADMIN) return;
    if (!user) return;
    if (statusesLoading || categoriesLoading || subtypesLoading) return;

    const needStatuses = statuses.length === 0;
    const needCategories = categories.length === 0;
    const needSubtypes = subtypes.length === 0;

    attempted.current = true;
    const actor = { uid: user.uid, role };

    // Phase 1.5 extensions — run unconditionally, best-effort, non-blocking.
    ensureNotificationSettings(actor).catch((err) => {
      console.warn(
        '[AMS] notification settings bootstrap skipped:',
        err?.code ?? err?.message ?? err
      );
    });
    ensureLicenseCategoryFlag().catch((err) => {
      console.warn(
        '[AMS] license category flag bootstrap skipped:',
        err?.code ?? err?.message ?? err
      );
    });
    ensureLicenseCategoryAttachableTo().catch((err) => {
      console.warn(
        '[AMS] license category attachableTo bootstrap skipped:',
        err?.code ?? err?.message ?? err
      );
    });
    ensureCategoryCanHostLicense().catch((err) => {
      console.warn(
        '[AMS] category canHostLicense bootstrap skipped:',
        err?.code ?? err?.message ?? err
      );
    });

    if (!needStatuses && !needCategories && !needSubtypes) return;

    void seedCatalogs({
      actor,
      needStatuses,
      needCategories,
      needSubtypes,
    }).catch((err) => {
      console.warn(
        '[AMS] catalogs bootstrap skipped:',
        err?.code ?? err?.message ?? err
      );
    });
  }, [
    user,
    role,
    statuses,
    categories,
    subtypes,
    statusesLoading,
    categoriesLoading,
    subtypesLoading,
  ]);

  return null;
}

async function seedCatalogs({ actor, needStatuses, needCategories, needSubtypes }) {
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
            attachableTo: seed.attachableTo,
            // Explicit so sanitizeCategoryInput doesn't silently default
            // license to `true` (its undefined-default branch). Without
            // this, license categories would be marked as inventory-code
            // assigning, which is the opposite of the domain intent.
            assignsInventoryCode: seed.assignsInventoryCode,
            canHostLicense: Boolean(seed.canHostLicense),
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

  if (needSubtypes) {
    let added = 0;
    for (const seed of ASSET_SUBTYPE_SEEDS) {
      try {
        await firestoreAssetSubtypeRepository.create(
          {
            categoryId: seed.categoryId,
            name: seed.name,
            requiresMultilang: Boolean(seed.requiresMultilang),
            attachableTo: seed.attachableTo,
            sortOrder: seed.sortOrder ?? 0,
            isActive: true,
          },
          actor,
          { id: seed.id }
        );
        added += 1;
      } catch (err) {
        // Doc already exists (race with another tab) — keep going.
        console.warn(
          `[AMS] asset_subtypes/${seed.id} bootstrap skipped:`,
          err?.code ?? err?.message ?? err
        );
      }
    }
    if (added > 0) {
      console.info(`[AMS] asset_subtypes bootstrap: ${added} created`);
    }
  }
}

/**
 * Idempotent best-effort bootstrap for /settings/notifications.
 * Creates the doc with a 30-day default if it does not exist yet.
 * Must NOT block the caller — wrap call site in try/catch.
 *
 * @param {{ uid: string, role: string }} actor
 */
export async function ensureNotificationSettings(actor) {
  const ref = doc(db, 'settings', 'notifications');
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, {
    licenseExpiryWarningDays: 30,
    updatedAt: serverTimestamp(),
    updatedBy: actor?.uid ?? 'system',
  });
}

/**
 * Idempotent best-effort bootstrap for the license category flag.
 * Patches /categories/license with `{ assignsInventoryCode: false }` if the
 * doc exists but the flag is not already false.
 * Must NOT block the caller — wrap call site in try/catch.
 */
export async function ensureLicenseCategoryFlag() {
  const ref = doc(db, 'categories', 'license');
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  if (data.assignsInventoryCode === false) return;
  await updateDoc(ref, { assignsInventoryCode: false });
}

/**
 * Idempotent best-effort bootstrap for the license category's `attachableTo`.
 * Patches /categories/license with `{ attachableTo: ['asset', 'employee'] }`
 * if the field is missing or contains any of the forbidden kinds
 * (warehouse, branch, department).
 * Must NOT block the caller — wrap call site in try/catch.
 */
export async function ensureLicenseCategoryAttachableTo() {
  const ref = doc(db, 'categories', 'license');
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  const CORRECT = ['asset', 'employee'];
  const current = Array.isArray(data.attachableTo) ? data.attachableTo : null;
  const alreadyCorrect =
    current !== null &&
    current.length === CORRECT.length &&
    CORRECT.every((k) => current.includes(k));
  if (alreadyCorrect) return;
  await updateDoc(ref, { attachableTo: CORRECT });
}

/**
 * Idempotent best-effort bootstrap for `canHostLicense` on the three base
 * categories. Patches:
 *   - /categories/device    → canHostLicense: true  (if missing)
 *   - /categories/furniture → canHostLicense: false (if missing)
 *   - /categories/license   → canHostLicense: false (if missing)
 * Must NOT block the caller — wrap call site in try/catch.
 */
export async function ensureCategoryCanHostLicense() {
  const patches = [
    { id: 'device',    canHostLicense: true  },
    { id: 'furniture', canHostLicense: false },
    { id: 'license',   canHostLicense: false },
  ];
  for (const { id, canHostLicense } of patches) {
    const ref = doc(db, 'categories', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) continue;
    const data = snap.data();
    if (data.canHostLicense === canHostLicense) continue;
    await updateDoc(ref, { canHostLicense });
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
