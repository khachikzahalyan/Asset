/**
 * Pure-JS Excel export service for the assets list.
 *
 * No React, no Firestore, no I/O beyond the SheetJS encode call.
 * `rowsToWorkbook` is the deterministic entry point — given the same input
 * it always produces the same workbook — which keeps the tests predictable.
 */

import * as XLSX from 'xlsx';

import { COLUMN_KEYS, COLUMN_LABEL_KEYS } from '@/lib/excel/columns.js';
import { localize } from '@/lib/localize.js';
import { formatEmployeeName } from '@/domain/employees.js';
import { ASSIGNMENT_KINDS } from '@/domain/assets.js';
import { isoDateUTC } from '@/lib/format/dateUtc.js';

/**
 * Resolve an asset's `name` into the three locale columns. Single-language
 * categories store `name` as a plain string — we mirror it across all three
 * columns so the file round-trips cleanly. Multi-language categories store
 * a `{ ru, en, hy }` map and we copy each locale verbatim.
 */
function nameForLocale(asset, locale) {
  const v = asset?.name;
  if (v == null) return { ru: '', en: '', hy: '' };
  if (typeof v === 'string') return { ru: v, en: v, hy: v };
  if (typeof v === 'object') {
    const fallback = localize(v, locale) ?? '';
    return {
      ru: v.ru ?? fallback,
      en: v.en ?? fallback,
      hy: v.hy ?? fallback,
    };
  }
  return { ru: '', en: '', hy: '' };
}

function holderName(asset, ctx) {
  const k = asset?.assignedTo?.kind;
  if (k === ASSIGNMENT_KINDS.WAREHOUSE) {
    const b = asset.branchId ? ctx.branchesById?.get(asset.branchId) : null;
    return b ? localize(b.name, ctx.locale) : '';
  }
  if (k === ASSIGNMENT_KINDS.BRANCH) {
    const b = asset.branchId ? ctx.branchesById?.get(asset.branchId) : null;
    return b ? localize(b.name, ctx.locale) : '';
  }
  if (k === ASSIGNMENT_KINDS.EMPLOYEE) {
    const e = asset.assignedTo?.id ? ctx.employeesById?.get(asset.assignedTo.id) : null;
    return e ? formatEmployeeName(e, ctx.locale) : '';
  }
  if (k === ASSIGNMENT_KINDS.DEPARTMENT) {
    return asset.assignedTo?.id ?? '';
  }
  return '';
}

/**
 * Build a workbook containing one sheet ("Assets") with rows 1+2 = headers,
 * row 3+ = data.
 *
 * @param {Array<import('@/domain/assets.js').Asset>} assets
 * @param {{
 *   categoriesById: Map<string, any>,
 *   statusesById: Map<string, any>,
 *   branchesById: Map<string, any>,
 *   employeesById: Map<string, any>,
 *   locale: string,
 *   labels?: Record<string, string>,
 * }} ctx
 *   `labels` is optional — when supplied (typically by the React component
 *   passing `t(...)` resolutions), row 2 uses these strings; otherwise row 2
 *   falls back to the COLUMN_LABEL_KEYS values verbatim so the workbook
 *   still has informational headers even outside React.
 * @returns {XLSX.WorkBook}
 */
export function rowsToWorkbook(assets, ctx) {
  const headerRow1 = [...COLUMN_KEYS];
  // Row 2 is the label band. When no localized labels are supplied (mostly
  // tests / non-React callers), fall back to COLUMN_LABEL_KEYS — but the
  // import-side label-band detector requires every cell to be distinct from
  // its column key, so we suffix any colliding fallback with " (label)" to
  // keep round-trip safe.
  const headerRow2 = COLUMN_KEYS.map((k) => {
    if (ctx?.labels?.[k]) return ctx.labels[k];
    const fallback = COLUMN_LABEL_KEYS[k] ?? k;
    return fallback === k ? `${fallback} (label)` : fallback;
  });

  const aoa = [headerRow1, headerRow2];

  for (const a of assets ?? []) {
    const cat = ctx.categoriesById?.get(a.categoryId) ?? null;
    const names = nameForLocale(a, ctx.locale);
    const row = COLUMN_KEYS.map((k) => {
      switch (k) {
        case 'inventoryCode':
          return a.inventoryCode ?? '';
        case 'categoryId':
          return a.categoryId ?? '';
        case 'categoryName':
          return cat ? localize(cat.name, ctx.locale) : '';
        case 'nameRu':
          return names.ru;
        case 'nameEn':
          return names.en;
        case 'nameHy':
          return names.hy;
        case 'brand':
          return a.brand ?? '';
        case 'model':
          return a.model ?? '';
        case 'serialNumber':
          return a.serialNumber ?? '';
        case 'statusId':
          return a.statusId ?? '';
        case 'assignedToKind':
          return a.assignedTo?.kind ?? '';
        case 'assignedToId':
          return a.assignedTo?.id ?? '';
        case 'holderName':
          return holderName(a, ctx);
        case 'branchId':
          return a.branchId ?? '';
        case 'notes':
          return a.notes ?? '';
        case 'purchaseDate':
          return isoDateUTC(a.purchaseDate);
        case 'purchasePrice':
          return a.purchasePrice ?? '';
        case 'createdAt':
          return isoDateUTC(a.createdAt);
        default:
          return '';
      }
    });
    aoa.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, buildExportSheetName());
  return wb;
}

/**
 * Encode a workbook to a Blob suitable for `URL.createObjectURL` + `<a download>`.
 */
export function workbookToBlob(wb) {
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/**
 * `assets_export_YYYY-MM-DD.xlsx` (UTC date) — matches the directive.
 */
export function downloadFilename(date = new Date()) {
  return `assets_export_${isoDateUTC(date)}.xlsx`;
}

export function buildExportSheetName() {
  return 'Assets';
}
