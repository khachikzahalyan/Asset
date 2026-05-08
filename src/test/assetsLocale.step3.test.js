import { describe, it, expect } from 'vitest';
import ru from '@/locales/ru/assets.json';
import en from '@/locales/en/assets.json';
import hy from '@/locales/hy/assets.json';

const STEP3_KEYS = [
  'importDialogTitle',
  'downloadTemplate',
  'uploadHint',
  'previewHeading',
  'countGreen',
  'countYellow',
  'countRed',
  'filterAll',
  'filterGreen',
  'filterYellow',
  'filterRed',
  'back',
  'proceed',
  'importInProgress',
  'importDoneSuccess',
  'downloadFailureReport',
  'close',
  'errorImportCategoryRequired',
  'errorImportNameRequired',
  'errorImportAssignedKindRequired',
  'errorImportEmployeeUnknown',
  'errorImportBranchUnknown',
  'errorImportDepartmentRequired',
  'errorImportAsciiOnly',
  'errorImportStatusKindMismatch',
  'errorImportBranchIdRequired',
  'errorImportPurchaseDate',
  'errorImportPurchasePrice',
  'errorImportInventoryCodeConflict',
  'errorImportTooManyRows',
  'errorImportEmptyFile',
  'errorImportRepositoryFailed',
  'warnImportNamePartialLocales',
  'warnImportWarehouseIdIgnored',
  'warnImportStatusFallback',
  'categoryIdHeader',
  'categoryNameHeader',
  'nameRuHeader',
  'nameEnHeader',
  'nameHyHeader',
  'statusIdHeader',
  'assignedToKindHeader',
  'assignedToIdHeader',
  'holderNameHeader',
  'branchIdHeader',
  'createdAtHeader',
];

describe('assets locale Step-3 keys', () => {
  for (const k of STEP3_KEYS) {
    it(`ru.${k} non-empty`, () => {
      expect(typeof ru[k]).toBe('string');
      expect(ru[k]).not.toBe('');
    });
    it(`en.${k} non-empty`, () => {
      expect(typeof en[k]).toBe('string');
      expect(en[k]).not.toBe('');
    });
    it(`hy.${k} non-empty`, () => {
      expect(typeof hy[k]).toBe('string');
      expect(hy[k]).not.toBe('');
    });
  }
});

// Wave-A: subtype + condition + warranty + asset-kind + license-device-only.
const WAVE_A_KEYS = [
  'subtype',
  'subtypePlaceholder',
  'subtypeIdHeader',
  'condition',
  'conditionNew',
  'conditionUsed',
  'warrantyPeriod',
  'warrantyStart',
  'warrantyEnd',
  'warrantyHint',
  'warrantyBanner',
  'warrantyRemainingDays',
  'warrantyExpired',
  'holderAsset',
  'holderShortAsset',
  'assetTargetPlaceholder',
  'licenseDeviceOnlyHint',
  'errorWarrantyEndBeforeStart',
  'errorLicenseDeviceOnly',
  'errorAssetTargetNotLicense',
  'errorAttachableOnlyForLicense',
  'errorImportSubtypeRequired',
  'errorImportSubtypeUnknown',
  'errorImportConditionInvalid',
  'errorImportWarrantyDate',
  'errorImportLicenseDeviceOnly',
];

describe('locale parity — subtype, condition, warranty, asset-kind (Wave A)', () => {
  for (const k of WAVE_A_KEYS) {
    it(`'${k}' is present in ru`, () => {
      expect(typeof ru[k]).toBe('string');
      expect(ru[k]).not.toBe('');
    });
    it(`'${k}' is present in en`, () => {
      expect(typeof en[k]).toBe('string');
      expect(en[k]).not.toBe('');
    });
    it(`'${k}' is present in hy`, () => {
      expect(typeof hy[k]).toBe('string');
      expect(hy[k]).not.toBe('');
    });
  }
});
