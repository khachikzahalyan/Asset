import { useEffect, useRef } from 'react';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { useCategories } from '@/hooks/useCategories.js';
import { useAssetSubtypes } from '@/hooks/useAssetSubtypes.js';
import { firestoreCategoryRepository } from '@/infra/repositories/firestoreCategoryRepository.js';
import { firestoreAssetSubtypeRepository } from '@/infra/repositories/firestoreAssetSubtypeRepository.js';
import { ROLES } from '@/domain/roles.js';

/**
 * Categories that were originally single-lang seeded with the RU value
 * mirrored into all three locale keys. The migration upgrades each doc to
 * a proper multi-lang name (plural, consistent across ru/en/hy) IFF its
 * current `name` still matches one of the legacy single-lang shapes
 * exactly. User-customized names are left alone.
 */
const CATEGORY_PATCHES = [
  {
    id: 'device',
    legacyValues: ['Устройство', 'Устройства', 'Device', 'Devices'],
    next: { ru: 'Устройства', en: 'Devices', hy: 'Սարքեր' },
  },
  {
    id: 'license',
    legacyValues: ['Лицензии', 'Лицензия', 'License', 'Licenses'],
    next: { ru: 'Лицензии', en: 'Licenses', hy: 'Լիցենզիաներ' },
  },
];

/**
 * Sub-types whose seed values used to be English-only single-lang
 * (the sanitizer mirrored the English string into all three locale keys).
 * Each entry maps `subtypeId` → the multi-lang name we want now. Patch
 * fires only when the stored `name` matches the legacy English string in
 * all three locales (i.e. untouched by the operator).
 */
const SUBTYPE_PATCHES = [
  { id: 'device_server',  legacy: 'Server',         next: { ru: 'Сервер',             en: 'Server',         hy: 'Սերվեր' } },
  { id: 'device_laptop',  legacy: 'Laptop',         next: { ru: 'Ноутбук',            en: 'Laptop',         hy: 'Նոութբուք' } },
  { id: 'device_desktop', legacy: 'Desktop',        next: { ru: 'Настольный ПК',      en: 'Desktop',        hy: 'Աշխատասեղանային համակարգիչ' } },
  { id: 'device_monitor', legacy: 'Monitor',        next: { ru: 'Монитор',            en: 'Monitor',        hy: 'Մոնիտոր' } },
  { id: 'device_phone',   legacy: 'Phone',          next: { ru: 'Телефон',            en: 'Phone',          hy: 'Հեռախոս' } },
  { id: 'device_printer', legacy: 'Printer',        next: { ru: 'Принтер',            en: 'Printer',        hy: 'Տպիչ' } },
  { id: 'device_network', legacy: 'Network Device', next: { ru: 'Сетевое устройство', en: 'Network Device', hy: 'Ցանցային սարք' } },

  { id: 'license_os',            legacy: 'Operating System',       next: { ru: 'Операционная система',  en: 'Operating System',       hy: 'Օպերացիոն համակարգ' } },
  { id: 'license_office_suite',  legacy: 'Office Suite',           next: { ru: 'Офисный пакет',         en: 'Office Suite',           hy: 'Գրասենյակային փաթեթ' } },
  { id: 'license_antivirus',     legacy: 'Antivirus',              next: { ru: 'Антивирус',             en: 'Antivirus',              hy: 'Հակավիրուս' } },
  { id: 'license_design',        legacy: 'Design Software',        next: { ru: 'ПО для дизайна',        en: 'Design Software',        hy: 'Դիզայնի ծրագիր' } },
  { id: 'license_dev',           legacy: 'Development Tool',       next: { ru: 'Инструмент разработки', en: 'Development Tool',       hy: 'Մշակման գործիք' } },
  { id: 'license_communication', legacy: 'Communication Software', next: { ru: 'ПО для связи',          en: 'Communication Software', hy: 'Հաղորդակցման ծրագիր' } },
  { id: 'license_remote_access', legacy: 'Remote Access',          next: { ru: 'Удалённый доступ',      en: 'Remote Access',          hy: 'Հեռակա մուտք' } },
];

/**
 * Default `attachableTo` arrays per category (keyed by `categoryId`). Used
 * to upgrade docs that still carry the legacy enum / null shape inherited
 * from the pre-attachableTo-array seed. Per user override 2026-05-08 the
 * defaults are uniform per category — including the OS license, which now
 * shares the `['asset', 'employee']` default with the rest of the licenses.
 */
const CATEGORY_DEFAULT_ATTACHABLE_TO = {
  device:    ['branch', 'warehouse', 'employee', 'department'],
  furniture: ['branch', 'warehouse', 'employee', 'department'],
  license:   ['asset', 'employee'],
};

function looksLikeLegacyMirror(name, legacyValues) {
  if (!name || typeof name !== 'object') return false;
  const ru = name.ru;
  const en = name.en;
  const hy = name.hy;
  if (typeof ru !== 'string') return false;
  if (ru !== en || ru !== hy) return false;
  return legacyValues.includes(ru);
}

function shallowEqualName(a, b) {
  if (!a || !b) return false;
  return a.ru === b.ru && a.en === b.en && a.hy === b.hy;
}

/**
 * Side-effect-only component. Renders nothing.
 *
 * One-shot data migration: upgrades pre-existing `categories` and
 * `asset_subtypes` documents to the current schema shape, in two passes:
 *
 *   Pass 1 — name shape: docs whose `name` is still a legacy single-lang
 *   mirrored triple (`{ ru: X, en: X, hy: X }`) get a proper multi-lang
 *   name. User-customized names are left alone.
 *
 *   Pass 2 — attachableTo shape: docs whose `attachableTo` is still the
 *   legacy enum (`'device-only' | 'device-or-employee' | null`) or missing
 *   on a category get an array of allowed kinds. Already-array shapes are
 *   no-ops.
 *
 * Both passes are naturally idempotent — once upgraded, a doc no longer
 * matches the legacy shape and the next run skips it.
 *
 * Runs only for SUPER_ADMIN sessions. Each upgrade goes through the
 * repository's `update` method so audit logs are written.
 */
export default function CatalogShapeMigration() {
  const { user, role } = useAuth();
  const { data: categories, loading: categoriesLoading } = useCategories();
  const { all: subtypes, loading: subtypesLoading } = useAssetSubtypes({
    includeInactive: true,
  });
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    if (role !== ROLES.SUPER_ADMIN) return;
    if (!user) return;
    if (categoriesLoading || subtypesLoading) return;

    attempted.current = true;
    const actor = { uid: user.uid, role };

    void runMigration({ categories, subtypes, actor }).catch((err) => {
      console.warn(
        '[AMS] catalog-shape migration skipped:',
        err?.code ?? err?.message ?? err
      );
    });
  }, [user, role, categories, subtypes, categoriesLoading, subtypesLoading]);

  return null;
}

async function runMigration({ categories, subtypes, actor }) {
  let upgraded = 0;

  // ---- Pass 1: name shape ----
  for (const patch of CATEGORY_PATCHES) {
    const cat = categories.find((c) => c.categoryId === patch.id);
    if (!cat) continue;
    if (!looksLikeLegacyMirror(cat.name, patch.legacyValues)) continue;
    if (cat.requiresMultilang === true && shallowEqualName(cat.name, patch.next)) {
      continue;
    }
    try {
      await firestoreCategoryRepository.update(
        cat.categoryId,
        {
          name: patch.next,
          inventoryCodePrefix: cat.inventoryCodePrefix,
          requiresMultilang: true,
          attachableTo: Array.isArray(cat.attachableTo) && cat.attachableTo.length > 0
            ? cat.attachableTo
            : (CATEGORY_DEFAULT_ATTACHABLE_TO[cat.categoryId] ?? []),
          isActive: cat.isActive ?? true,
        },
        cat,
        actor
      );
      upgraded += 1;
    } catch (err) {
      console.warn(
        `[AMS] migration: category.name ${cat.categoryId} skipped:`,
        err?.code ?? err?.message ?? err
      );
    }
  }

  for (const patch of SUBTYPE_PATCHES) {
    const sub = subtypes.find((s) => s.subtypeId === patch.id);
    if (!sub) continue;
    if (!looksLikeLegacyMirror(sub.name, [patch.legacy])) continue;
    try {
      await firestoreAssetSubtypeRepository.update(
        sub.subtypeId,
        {
          categoryId: sub.categoryId,
          name: patch.next,
          requiresMultilang: true,
          attachableTo: upgradeSubtypeAttachableTo(sub),
          sortOrder: sub.sortOrder ?? 0,
          isActive: sub.isActive ?? true,
        },
        sub,
        actor
      );
      upgraded += 1;
    } catch (err) {
      console.warn(
        `[AMS] migration: subtype.name ${sub.subtypeId} skipped:`,
        err?.code ?? err?.message ?? err
      );
    }
  }

  // ---- Pass 2: attachableTo shape ----
  // Categories whose attachableTo is missing or not an array → seed default.
  for (const cat of categories) {
    if (Array.isArray(cat.attachableTo) && cat.attachableTo.length > 0) continue;
    const next = CATEGORY_DEFAULT_ATTACHABLE_TO[cat.categoryId];
    if (!next) continue; // unknown custom category — super admin sets it manually
    try {
      await firestoreCategoryRepository.update(
        cat.categoryId,
        {
          name: cat.name,
          inventoryCodePrefix: cat.inventoryCodePrefix,
          requiresMultilang: cat.requiresMultilang ?? true,
          attachableTo: next,
          isActive: cat.isActive ?? true,
        },
        cat,
        actor
      );
      upgraded += 1;
    } catch (err) {
      console.warn(
        `[AMS] migration: category.attachableTo ${cat.categoryId} skipped:`,
        err?.code ?? err?.message ?? err
      );
    }
  }

  // Sub-types whose attachableTo is enum/null/missing → upgrade to array.
  for (const sub of subtypes) {
    if (Array.isArray(sub.attachableTo) && sub.attachableTo.length > 0) continue;
    const next = upgradeSubtypeAttachableTo(sub);
    if (!next || next.length === 0) continue; // unknown category — skip
    try {
      await firestoreAssetSubtypeRepository.update(
        sub.subtypeId,
        {
          categoryId: sub.categoryId,
          name: sub.name,
          requiresMultilang: sub.requiresMultilang ?? false,
          attachableTo: next,
          sortOrder: sub.sortOrder ?? 0,
          isActive: sub.isActive ?? true,
        },
        sub,
        actor
      );
      upgraded += 1;
    } catch (err) {
      console.warn(
        `[AMS] migration: subtype.attachableTo ${sub.subtypeId} skipped:`,
        err?.code ?? err?.message ?? err
      );
    }
  }

  if (upgraded > 0) {
    console.info(
      `[AMS] catalog-shape migration: ${upgraded} doc(s) upgraded`
    );
  }
}

/**
 * Map a sub-type's legacy `attachableTo` (enum string / null / missing) to
 * the new array shape. Per user override 2026-05-08 we no longer preserve
 * narrower legacy enums — every sub-type without an explicit array falls
 * back to its category's default set. Operators can narrow individual
 * sub-types via the form afterwards.
 *
 *   array (non-empty)     → unchanged
 *   anything else         → category default (or [] for unknown category)
 */
function upgradeSubtypeAttachableTo(sub) {
  if (Array.isArray(sub.attachableTo) && sub.attachableTo.length > 0) {
    return sub.attachableTo;
  }
  return CATEGORY_DEFAULT_ATTACHABLE_TO[sub.categoryId] ?? [];
}
