/**
 * Canonical column contract for the Asset Excel Import/Export pipeline.
 *
 * Order matters: this is row 1 of every workbook the system writes, and the
 * machine-readable header keys downstream parsers look up by name. Locale
 * labels (row 2) are info-only and resolved by the UI via i18next.
 */

export const COLUMN_KEYS = Object.freeze([
  'inventoryCode',
  'categoryId',
  'categoryName',
  'nameRu',
  'nameEn',
  'nameHy',
  'brand',
  'model',
  'serialNumber',
  'statusId',
  'assignedToKind',
  'assignedToId',
  'holderName',
  'branchId',
  'notes',
  'purchaseDate',
  'purchasePrice',
  'createdAt',
]);

/**
 * Headers that are written by the export but ignored by the import. The user
 * can edit these cells freely without affecting anything — the importer
 * either generates them (inventoryCode, createdAt) or resolves them from
 * other columns (holderName).
 */
export const INFO_ONLY_HEADERS = Object.freeze([
  'inventoryCode',
  'holderName',
  'createdAt',
]);

/**
 * Map a column key to its i18n key in the `assets` namespace. Most map to
 * an existing field label (brand, model, etc); a few specialized ones get
 * dedicated `*Header` keys so the workbook's row-2 reads cleanly.
 */
export const COLUMN_LABEL_KEYS = Object.freeze({
  inventoryCode: 'inventoryCode',
  categoryId: 'categoryIdHeader',
  categoryName: 'categoryNameHeader',
  nameRu: 'nameRuHeader',
  nameEn: 'nameEnHeader',
  nameHy: 'nameHyHeader',
  brand: 'brand',
  model: 'model',
  serialNumber: 'serialNumber',
  statusId: 'statusIdHeader',
  assignedToKind: 'assignedToKindHeader',
  assignedToId: 'assignedToIdHeader',
  holderName: 'holderNameHeader',
  branchId: 'branchIdHeader',
  notes: 'notes',
  purchaseDate: 'purchaseDate',
  purchasePrice: 'purchasePrice',
  createdAt: 'createdAtHeader',
});
