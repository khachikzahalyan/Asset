// src/locales/locales.parity.test.js
import { describe, it, expect } from 'vitest';
import ruBrands from './ru/brands.json';
import enBrands from './en/brands.json';
import hyBrands from './hy/brands.json';
import ruModels from './ru/models.json';
import enModels from './en/models.json';
import hyModels from './hy/models.json';
import ruLicenses from './ru/licenses.json';
import enLicenses from './en/licenses.json';
import hyLicenses from './hy/licenses.json';
import ruAssets from './ru/assets.json';
import enAssets from './en/assets.json';
import hyAssets from './hy/assets.json';
import ruCategories from './ru/categories.json';
import enCategories from './en/categories.json';
import hyCategories from './hy/categories.json';
import ruSettings from './ru/settings.json';
import enSettings from './en/settings.json';
import hySettings from './hy/settings.json';
import ruCommon from './ru/common.json';
import enCommon from './en/common.json';
import hyCommon from './hy/common.json';

function flatKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? flatKeys(v, prefix + k + '.')
      : [prefix + k],
  );
}

function expectParity(name, ru, en, hy) {
  const ruKeys = flatKeys(ru).sort();
  const enKeys = flatKeys(en).sort();
  const hyKeys = flatKeys(hy).sort();
  expect(enKeys, `${name}: en missing keys`).toEqual(ruKeys);
  expect(hyKeys, `${name}: hy missing keys`).toEqual(ruKeys);
}

describe('locale parity (ru / en / hy)', () => {
  it('brands.json keys are in sync', () => {
    expectParity('brands', ruBrands, enBrands, hyBrands);
  });
  it('models.json keys are in sync', () => {
    expectParity('models', ruModels, enModels, hyModels);
  });
  it('licenses.json keys are in sync', () => {
    expectParity('licenses', ruLicenses, enLicenses, hyLicenses);
  });
  it('assets.json keys are in sync', () => {
    expectParity('assets', ruAssets, enAssets, hyAssets);
  });
  it('categories.json keys are in sync', () => {
    expectParity('categories', ruCategories, enCategories, hyCategories);
  });
  it('settings.json keys are in sync', () => {
    expectParity('settings', ruSettings, enSettings, hySettings);
  });
  it('common.json keys are in sync', () => {
    expectParity('common', ruCommon, enCommon, hyCommon);
  });
});

describe('locale required keys', () => {
  it('brands.json defines title, addBrand, columnName', () => {
    for (const [name, file] of [['ru', ruBrands], ['en', enBrands], ['hy', hyBrands]]) {
      expect(file.title, `${name}/brands.title`).toBeTruthy();
      expect(file.addBrand, `${name}/brands.addBrand`).toBeTruthy();
      expect(file.columnName, `${name}/brands.columnName`).toBeTruthy();
    }
  });
  it('models.json defines title, addModel, brandColumn', () => {
    for (const [name, file] of [['ru', ruModels], ['en', enModels], ['hy', hyModels]]) {
      expect(file.title, `${name}/models.title`).toBeTruthy();
      expect(file.addModel, `${name}/models.addModel`).toBeTruthy();
      expect(file.brandColumn, `${name}/models.brandColumn`).toBeTruthy();
    }
  });
  it('licenses.json defines key UI strings', () => {
    for (const [name, file] of [['ru', ruLicenses], ['en', enLicenses], ['hy', hyLicenses]]) {
      expect(file.licenseType, `${name}/licenses.licenseType`).toBeTruthy();
      expect(file.licenseTypePersonal, `${name}/licenses.licenseTypePersonal`).toBeTruthy();
      expect(file.licenseTypeBusiness, `${name}/licenses.licenseTypeBusiness`).toBeTruthy();
      expect(file.licenseTypeEnterprise, `${name}/licenses.licenseTypeEnterprise`).toBeTruthy();
      expect(file.subscribedAt, `${name}/licenses.subscribedAt`).toBeTruthy();
      expect(file.expiresAt, `${name}/licenses.expiresAt`).toBeTruthy();
      expect(file.licenseKey, `${name}/licenses.licenseKey`).toBeTruthy();
      expect(file.licenseKeyMasked, `${name}/licenses.licenseKeyMasked`).toBeTruthy();
      expect(file.licenseKeyShow, `${name}/licenses.licenseKeyShow`).toBeTruthy();
      expect(file.licenseKeyHide, `${name}/licenses.licenseKeyHide`).toBeTruthy();
      expect(file.licenseKeyCopy, `${name}/licenses.licenseKeyCopy`).toBeTruthy();
      expect(file.licenseKeySetTrue, `${name}/licenses.licenseKeySetTrue`).toBeTruthy();
      expect(file.licenseKeySetFalse, `${name}/licenses.licenseKeySetFalse`).toBeTruthy();
      expect(file.manageKey, `${name}/licenses.manageKey`).toBeTruthy();
      expect(file.expiryBadgeSoon, `${name}/licenses.expiryBadgeSoon`).toBeTruthy();
      expect(file.expiryBadgePast, `${name}/licenses.expiryBadgePast`).toBeTruthy();
      expect(file.errorExpiresBeforeSubscribed, `${name}/licenses.errorExpiresBeforeSubscribed`).toBeTruthy();
    }
  });
  it('assets.json defines new redesign keys', () => {
    for (const [name, file] of [['ru', ruAssets], ['en', enAssets], ['hy', hyAssets]]) {
      expect(file.groupWhatIsIt, `${name}/assets.groupWhatIsIt`).toBeTruthy();
      expect(file.groupIdentifiers, `${name}/assets.groupIdentifiers`).toBeTruthy();
      expect(file.groupWhereIsIt, `${name}/assets.groupWhereIsIt`).toBeTruthy();
      expect(file.groupMoneyWarranty, `${name}/assets.groupMoneyWarranty`).toBeTruthy();
      expect(file.groupNotes, `${name}/assets.groupNotes`).toBeTruthy();
      expect(file.groupLicense, `${name}/assets.groupLicense`).toBeTruthy();
      expect(file.brandLabel, `${name}/assets.brandLabel`).toBeTruthy();
      expect(file.modelLabel, `${name}/assets.modelLabel`).toBeTruthy();
      expect(file.brandPlaceholder, `${name}/assets.brandPlaceholder`).toBeTruthy();
      expect(file.modelPlaceholder, `${name}/assets.modelPlaceholder`).toBeTruthy();
      expect(file.modelDisabledNoBrand, `${name}/assets.modelDisabledNoBrand`).toBeTruthy();
      expect(file.previewTitle, `${name}/assets.previewTitle`).toBeTruthy();
      expect(file.previewBackButton, `${name}/assets.previewBackButton`).toBeTruthy();
      expect(file.previewCreateButton, `${name}/assets.previewCreateButton`).toBeTruthy();
      expect(file.nextButton, `${name}/assets.nextButton`).toBeTruthy();
      expect(file.errorBrandRequired, `${name}/assets.errorBrandRequired`).toBeTruthy();
      expect(file.errorModelRequired, `${name}/assets.errorModelRequired`).toBeTruthy();
      expect(file.errorModelBrandMismatch, `${name}/assets.errorModelBrandMismatch`).toBeTruthy();
      expect(file.saveAndAddAnother, `${name}/assets.saveAndAddAnother`).toBeTruthy();
      expect(file.saveAndAddAnotherWithCount, `${name}/assets.saveAndAddAnotherWithCount`).toBeTruthy();
    }
  });
  it('categories.json defines assignsInventoryCode label', () => {
    for (const [name, file] of [['ru', ruCategories], ['en', enCategories], ['hy', hyCategories]]) {
      expect(file.assignsInventoryCodeLabel, `${name}/categories.assignsInventoryCodeLabel`).toBeTruthy();
      expect(file.assignsInventoryCodeHint, `${name}/categories.assignsInventoryCodeHint`).toBeTruthy();
    }
  });
  it('settings.json defines notification settings keys', () => {
    for (const [name, file] of [['ru', ruSettings], ['en', enSettings], ['hy', hySettings]]) {
      expect(file.notificationSettingsTitle, `${name}/settings.notificationSettingsTitle`).toBeTruthy();
      expect(file.licenseExpiryWarningDaysLabel, `${name}/settings.licenseExpiryWarningDaysLabel`).toBeTruthy();
      expect(file.licenseExpiryWarningDaysHint, `${name}/settings.licenseExpiryWarningDaysHint`).toBeTruthy();
      expect(file.errorRangeOneToThreeSixtyFive, `${name}/settings.errorRangeOneToThreeSixtyFive`).toBeTruthy();
      expect(file.saveButton, `${name}/settings.saveButton`).toBeTruthy();
    }
  });
  it('common.json defines new nav keys', () => {
    for (const [name, file] of [['ru', ruCommon], ['en', enCommon], ['hy', hyCommon]]) {
      expect(file.navBrands, `${name}/common.navBrands`).toBeTruthy();
      expect(file.navModels, `${name}/common.navModels`).toBeTruthy();
      expect(file.navNotificationSettings, `${name}/common.navNotificationSettings`).toBeTruthy();
    }
  });
});
