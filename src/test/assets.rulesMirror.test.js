/**
 * Rules-permission mirror tests for `/assets/{assetId}`.
 *
 * Mirrors the role/shape gating in `firestore.rules` (Wave-1 Step 2) as
 * plain JavaScript predicates and verifies every admission case for the
 * asset registry.
 *
 * Why a mirror instead of the real emulator: the dev workstation has no
 * Java runtime, so the Firestore emulator suite is unavailable. This is
 * the same pattern `categories.rulesMirror.test.js` and
 * `employees.rulesMirror.test.js` use; they will be superseded by
 * emulator-based suites once a JRE is available, but the mirror MUST
 * stay byte-aligned with `firestore.rules` until then. Every change to
 * the `/assets/{assetId}` block in firestore.rules MUST be reflected
 * here.
 */

import { describe, it, expect } from 'vitest';

const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ASSET_ADMIN: 'asset_admin',
  TECH_ADMIN: 'tech_admin',
  EMPLOYEE: 'employee',
};

const isSignedIn = (auth) => auth != null;
const isSuperAdmin = (auth, users) =>
  isSignedIn(auth) && users[auth.uid]?.role === ROLES.SUPER_ADMIN;
const isAssetAdmin = (auth, users) =>
  isSignedIn(auth) && users[auth.uid]?.role === ROLES.ASSET_ADMIN;
const isTechAdmin = (auth, users) =>
  isSignedIn(auth) && users[auth.uid]?.role === ROLES.TECH_ADMIN;
const isAdmin = (auth, users) =>
  isSuperAdmin(auth, users) || isAssetAdmin(auth, users) || isTechAdmin(auth, users);

// ---- Helpers (mirror of firestore.rules functions) ----------------------

const INVENTORY_CODE_RE = /^[A-Z0-9]+\/[0-9]+$/;
function isValidInventoryCode(c) {
  return typeof c === 'string' && INVENTORY_CODE_RE.test(c);
}

function isValidAssignedTo(a) {
  if (!a || typeof a !== 'object') return false;
  const keys = Object.keys(a);
  // hasOnly(['kind', 'id']) — every key must be one of these two.
  if (keys.some((k) => k !== 'kind' && k !== 'id')) return false;
  if (a.kind === 'warehouse') {
    return a.id === null;
  }
  if (
    a.kind === 'employee'
    || a.kind === 'branch'
    || a.kind === 'department'
    || a.kind === 'asset'
  ) {
    return typeof a.id === 'string' && a.id.length > 0;
  }
  return false;
}

// Mirror of `is timestamp` in Firestore rules. In our mirror we treat
// either a Date instance or an opaque "TIMESTAMP_*" sentinel string as
// a valid timestamp for predicate purposes.
function isTimestampOrNull(v) {
  if (v === null) return true;
  if (v instanceof Date) return true;
  if (typeof v === 'string' && v.startsWith('TIMESTAMP_')) return true;
  return false;
}

function mockTimestamp(d) {
  return `TIMESTAMP_${d.toISOString()}`;
}

function isValidAssetName(n) {
  if (typeof n === 'string') return true;
  if (!n || typeof n !== 'object') return false;
  const keys = Object.keys(n);
  const allowed = ['ru', 'en', 'hy'];
  if (keys.some((k) => !allowed.includes(k))) return false;
  if (typeof n.ru !== 'string') return false;
  if (typeof n.en !== 'string') return false;
  if (typeof n.hy !== 'string') return false;
  return true;
}

const ASCII_RE = /^[\x20-\x7e]*$/;
function isAsciiOrNull(s) {
  if (s === null || s === undefined) return s === null;
  return typeof s === 'string' && ASCII_RE.test(s);
}

// ---- /assets/{assetId} ---------------------------------------------------

function canReadAsset({ auth, users }) {
  return isAdmin(auth, users);
}

function canCreateAsset({ auth, users, requestData, requestTime }) {
  if (!(isSuperAdmin(auth, users) || isAssetAdmin(auth, users))) return false;
  if (typeof requestData.categoryId !== 'string' || requestData.categoryId.length === 0) return false;
  if (typeof requestData.statusId !== 'string' || requestData.statusId.length === 0) return false;
  if (!isValidInventoryCode(requestData.inventoryCode)) return false;
  if (!isValidAssetName(requestData.name)) return false;
  if (!isAsciiOrNull(requestData.brand)) return false;
  if (!isAsciiOrNull(requestData.model)) return false;
  if (!isAsciiOrNull(requestData.serialNumber)) return false;
  // branchId == null OR string
  if (!(requestData.branchId === null || typeof requestData.branchId === 'string')) return false;
  if (!isValidAssignedTo(requestData.assignedTo)) return false;
  if (!(requestData.notes === null || typeof requestData.notes === 'string')) return false;
  if (!(requestData.purchasePrice === null || typeof requestData.purchasePrice === 'number')) return false;
  if (typeof requestData.isActive !== 'boolean') return false;
  // Wave-A new fields (subtype + condition + warranty).
  if (typeof requestData.subtypeId !== 'string' || requestData.subtypeId.length === 0) return false;
  if (requestData.condition !== 'new' && requestData.condition !== 'used') return false;
  if (!isTimestampOrNull(requestData.warrantyStart)) return false;
  if (!isTimestampOrNull(requestData.warrantyEnd)) return false;
  if (requestData.createdBy !== auth.uid) return false;
  if (requestData.updatedBy !== auth.uid) return false;
  if (requestData.createdAt !== requestTime) return false;
  if (requestData.updatedAt !== requestTime) return false;
  return true;
}

function canUpdateAsset({ auth, users, before, requestData, requestTime }) {
  if (!(isSuperAdmin(auth, users) || isAssetAdmin(auth, users))) return false;
  // Immutability invariants.
  if (requestData.categoryId !== before.categoryId) return false;
  if (requestData.inventoryCode !== before.inventoryCode) return false;
  // statusId may change but must stay a non-empty string.
  if (typeof requestData.statusId !== 'string' || requestData.statusId.length === 0) return false;
  if (!isValidAssetName(requestData.name)) return false;
  if (!isAsciiOrNull(requestData.brand)) return false;
  if (!isAsciiOrNull(requestData.model)) return false;
  if (!isAsciiOrNull(requestData.serialNumber)) return false;
  if (!(requestData.branchId === null || typeof requestData.branchId === 'string')) return false;
  if (!isValidAssignedTo(requestData.assignedTo)) return false;
  if (!(requestData.notes === null || typeof requestData.notes === 'string')) return false;
  if (!(requestData.purchasePrice === null || typeof requestData.purchasePrice === 'number')) return false;
  if (typeof requestData.isActive !== 'boolean') return false;
  // Wave-A new fields. subtypeId stays mutable (super_admin can fix a wrong pick)
  // but the same shape guards apply.
  if (typeof requestData.subtypeId !== 'string' || requestData.subtypeId.length === 0) return false;
  if (requestData.condition !== 'new' && requestData.condition !== 'used') return false;
  if (!isTimestampOrNull(requestData.warrantyStart)) return false;
  if (!isTimestampOrNull(requestData.warrantyEnd)) return false;
  if (requestData.createdBy !== before.createdBy) return false;
  if (requestData.createdAt !== before.createdAt) return false;
  if (requestData.updatedBy !== auth.uid) return false;
  if (requestData.updatedAt !== requestTime) return false;
  return true;
}

function canDeleteAsset() {
  return false;
}

// ---- Test fixtures -------------------------------------------------------

const REQ_TIME = 'REQUEST_TIME';
const users = {
  super_uid: { role: ROLES.SUPER_ADMIN },
  asset_uid: { role: ROLES.ASSET_ADMIN },
  tech_uid: { role: ROLES.TECH_ADMIN },
  emp_uid: { role: ROLES.EMPLOYEE },
};

function validAssetCreate(actorUid) {
  return {
    categoryId: 'cat_device',
    inventoryCode: '400/5',
    name: 'ThinkPad',
    brand: 'Lenovo',
    model: 'T14',
    serialNumber: 'ABC123',
    statusId: 'warehouse',
    branchId: 'b_main',
    assignedTo: { kind: 'warehouse', id: null },
    notes: null,
    purchaseDate: null,
    purchasePrice: null,
    isActive: true,
    // Wave-A: subtype + condition + warranty are required on every asset write.
    subtypeId: 'device_laptop',
    condition: 'new',
    warrantyStart: null,
    warrantyEnd: null,
    createdBy: actorUid,
    updatedBy: actorUid,
    createdAt: REQ_TIME,
    updatedAt: REQ_TIME,
  };
}

function existingAssetDoc(creatorUid = 'super_uid') {
  return {
    ...validAssetCreate(creatorUid),
    createdAt: 'OLD_TIME',
    updatedAt: 'OLD_TIME',
  };
}

function asAuth(uid) {
  return uid ? { uid } : null;
}

// -------------------------------------------------------------------------

describe('rules mirror — /assets read', () => {
  it.each([
    ['super_admin', 'super_uid', true],
    ['asset_admin', 'asset_uid', true],
    ['tech_admin', 'tech_uid', true],
    ['employee', 'emp_uid', false],
    ['anonymous', null, false],
  ])('%s read assets -> %s', (_label, uid, expected) => {
    expect(canReadAsset({ auth: asAuth(uid), users })).toBe(expected);
  });
});

describe('rules mirror — /assets create', () => {
  it('super_admin can create with a valid shape', () => {
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: validAssetCreate('super_uid'),
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('asset_admin can create with a valid shape', () => {
    expect(
      canCreateAsset({
        auth: asAuth('asset_uid'),
        users,
        requestData: validAssetCreate('asset_uid'),
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it.each([
    ['tech_admin', 'tech_uid'],
    ['employee', 'emp_uid'],
  ])('%s cannot create', (_label, uid) => {
    expect(
      canCreateAsset({
        auth: asAuth(uid),
        users,
        requestData: validAssetCreate(uid),
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('anonymous cannot create', () => {
    expect(
      canCreateAsset({
        auth: null,
        users,
        requestData: validAssetCreate('anon'),
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects invalid assignedTo with extra keys', () => {
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: {
          ...validAssetCreate('super_uid'),
          assignedTo: { kind: 'warehouse', id: null, extra: 'evil' },
        },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects assignedTo.kind=employee with id=null', () => {
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: {
          ...validAssetCreate('super_uid'),
          assignedTo: { kind: 'employee', id: null },
        },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects assignedTo.kind=warehouse with id set', () => {
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: {
          ...validAssetCreate('super_uid'),
          assignedTo: { kind: 'warehouse', id: 'something' },
        },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects assignedTo with unknown kind', () => {
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: {
          ...validAssetCreate('super_uid'),
          assignedTo: { kind: 'cosmos', id: 'x' },
        },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects non-ASCII brand', () => {
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...validAssetCreate('super_uid'), brand: 'Леново' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects non-ASCII model', () => {
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...validAssetCreate('super_uid'), model: 'Тип14' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects non-ASCII serialNumber', () => {
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...validAssetCreate('super_uid'), serialNumber: 'СН123' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('accepts brand=null (Tier 4 optional)', () => {
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...validAssetCreate('super_uid'), brand: null, model: null, serialNumber: null },
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it.each([
    ['letters in number portion', '450/abc'],
    ['empty number portion', '450/'],
    ['empty prefix', '/123'],
    ['lowercase prefix', 'abc/1'],
    ['no slash', '4501'],
    ['double slash', '450//1'],
  ])('rejects bad inventoryCode shape (%s)', (_label, code) => {
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...validAssetCreate('super_uid'), inventoryCode: code },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('accepts a valid multi-locale name map', () => {
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: {
          ...validAssetCreate('super_uid'),
          name: { ru: 'Стол', en: 'Desk', hy: 'Սեղան' },
        },
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('rejects locale map with extra keys', () => {
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: {
          ...validAssetCreate('super_uid'),
          name: { ru: 'a', en: 'b', hy: 'c', fr: 'd' },
        },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects locale map with non-string entry', () => {
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: {
          ...validAssetCreate('super_uid'),
          name: { ru: 'a', en: 'b', hy: 123 },
        },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects when createdBy != auth.uid (forged actor)', () => {
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...validAssetCreate('asset_uid') },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects empty categoryId', () => {
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...validAssetCreate('super_uid'), categoryId: '' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects empty statusId', () => {
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...validAssetCreate('super_uid'), statusId: '' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects non-boolean isActive', () => {
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...validAssetCreate('super_uid'), isActive: 'yes' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('accepts purchasePrice=null and accepts a number', () => {
    const base = validAssetCreate('super_uid');
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...base, purchasePrice: null },
        requestTime: REQ_TIME,
      })
    ).toBe(true);
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...base, purchasePrice: 1500.50 },
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });
});

describe('rules mirror — /assets update', () => {
  it('asset_admin can update with same-shape payload', () => {
    const before = existingAssetDoc('super_uid');
    const after = {
      ...before,
      brand: 'Dell',
      updatedBy: 'asset_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateAsset({
        auth: asAuth('asset_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('super_admin can update with same-shape payload', () => {
    const before = existingAssetDoc('super_uid');
    const after = {
      ...before,
      notes: 'fixed',
      updatedBy: 'super_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateAsset({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it.each([
    ['tech_admin', 'tech_uid'],
    ['employee', 'emp_uid'],
  ])('%s cannot update', (_label, uid) => {
    const before = existingAssetDoc('super_uid');
    const after = { ...before, updatedBy: uid, updatedAt: REQ_TIME };
    expect(
      canUpdateAsset({
        auth: asAuth(uid),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects update that changes inventoryCode', () => {
    const before = existingAssetDoc('super_uid');
    const after = {
      ...before,
      inventoryCode: '400/999',
      updatedBy: 'super_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateAsset({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects update that changes categoryId', () => {
    const before = existingAssetDoc('super_uid');
    const after = {
      ...before,
      categoryId: 'cat_other',
      updatedBy: 'super_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateAsset({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('allows status change to a non-empty string', () => {
    const before = existingAssetDoc('super_uid');
    const after = {
      ...before,
      statusId: 'assigned',
      updatedBy: 'asset_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateAsset({
        auth: asAuth('asset_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('rejects status change to empty string', () => {
    const before = existingAssetDoc('super_uid');
    const after = {
      ...before,
      statusId: '',
      updatedBy: 'asset_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateAsset({
        auth: asAuth('asset_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects update that changes createdBy', () => {
    const before = existingAssetDoc('super_uid');
    const after = {
      ...before,
      createdBy: 'asset_uid',
      updatedBy: 'super_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateAsset({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects update that changes createdAt', () => {
    const before = existingAssetDoc('super_uid');
    const after = {
      ...before,
      createdAt: 'TAMPERED',
      updatedBy: 'super_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateAsset({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects update with stale updatedAt', () => {
    const before = existingAssetDoc('super_uid');
    const after = { ...before, updatedBy: 'super_uid', updatedAt: 'STALE' };
    expect(
      canUpdateAsset({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects update where updatedBy != auth.uid', () => {
    const before = existingAssetDoc('super_uid');
    const after = { ...before, updatedBy: 'asset_uid', updatedAt: REQ_TIME };
    expect(
      canUpdateAsset({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects update with non-ASCII brand', () => {
    const before = existingAssetDoc('super_uid');
    const after = {
      ...before,
      brand: 'Леново',
      updatedBy: 'super_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateAsset({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects update with invalid assignedTo shape', () => {
    const before = existingAssetDoc('super_uid');
    const after = {
      ...before,
      assignedTo: { kind: 'employee', id: null },
      updatedBy: 'super_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateAsset({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });
});

describe('rules mirror — /assets delete', () => {
  it.each([
    ['super_admin', 'super_uid'],
    ['asset_admin', 'asset_uid'],
    ['tech_admin', 'tech_uid'],
    ['employee', 'emp_uid'],
    ['anonymous', null],
  ])('%s denied', () => {
    expect(canDeleteAsset()).toBe(false);
  });
});

// -------------------------------------------------------------------------
// Wave-A extensions: extended assignedTo + new asset fields.
// Mirrors the shape changes in firestore.rules:
//   - isValidAssignedTo gains an `asset` kind branch.
//   - /assets create + update predicates require subtypeId, condition,
//     warrantyStart, warrantyEnd.
// -------------------------------------------------------------------------
describe('rules mirror — extended assignedTo + new asset fields', () => {
  it('isValidAssignedTo accepts asset kind with non-empty id', () => {
    expect(isValidAssignedTo({ kind: 'asset', id: 'host_device_1' })).toBe(true);
  });

  it('isValidAssignedTo rejects asset kind with empty id', () => {
    expect(isValidAssignedTo({ kind: 'asset', id: '' })).toBe(false);
  });

  it('isValidAssignedTo rejects asset kind with null id', () => {
    expect(isValidAssignedTo({ kind: 'asset', id: null })).toBe(false);
  });

  it('isValidAssignedTo still rejects unknown kind', () => {
    expect(isValidAssignedTo({ kind: 'cosmos', id: 'x' })).toBe(false);
  });

  it('canCreateAsset accepts asset assignedTo (license attached to a device)', () => {
    expect(
      canCreateAsset({
        auth: asAuth('asset_uid'),
        users,
        requestData: {
          ...validAssetCreate('asset_uid'),
          assignedTo: { kind: 'asset', id: 'host_device_1' },
        },
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('canCreateAsset rejects missing subtypeId', () => {
    const data = validAssetCreate('super_uid');
    delete data.subtypeId;
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: data,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('canCreateAsset rejects empty subtypeId', () => {
    expect(
      canCreateAsset({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...validAssetCreate('super_uid'), subtypeId: '' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('canCreateAsset accepts new condition with both warranty timestamps', () => {
    expect(
      canCreateAsset({
        auth: asAuth('asset_uid'),
        users,
        requestData: {
          ...validAssetCreate('asset_uid'),
          condition: 'new',
          warrantyStart: mockTimestamp(new Date('2026-05-07')),
          warrantyEnd: mockTimestamp(new Date('2027-05-07')),
        },
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('canCreateAsset accepts used condition with null warranty', () => {
    expect(
      canCreateAsset({
        auth: asAuth('asset_uid'),
        users,
        requestData: {
          ...validAssetCreate('asset_uid'),
          condition: 'used',
          warrantyStart: null,
          warrantyEnd: null,
        },
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('canCreateAsset rejects unknown condition', () => {
    expect(
      canCreateAsset({
        auth: asAuth('asset_uid'),
        users,
        requestData: { ...validAssetCreate('asset_uid'), condition: 'broken' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('canCreateAsset rejects empty condition', () => {
    expect(
      canCreateAsset({
        auth: asAuth('asset_uid'),
        users,
        requestData: { ...validAssetCreate('asset_uid'), condition: '' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('canCreateAsset rejects non-timestamp warrantyStart', () => {
    expect(
      canCreateAsset({
        auth: asAuth('asset_uid'),
        users,
        requestData: {
          ...validAssetCreate('asset_uid'),
          warrantyStart: 'not-a-timestamp',
        },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('canCreateAsset rejects non-timestamp warrantyEnd', () => {
    expect(
      canCreateAsset({
        auth: asAuth('asset_uid'),
        users,
        requestData: {
          ...validAssetCreate('asset_uid'),
          warrantyEnd: 12345,
        },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('canUpdateAsset allows subtypeId to change (super_admin can fix wrong pick)', () => {
    const before = existingAssetDoc('super_uid');
    const after = {
      ...before,
      subtypeId: 'device_workstation',
      updatedBy: 'super_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateAsset({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('canUpdateAsset rejects empty subtypeId', () => {
    const before = existingAssetDoc('super_uid');
    const after = {
      ...before,
      subtypeId: '',
      updatedBy: 'super_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateAsset({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('canUpdateAsset accepts condition flip from new -> used', () => {
    const before = existingAssetDoc('super_uid');
    const after = {
      ...before,
      condition: 'used',
      updatedBy: 'super_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateAsset({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('canUpdateAsset rejects unknown condition', () => {
    const before = existingAssetDoc('super_uid');
    const after = {
      ...before,
      condition: 'rotten',
      updatedBy: 'super_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateAsset({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });
});
