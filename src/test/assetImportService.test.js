import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  workbookFromArrayBuffer,
  workbookToRows,
  validateRow,
  buildFailureReport,
} from '@/lib/excel/assetImportService.js';
import { rowsToWorkbook } from '@/lib/excel/assetExportService.js';

const CATEGORIES = [
  { categoryId: 'cat_device', name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' }, requiresMultilang: false, inventoryCodePrefix: '400', isActive: true },
  { categoryId: 'cat_furniture', name: { ru: 'Мебель', en: 'Furniture', hy: 'Կահույք' }, requiresMultilang: true, inventoryCodePrefix: '450', isActive: true },
];
const STATUSES = [
  { statusId: 'warehouse', name: { ru: 'Склад', en: 'Warehouse', hy: 'Պահեստ' }, isAssignable: false, isActive: true },
  { statusId: 'assigned',  name: { ru: 'Выдан',  en: 'Assigned',  hy: 'Տրված' },  isAssignable: true,  isActive: true },
];
const BRANCHES = [
  { branchId: 'b_main', name: { ru: 'HQ', en: 'HQ', hy: 'HQ' }, isActive: true },
];
const EMPLOYEES = [
  { employeeId: 'e1', firstName: 'John', lastName: 'Doe', email: 'j@x.com', isActive: true },
];

const ctx = {
  categories: CATEGORIES, statuses: STATUSES, branches: BRANCHES, employees: EMPLOYEES,
  existingInventoryCodes: new Set(['400/99']),
};

function row(overrides = {}) {
  return {
    inventoryCode: '',
    categoryId: 'cat_device',
    categoryName: '',
    nameRu: 'Item', nameEn: '', nameHy: '',
    brand: '', model: '', serialNumber: '',
    statusId: 'warehouse',
    assignedToKind: 'warehouse',
    assignedToId: '',
    holderName: '',
    branchId: 'b_main',
    notes: '',
    purchaseDate: '',
    purchasePrice: '',
    createdAt: '',
    ...overrides,
  };
}

describe('validateRow', () => {
  it('green for a complete warehouse row', () => {
    const r = validateRow(row(), 0, ctx);
    expect(r.status).toBe('green');
    expect(r.normalized).toBeTruthy();
    expect(r.normalized.assignedTo).toEqual({ kind: 'warehouse', id: null });
  });

  it('red when categoryId/categoryName are both missing', () => {
    const r = validateRow(row({ categoryId: '', categoryName: '' }), 0, ctx);
    expect(r.status).toBe('red');
    expect(r.errors.some((e) => e.rule === 'errorImportCategoryRequired')).toBe(true);
  });

  it('resolves category by name when id is missing', () => {
    const r = validateRow(row({ categoryId: '', categoryName: 'Устройство' }), 0, ctx);
    expect(r.status).toBe('green');
    expect(r.normalized.categoryId).toBe('cat_device');
  });

  it('red on Cyrillic brand', () => {
    const r = validateRow(row({ brand: 'Леново' }), 0, ctx);
    expect(r.status).toBe('red');
    expect(r.errors.some((e) => e.rule === 'errorImportAsciiOnly' && e.field === 'brand')).toBe(true);
  });

  it('red when name missing for single-lang category', () => {
    const r = validateRow(row({ nameRu: '', nameEn: '', nameHy: '' }), 0, ctx);
    expect(r.status).toBe('red');
    expect(r.errors.some((e) => e.rule === 'errorImportNameRequired')).toBe(true);
  });

  it('green or yellow when at least one locale filled for multi-lang category', () => {
    const r = validateRow(
      row({ categoryId: 'cat_furniture', nameRu: '', nameEn: 'Chair', nameHy: '' }),
      0,
      ctx
    );
    expect(r.status === 'green' || r.status === 'yellow').toBe(true);
    if (r.status === 'yellow') {
      expect(r.warnings.some((w) => w.rule === 'warnImportNamePartialLocales')).toBe(true);
    }
  });

  it('red when assignedToKind missing', () => {
    const r = validateRow(row({ assignedToKind: '' }), 0, ctx);
    expect(r.status).toBe('red');
    expect(r.errors.some((e) => e.rule === 'errorImportAssignedKindRequired')).toBe(true);
  });

  it('red when employee id unknown', () => {
    const r = validateRow(
      row({ assignedToKind: 'employee', assignedToId: 'eX', branchId: '', statusId: 'assigned' }),
      0,
      ctx
    );
    expect(r.status).toBe('red');
    expect(r.errors.some((e) => e.rule === 'errorImportEmployeeUnknown')).toBe(true);
  });

  it('green for employee mode with valid id and assignable status', () => {
    const r = validateRow(
      row({ assignedToKind: 'employee', assignedToId: 'e1', branchId: '', statusId: 'assigned' }),
      0,
      ctx
    );
    expect(r.status).toBe('green');
    expect(r.normalized.assignedTo).toEqual({ kind: 'employee', id: 'e1' });
    expect(r.normalized.branchId).toBe(null);
  });

  it('red when status incompatible with kind (warehouse + assigned)', () => {
    const r = validateRow(row({ statusId: 'assigned' }), 0, ctx);
    expect(r.status).toBe('red');
    expect(r.errors.some((e) => e.rule === 'errorImportStatusKindMismatch')).toBe(true);
  });

  it('red when branch unknown for warehouse mode', () => {
    const r = validateRow(row({ branchId: 'bZ' }), 0, ctx);
    expect(r.status).toBe('red');
    expect(r.errors.some((e) => e.rule === 'errorImportBranchUnknown')).toBe(true);
  });

  it('red when branchId missing for branch mode', () => {
    const r = validateRow(
      row({ assignedToKind: 'branch', assignedToId: 'b_main', branchId: '', statusId: 'assigned' }),
      0,
      ctx
    );
    expect(r.status).toBe('red');
    expect(r.errors.some((e) => e.rule === 'errorImportBranchIdRequired')).toBe(true);
  });

  it('red on unparseable purchaseDate', () => {
    const r = validateRow(row({ purchaseDate: 'yesterday' }), 0, ctx);
    expect(r.status).toBe('red');
    expect(r.errors.some((e) => e.rule === 'errorImportPurchaseDate')).toBe(true);
  });

  it('parses ISO date and Excel-serial date', () => {
    const iso = validateRow(row({ purchaseDate: '2024-06-01' }), 0, ctx);
    expect(iso.status).toBe('green');
    expect(iso.normalized.purchaseDate).toBeInstanceOf(Date);
    // Excel serial 45444 = 2024-06-01.
    const ser = validateRow(row({ purchaseDate: 45444 }), 0, ctx);
    expect(ser.status).toBe('green');
    expect(ser.normalized.purchaseDate).toBeInstanceOf(Date);
  });

  it('red on negative purchasePrice', () => {
    const r = validateRow(row({ purchasePrice: -10 }), 0, ctx);
    expect(r.status).toBe('red');
    expect(r.errors.some((e) => e.rule === 'errorImportPurchasePrice')).toBe(true);
  });

  it('red on inventory-code conflict', () => {
    const r = validateRow(row({ inventoryCode: '400/99' }), 0, ctx);
    expect(r.status).toBe('red');
    expect(r.errors.some((e) => e.rule === 'errorImportInventoryCodeConflict')).toBe(true);
  });

  it('yellow when status missing — falls back to default', () => {
    const r = validateRow(row({ statusId: '' }), 0, ctx);
    expect(r.status).toBe('yellow');
    expect(r.warnings.some((w) => w.rule === 'warnImportStatusFallback')).toBe(true);
    expect(r.normalized.statusId).toBe('warehouse');
  });

  it('yellow when warehouse mode carries an assignedToId — drops the id', () => {
    const r = validateRow(row({ assignedToId: 'should-be-ignored' }), 0, ctx);
    expect(r.status).toBe('yellow');
    expect(r.warnings.some((w) => w.rule === 'warnImportWarehouseIdIgnored')).toBe(true);
    expect(r.normalized.assignedTo).toEqual({ kind: 'warehouse', id: null });
  });
});

describe('round-trip export → import → equal rows', () => {
  it('export a single-lang asset, parse the same file, recover the same fields', () => {
    const SAMPLE = [{
      assetId: 'a1', inventoryCode: '400/1', categoryId: 'cat_device', statusId: 'warehouse',
      name: 'ThinkPad', brand: 'Lenovo', model: 'T14', serialNumber: 'SN1',
      branchId: 'b_main', assignedTo: { kind: 'warehouse', id: null },
      notes: null, purchaseDate: { toDate: () => new Date('2024-06-01T00:00:00Z') },
      purchasePrice: 100, createdAt: { toDate: () => new Date('2024-06-02T00:00:00Z') },
    }];
    const wb = rowsToWorkbook(SAMPLE, {
      categoriesById: new Map(CATEGORIES.map((c) => [c.categoryId, c])),
      statusesById: new Map(STATUSES.map((s) => [s.statusId, s])),
      branchesById: new Map(BRANCHES.map((b) => [b.branchId, b])),
      employeesById: new Map(EMPLOYEES.map((e) => [e.employeeId, e])),
      locale: 'ru',
    });
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const wb2 = XLSX.read(buf, { type: 'array' });
    const { rows } = workbookToRows(wb2);
    expect(rows).toHaveLength(1);
    // Conflict expected on inventoryCode round-trip — exclude it from existing-codes set.
    const r = validateRow(rows[0], 0, { ...ctx, existingInventoryCodes: new Set() });
    expect(r.status).toBe('green');
    expect(r.normalized.brand).toBe('Lenovo');
    expect(r.normalized.assignedTo).toEqual({ kind: 'warehouse', id: null });
  });
});

describe('workbookToRows', () => {
  it('reads the second-row label band as labels and treats row 3+ as data', () => {
    const wb = XLSX.utils.book_new();
    const aoa = [
      ['inventoryCode', 'categoryId', 'nameRu', 'assignedToKind', 'branchId', 'statusId', 'assignedToId', 'holderName', 'createdAt', 'purchaseDate', 'purchasePrice', 'brand', 'model', 'serialNumber', 'notes', 'categoryName', 'nameEn', 'nameHy'],
      ['inv', 'cat', 'name', 'kind', 'branch', 'status', 'aid', 'hname', 'cat', 'pdate', 'price', 'br', 'md', 'sn', 'nt', 'cn', 'en', 'hy'],
      ['', 'cat_device', 'X', 'warehouse', 'b_main', 'warehouse', '', '', '', '', '', '', '', '', '', '', '', ''],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, 'Assets');
    const { rows } = workbookToRows(wb);
    expect(rows).toHaveLength(1);
    expect(rows[0].nameRu).toBe('X');
  });
});

describe('workbookFromArrayBuffer', () => {
  it('parses an array buffer round-tripped from a written workbook', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['inventoryCode'], ['']]),
      'Assets'
    );
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const wb2 = await workbookFromArrayBuffer(buf);
    expect(wb2.SheetNames).toContain('Assets');
  });
});

describe('buildFailureReport', () => {
  it('produces a workbook with a row per failure including reasons', () => {
    const failures = [
      { rowIndex: 5, raw: { inventoryCode: '', nameRu: 'Item' }, errors: [{ rule: 'errorImportCategoryRequired' }] },
    ];
    const wb = buildFailureReport(failures);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    expect(aoa[0]).toEqual(['rowIndex', 'reasons', 'raw']);
    expect(aoa[1][0]).toBe(5);
    expect(String(aoa[1][1])).toContain('errorImportCategoryRequired');
  });
});
