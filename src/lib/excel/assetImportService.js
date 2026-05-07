/**
 * Pure-JS Excel import service for the assets workbook.
 *
 * Stays decoupled from React and Firestore: takes catalog snapshots in via
 * `ctx`, returns plain JS objects (`ValidationResult`). The dialog component
 * orchestrates side effects (reading the file, calling the repository).
 */

import * as XLSX from 'xlsx';
import { COLUMN_KEYS } from '@/lib/excel/columns.js';
import { ASSIGNMENT_KIND_LIST, ASSIGNMENT_KINDS } from '@/domain/assets.js';
import { DEFAULT_ASSET_STATUS_CODE } from '@/domain/assetStatuses.js';

/**
 * @typedef {{
 *   status: 'green'|'yellow'|'red',
 *   errors: Array<{ rule: string, field?: string }>,
 *   warnings: Array<{ rule: string, field?: string }>,
 *   normalized: object | null,
 * }} ValidationResult
 */

const NON_ASCII_REGEX = /[^\x00-\x7F]/;

// ----- file → workbook ------------------------------------------------------

/**
 * Wrap `XLSX.read` so the dialog has a single `await` integration point.
 */
export async function workbookFromArrayBuffer(buf) {
  return XLSX.read(buf, { type: 'array' });
}

// ----- workbook → rows ------------------------------------------------------

/**
 * Read the first sheet (case-insensitive "Assets" preferred when present)
 * and return rows keyed by COLUMN_KEYS.
 *
 * Row 1 is treated as the header (machine-readable column keys). Row 2 is
 * detected as a label band when every cell is a string AND no cell matches a
 * known column key — in that case data starts at row 3. Otherwise data
 * starts at row 2 so a hand-rolled file with one header row also works.
 *
 * Empty rows are skipped. Unknown headers are ignored.
 */
export function workbookToRows(wb) {
  const sheetName =
    wb.SheetNames.find((n) => n.toLowerCase() === 'assets') ?? wb.SheetNames[0];
  if (!sheetName) {
    return { headerKeys: [], rows: [], errors: ['errorImportEmptyFile'] };
  }
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  if (aoa.length === 0) {
    return { headerKeys: [], rows: [], errors: ['errorImportEmptyFile'] };
  }

  const headerRow1 = aoa[0].map((c) => String(c ?? '').trim());

  const knownKeys = new Set(COLUMN_KEYS);
  // Detect a label band on row 2. A label band's defining shape:
  //   - Every cell is a non-empty string (labels never blank), AND
  //   - No cell equals a recognized column key (so the band doesn't
  //     duplicate row 1).
  // Real data rows almost always have at least one empty cell (assets rarely
  // populate every column), which is the negative signal we exploit to
  // distinguish them.
  const looksLikeLabels =
    aoa[1] &&
    aoa[1].length === aoa[0].length &&
    aoa[1].every(
      (c) =>
        typeof c === 'string' &&
        c.trim() !== '' &&
        !knownKeys.has(String(c).trim()),
    );
  const dataStart = looksLikeLabels ? 2 : 1;

  // Build a key → column index map. Unknown headers are ignored.
  const idx = new Map();
  for (let i = 0; i < headerRow1.length; i++) {
    if (knownKeys.has(headerRow1[i])) idx.set(headerRow1[i], i);
  }

  const rows = [];
  for (let r = dataStart; r < aoa.length; r++) {
    const raw = aoa[r];
    if (!Array.isArray(raw)) continue;
    if (raw.every((c) => c == null || String(c).trim() === '')) continue;
    const obj = {};
    for (const key of COLUMN_KEYS) {
      const i = idx.get(key);
      obj[key] = i === undefined ? '' : (raw[i] ?? '');
    }
    rows.push(obj);
  }
  return { headerKeys: headerRow1, rows, errors: [] };
}

// ----- per-row validation ---------------------------------------------------

function strOr(v) {
  return v == null ? '' : String(v).trim();
}

function asNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = strOr(v);
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a date cell. Accepts:
 *   - Date instance
 *   - Excel serial number (XLSX leaves dates as numbers when cellDates: false)
 *   - ISO `yyyy-mm-dd` string (treated as UTC)
 *   - any other Date.parse-able string
 * Returns `null` on unparseable input.
 */
function parseDateCell(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.valueOf()) ? null : v;
  if (typeof v === 'number') {
    // Excel serial date — epoch 1899-12-30 (the "1900 leap year bug" offset).
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return Number.isNaN(d.valueOf()) ? null : d;
  }
  const s = String(v).trim();
  if (!s) return null;
  // Strict ISO yyyy-mm-dd (UTC).
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return Number.isNaN(d.valueOf()) ? null : d;
  }
  // Looser: let Date parse; reject if Date.parse returned NaN.
  const d2 = new Date(s);
  return Number.isNaN(d2.valueOf()) ? null : d2;
}

function resolveCategory(rawRow, ctx) {
  const id = strOr(rawRow.categoryId);
  if (id) {
    const cat = ctx.categories.find((c) => c.categoryId === id);
    if (cat && cat.isActive !== false) return cat;
    return null;
  }
  const name = strOr(rawRow.categoryName);
  if (!name) return null;
  // Try matching against any locale of the name; require exactly one match.
  const found = ctx.categories.filter((c) => {
    if (c.isActive === false) return false;
    return ['ru', 'en', 'hy'].some(
      (l) => (c.name?.[l] ?? '').toLowerCase() === name.toLowerCase(),
    );
  });
  if (found.length === 1) return found[0];
  return null;
}

function resolveStatusById(id, ctx) {
  if (!id) return null;
  return (
    ctx.statuses.find((s) => s.statusId === id && s.isActive !== false) ?? null
  );
}

function resolveBranchById(id, ctx) {
  const s = strOr(id);
  if (!s) return null;
  return ctx.branches.find((b) => b.branchId === s && b.isActive !== false) ?? null;
}

function resolveEmployeeById(id, ctx) {
  const s = strOr(id);
  if (!s) return null;
  return (
    ctx.employees.find((e) => e.employeeId === s && e.isActive !== false) ?? null
  );
}

/**
 * Validate one raw row from the workbook and produce a `ValidationResult`.
 *
 * @param {Record<string, unknown>} rawRow
 * @param {number} rowIndex
 * @param {{
 *   categories: any[], statuses: any[], branches: any[], employees: any[],
 *   existingInventoryCodes: Set<string>,
 * }} ctx
 * @returns {ValidationResult}
 */
export function validateRow(rawRow, rowIndex, ctx) {
  const errors = [];
  const warnings = [];

  // --- inventoryCode conflict (does not short-circuit; we still surface other errors) ---
  const invCode = strOr(rawRow.inventoryCode);
  if (invCode && ctx.existingInventoryCodes?.has(invCode)) {
    errors.push({ rule: 'errorImportInventoryCodeConflict' });
  }

  // --- 1. category ---
  const cat = resolveCategory(rawRow, ctx);
  if (!cat) {
    errors.push({ rule: 'errorImportCategoryRequired' });
  }

  // --- 2. name ---
  const ru = strOr(rawRow.nameRu);
  const en = strOr(rawRow.nameEn);
  const hy = strOr(rawRow.nameHy);
  let name = null;
  if (cat) {
    if (cat.requiresMultilang) {
      const filled = [ru, en, hy].filter(Boolean);
      if (filled.length === 0) {
        errors.push({ rule: 'errorImportNameRequired' });
      } else {
        name = { ru, en, hy };
        if (filled.length < 3) {
          warnings.push({ rule: 'warnImportNamePartialLocales' });
        }
      }
    } else {
      // Single-lang: nameRu wins; fall back to first non-empty.
      const v = ru || en || hy;
      if (!v) {
        errors.push({ rule: 'errorImportNameRequired' });
      } else {
        name = v;
      }
    }
  }

  // --- 3. assignedToKind ---
  const kind = strOr(rawRow.assignedToKind).toLowerCase();
  if (!ASSIGNMENT_KIND_LIST.includes(kind)) {
    errors.push({ rule: 'errorImportAssignedKindRequired' });
  }

  // --- 4. warehouse + id present → warning, drop the id ---
  let assignedToId = strOr(rawRow.assignedToId);
  if (kind === ASSIGNMENT_KINDS.WAREHOUSE && assignedToId) {
    warnings.push({ rule: 'warnImportWarehouseIdIgnored' });
    assignedToId = '';
  }

  // --- 5. holder existence ---
  if (kind === ASSIGNMENT_KINDS.EMPLOYEE) {
    if (!resolveEmployeeById(assignedToId, ctx)) {
      errors.push({ rule: 'errorImportEmployeeUnknown' });
    }
  } else if (kind === ASSIGNMENT_KINDS.BRANCH) {
    if (!resolveBranchById(assignedToId, ctx)) {
      errors.push({ rule: 'errorImportBranchUnknown' });
    }
  } else if (kind === ASSIGNMENT_KINDS.DEPARTMENT) {
    if (!assignedToId) {
      errors.push({ rule: 'errorImportDepartmentRequired' });
    }
  }

  // --- 6. ASCII brand/model/serial ---
  for (const f of ['brand', 'model', 'serialNumber']) {
    const v = strOr(rawRow[f]);
    if (v && NON_ASCII_REGEX.test(v)) {
      errors.push({ rule: 'errorImportAsciiOnly', field: f });
    }
  }

  // --- 7. status (resolve with fallback) ---
  const rawStatusId = strOr(rawRow.statusId);
  let status = resolveStatusById(rawStatusId, ctx);
  let statusId = status?.statusId ?? null;
  if (!status) {
    warnings.push({ rule: 'warnImportStatusFallback' });
    statusId = DEFAULT_ASSET_STATUS_CODE;
    status =
      ctx.statuses.find((s) => s.statusId === DEFAULT_ASSET_STATUS_CODE) ??
      null;
  }

  // --- 8. status × kind compatibility ---
  if (status && ASSIGNMENT_KIND_LIST.includes(kind)) {
    const wantAssignable = kind !== ASSIGNMENT_KINDS.WAREHOUSE;
    if (Boolean(status.isAssignable) !== wantAssignable) {
      errors.push({ rule: 'errorImportStatusKindMismatch' });
    }
  }

  // --- 9. branchId requirement ---
  let branchId = strOr(rawRow.branchId);
  if (kind === ASSIGNMENT_KINDS.WAREHOUSE || kind === ASSIGNMENT_KINDS.BRANCH) {
    if (!branchId) {
      errors.push({ rule: 'errorImportBranchIdRequired' });
    } else if (!resolveBranchById(branchId, ctx)) {
      errors.push({ rule: 'errorImportBranchUnknown' });
    }
  } else {
    branchId = '';
  }

  // --- 10. purchaseDate ---
  const rawDate = rawRow.purchaseDate;
  let purchaseDate = null;
  if (rawDate !== '' && rawDate != null) {
    const parsed = parseDateCell(rawDate);
    if (!parsed) errors.push({ rule: 'errorImportPurchaseDate' });
    else purchaseDate = parsed;
  }

  // --- 11. purchasePrice ---
  let purchasePrice = null;
  if (rawRow.purchasePrice !== '' && rawRow.purchasePrice != null) {
    const n = asNumber(rawRow.purchasePrice);
    if (n == null || n < 0) errors.push({ rule: 'errorImportPurchasePrice' });
    else purchasePrice = n;
  }

  // --- aggregate ---
  if (errors.length > 0) {
    return { status: 'red', errors, warnings, normalized: null };
  }

  // Build a normalized AssetInput consumable by `firestoreAssetRepository.create`.
  const normalized = {
    categoryId: cat.categoryId,
    name,
    brand: strOr(rawRow.brand) || null,
    model: strOr(rawRow.model) || null,
    serialNumber: strOr(rawRow.serialNumber) || null,
    statusId,
    assignedTo:
      kind === ASSIGNMENT_KINDS.WAREHOUSE
        ? { kind, id: null }
        : { kind, id: assignedToId },
    branchId: branchId || null,
    notes: strOr(rawRow.notes) || null,
    purchaseDate,
    purchasePrice,
    isActive: true,
  };

  return {
    status: warnings.length > 0 ? 'yellow' : 'green',
    errors: [],
    warnings,
    normalized,
  };
}

// ----- failure report -------------------------------------------------------

/**
 * Build a workbook with one "Failures" sheet listing each failed row's
 * 1-based index, joined error rules, and original raw payload (JSON).
 *
 * @param {Array<{ rowIndex: number, raw: object, errors: Array<{ rule: string }> }>} failures
 */
export function buildFailureReport(failures) {
  const aoa = [
    ['rowIndex', 'reasons', 'raw'],
    ...failures.map((f) => [
      f.rowIndex,
      (f.errors ?? []).map((e) => e.rule).join('; '),
      JSON.stringify(f.raw ?? {}),
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Failures');
  return wb;
}
