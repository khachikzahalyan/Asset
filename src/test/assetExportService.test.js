import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  rowsToWorkbook,
  workbookToBlob,
  downloadFilename,
  buildExportSheetName,
} from '@/lib/excel/assetExportService.js';
import { COLUMN_KEYS } from '@/lib/excel/columns.js';

const ctx = {
  categoriesById: new Map([
    ['cat_device', { categoryId: 'cat_device', name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' }, requiresMultilang: false, inventoryCodePrefix: '400' }],
    ['cat_furniture', { categoryId: 'cat_furniture', name: { ru: 'Мебель', en: 'Furniture', hy: 'Կահույք' }, requiresMultilang: true, inventoryCodePrefix: '450' }],
  ]),
  statusesById: new Map([
    ['warehouse', { statusId: 'warehouse', name: { ru: 'Склад', en: 'Warehouse', hy: 'Պահեստ' }, isAssignable: false }],
    ['assigned', { statusId: 'assigned', name: { ru: 'Выдан', en: 'Assigned', hy: 'Տրված' }, isAssignable: true }],
  ]),
  branchesById: new Map([
    ['b_main', { branchId: 'b_main', name: { ru: 'Главный', en: 'HQ', hy: 'Գլխավոր' } }],
  ]),
  employeesById: new Map([
    ['e1', { employeeId: 'e1', firstName: 'John', lastName: 'Doe', email: 'j@x.com' }],
  ]),
  locale: 'ru',
};

const SAMPLE_ASSETS = [
  {
    assetId: 'a1',
    inventoryCode: '400/1',
    categoryId: 'cat_device',
    statusId: 'warehouse',
    name: 'ThinkPad T14',
    brand: 'Lenovo',
    model: 'T14',
    serialNumber: 'SN1',
    branchId: 'b_main',
    assignedTo: { kind: 'warehouse', id: null },
    notes: null,
    purchaseDate: { toDate: () => new Date('2024-06-01T00:00:00Z') },
    purchasePrice: 150000,
    createdAt: { toDate: () => new Date('2024-06-02T10:00:00Z') },
  },
  {
    assetId: 'a2',
    inventoryCode: '450/1',
    categoryId: 'cat_furniture',
    statusId: 'assigned',
    name: { ru: 'Стул офисный', en: 'Office chair', hy: 'Աթոռ' },
    brand: null,
    model: null,
    serialNumber: null,
    branchId: null,
    assignedTo: { kind: 'employee', id: 'e1' },
    notes: 'broken caster',
    purchaseDate: null,
    purchasePrice: null,
    createdAt: { toDate: () => new Date('2024-07-01T00:00:00Z') },
  },
];

function readSheet(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
}

describe('assetExportService', () => {
  it('writes header row 1 = COLUMN_KEYS in declared order', () => {
    const wb = rowsToWorkbook([], ctx);
    const aoa = readSheet(wb);
    expect(aoa[0]).toEqual([...COLUMN_KEYS]);
  });

  it('writes a localized header row 2 (info only)', () => {
    const wb = rowsToWorkbook([], ctx);
    const aoa = readSheet(wb);
    expect(aoa[1]).toBeDefined();
    expect(aoa[1].length).toBe(COLUMN_KEYS.length);
  });

  it('round-trips a single-lang asset name into Name (RU) only with EN/HY mirrored', () => {
    const wb = rowsToWorkbook([SAMPLE_ASSETS[0]], ctx);
    const aoa = readSheet(wb);
    const dataRow = aoa[2];
    const idx = (k) => COLUMN_KEYS.indexOf(k);
    expect(dataRow[idx('inventoryCode')]).toBe('400/1');
    expect(dataRow[idx('nameRu')]).toBe('ThinkPad T14');
    expect(dataRow[idx('nameEn')]).toBe('ThinkPad T14');
    expect(dataRow[idx('nameHy')]).toBe('ThinkPad T14');
    expect(dataRow[idx('brand')]).toBe('Lenovo');
    expect(dataRow[idx('assignedToKind')]).toBe('warehouse');
    expect(dataRow[idx('branchId')]).toBe('b_main');
  });

  it('writes the locale map fields for a multi-lang asset', () => {
    const wb = rowsToWorkbook([SAMPLE_ASSETS[1]], ctx);
    const aoa = readSheet(wb);
    const dataRow = aoa[2];
    const idx = (k) => COLUMN_KEYS.indexOf(k);
    expect(dataRow[idx('nameRu')]).toBe('Стул офисный');
    expect(dataRow[idx('nameEn')]).toBe('Office chair');
    expect(dataRow[idx('nameHy')]).toBe('Աթոռ');
  });

  it('serializes purchaseDate and createdAt as ISO yyyy-mm-dd strings', () => {
    const wb = rowsToWorkbook([SAMPLE_ASSETS[0]], ctx);
    const aoa = readSheet(wb);
    const idx = (k) => COLUMN_KEYS.indexOf(k);
    expect(aoa[2][idx('purchaseDate')]).toBe('2024-06-01');
    expect(aoa[2][idx('createdAt')]).toBe('2024-06-02');
  });

  it('handles null timestamps with empty string', () => {
    const wb = rowsToWorkbook([SAMPLE_ASSETS[1]], ctx);
    const aoa = readSheet(wb);
    const idx = (k) => COLUMN_KEYS.indexOf(k);
    expect(aoa[2][idx('purchaseDate')]).toBe('');
  });

  it('resolves holderName by kind in the requested locale', () => {
    const wb = rowsToWorkbook(SAMPLE_ASSETS, ctx);
    const aoa = readSheet(wb);
    const idx = (k) => COLUMN_KEYS.indexOf(k);
    // Row 0 (a1) — warehouse mode: holderName = branch name resolved.
    expect(aoa[2][idx('holderName')]).toContain('Главный');
    // Row 1 (a2) — employee mode: contains last name "Doe".
    expect(aoa[3][idx('holderName')]).toContain('Doe');
  });

  it('downloadFilename formats UTC date', () => {
    expect(downloadFilename(new Date('2026-05-07T03:00:00Z'))).toBe('assets_export_2026-05-07.xlsx');
  });

  it('buildExportSheetName returns "Assets"', () => {
    expect(buildExportSheetName()).toBe('Assets');
  });

  it('workbookToBlob returns a Blob with XLSX MIME', () => {
    const wb = rowsToWorkbook([], ctx);
    const blob = workbookToBlob(wb);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toContain('spreadsheet');
  });
});
