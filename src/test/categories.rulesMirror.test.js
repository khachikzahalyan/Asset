/**
 * Rules-permission mirror tests for `/categories` and `/category_counters`.
 *
 * Mirrors the role/shape gating in `firestore.rules` as plain JavaScript
 * predicates and verifies every admission case relevant to Step 1 of the
 * assets initiative (asset status & category catalogs, no asset registry
 * yet).
 *
 * Why a mirror instead of the real emulator: the dev workstation has no
 * Java runtime, so the Firestore emulator suite is unavailable. This is
 * the same pattern `employees.rulesMirror.test.js` uses; both will be
 * superseded by emulator-based suites once a JRE is available, but the
 * mirror MUST stay byte-aligned with `firestore.rules` until then. Every
 * change to the categories / category_counters / asset_statuses blocks
 * in firestore.rules MUST be reflected here.
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

const PREFIX_RE = /^[A-Z0-9]+$/;
const isValidInventoryPrefix = (p) => typeof p === 'string' && PREFIX_RE.test(p);

function isValidLocaleMap(m) {
  if (!m || typeof m !== 'object') return false;
  const allowed = ['ru', 'en', 'hy'];
  const keys = Object.keys(m);
  if (keys.some((k) => !allowed.includes(k))) return false;
  if (typeof m.ru !== 'string') return false;
  if (typeof m.en !== 'string') return false;
  if (typeof m.hy !== 'string') return false;
  return true;
}

const ATTACHABLE_KINDS = new Set([
  'warehouse',
  'employee',
  'branch',
  'department',
  'asset',
]);

function isValidAttachableTo(v) {
  if (!Array.isArray(v)) return false;
  if (v.length < 1 || v.length > 5) return false;
  return v.every((k) => ATTACHABLE_KINDS.has(k));
}

// ---- /categories ---------------------------------------------------------

function canReadCategory({ auth, users }) {
  return isAdmin(auth, users);
}

function canCreateCategory({ auth, users, requestData, requestTime }) {
  if (!isSuperAdmin(auth, users)) return false;
  if (!isValidLocaleMap(requestData.name)) return false;
  if (!isValidInventoryPrefix(requestData.inventoryCodePrefix)) return false;
  if (typeof requestData.requiresMultilang !== 'boolean') return false;
  if (!isValidAttachableTo(requestData.attachableTo)) return false;
  if (typeof requestData.isActive !== 'boolean') return false;
  if (requestData.createdBy !== auth.uid) return false;
  if (requestData.updatedBy !== auth.uid) return false;
  if (requestData.createdAt !== requestTime) return false;
  if (requestData.updatedAt !== requestTime) return false;
  return true;
}

function canUpdateCategory({ auth, users, before, requestData, requestTime }) {
  if (!isSuperAdmin(auth, users)) return false;
  if (!isValidLocaleMap(requestData.name)) return false;
  if (!isValidInventoryPrefix(requestData.inventoryCodePrefix)) return false;
  if (typeof requestData.requiresMultilang !== 'boolean') return false;
  if (!isValidAttachableTo(requestData.attachableTo)) return false;
  if (typeof requestData.isActive !== 'boolean') return false;
  if (requestData.createdBy !== before.createdBy) return false;
  if (requestData.createdAt !== before.createdAt) return false;
  if (requestData.updatedBy !== auth.uid) return false;
  if (requestData.updatedAt !== requestTime) return false;
  return true;
}

// Wave A.9: hard-delete is permitted for super_admin only. Referential
// integrity (no referencing assets / sub-types) is enforced at the
// repository layer, not in rules.
function canDeleteCategory({ auth, users }) {
  return isSuperAdmin(auth, users);
}

// ---- /category_counters --------------------------------------------------

function canReadCategoryCounter({ auth, users }) {
  return isAdmin(auth, users);
}

function canCreateCategoryCounter({ auth, users, requestData, requestTime }) {
  if (!isSuperAdmin(auth, users)) return false;
  const allowedKeys = ['next', 'updatedAt'];
  const keys = Object.keys(requestData);
  if (keys.some((k) => !allowedKeys.includes(k))) return false;
  if (requestData.next !== 1) return false;
  if (requestData.updatedAt !== requestTime) return false;
  return true;
}

function canUpdateCategoryCounter({ auth, users, before, requestData, requestTime }) {
  if (!(isSuperAdmin(auth, users) || isAssetAdmin(auth, users))) return false;
  if (!Number.isInteger(requestData.next)) return false;
  if (!Number.isInteger(before.next)) return false;
  if (requestData.next !== before.next + 1) return false;
  if (requestData.updatedAt !== requestTime) return false;
  // Only `next` and `updatedAt` may change.
  const allowedKeys = ['next', 'updatedAt'];
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(requestData);
  const all = new Set([...beforeKeys, ...afterKeys]);
  for (const k of all) {
    if (before[k] !== requestData[k] && !allowedKeys.includes(k)) return false;
  }
  return true;
}

// Wave A.9: super_admin may delete a counter doc as part of the
// category hard-delete flow. Asset Admin and below are denied.
function canDeleteCategoryCounter({ auth, users }) {
  return isSuperAdmin(auth, users);
}

// ---- Test fixtures -------------------------------------------------------

const REQ_TIME = 'REQUEST_TIME';
const users = {
  super_uid: { role: ROLES.SUPER_ADMIN },
  asset_uid: { role: ROLES.ASSET_ADMIN },
  tech_uid: { role: ROLES.TECH_ADMIN },
  emp_uid: { role: ROLES.EMPLOYEE },
};

const validCategory = {
  name: { ru: 'Мебель', en: 'Furniture', hy: 'Կահույք' },
  inventoryCodePrefix: '500',
  requiresMultilang: true,
  attachableTo: ['warehouse', 'employee', 'branch', 'department'],
  isActive: true,
};

function createCategoryDoc(actorUid) {
  return {
    ...validCategory,
    createdBy: actorUid,
    updatedBy: actorUid,
    createdAt: REQ_TIME,
    updatedAt: REQ_TIME,
  };
}

function existingCategoryDoc(creatorUid = 'super_uid') {
  return {
    ...validCategory,
    createdBy: creatorUid,
    updatedBy: creatorUid,
    createdAt: 'OLD_TIME',
    updatedAt: 'OLD_TIME',
  };
}

function asAuth(uid) {
  return uid ? { uid } : null;
}

// -------------------------------------------------------------------------

describe('rules mirror — /categories read', () => {
  it.each([
    ['super_admin', 'super_uid', true],
    ['asset_admin', 'asset_uid', true],
    ['tech_admin', 'tech_uid', true],
    ['employee', 'emp_uid', false],
    ['anonymous', null, false],
  ])('%s read categories -> %s', (_label, uid, expected) => {
    expect(canReadCategory({ auth: asAuth(uid), users })).toBe(expected);
  });
});

describe('rules mirror — /categories create', () => {
  it('super_admin can create with a valid shape', () => {
    expect(
      canCreateCategory({
        auth: asAuth('super_uid'),
        users,
        requestData: createCategoryDoc('super_uid'),
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it.each(['asset_uid', 'tech_uid', 'emp_uid'])(
    '%s cannot create',
    (uid) => {
      expect(
        canCreateCategory({
          auth: asAuth(uid),
          users,
          requestData: createCategoryDoc(uid),
          requestTime: REQ_TIME,
        })
      ).toBe(false);
    }
  );

  it('rejects lowercase prefix', () => {
    expect(
      canCreateCategory({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...createCategoryDoc('super_uid'), inventoryCodePrefix: 'lic' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects prefix with slash', () => {
    expect(
      canCreateCategory({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...createCategoryDoc('super_uid'), inventoryCodePrefix: '400/' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects empty prefix', () => {
    expect(
      canCreateCategory({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...createCategoryDoc('super_uid'), inventoryCodePrefix: '' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects locale map with extra keys', () => {
    expect(
      canCreateCategory({
        auth: asAuth('super_uid'),
        users,
        requestData: {
          ...createCategoryDoc('super_uid'),
          name: { ru: 'a', en: 'b', hy: 'c', fr: 'd' },
        },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects locale map with non-string entry', () => {
    expect(
      canCreateCategory({
        auth: asAuth('super_uid'),
        users,
        requestData: {
          ...createCategoryDoc('super_uid'),
          name: { ru: 'a', en: 'b', hy: 123 },
        },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects when createdBy != auth.uid (forged actor)', () => {
    expect(
      canCreateCategory({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...createCategoryDoc('asset_uid') },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects non-boolean requiresMultilang', () => {
    expect(
      canCreateCategory({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...createCategoryDoc('super_uid'), requiresMultilang: 'yes' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects empty attachableTo array', () => {
    expect(
      canCreateCategory({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...createCategoryDoc('super_uid'), attachableTo: [] },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects attachableTo with unknown kind', () => {
    expect(
      canCreateCategory({
        auth: asAuth('super_uid'),
        users,
        requestData: {
          ...createCategoryDoc('super_uid'),
          attachableTo: ['warehouse', 'cosmos'],
        },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects attachableTo as string (legacy enum)', () => {
    expect(
      canCreateCategory({
        auth: asAuth('super_uid'),
        users,
        requestData: {
          ...createCategoryDoc('super_uid'),
          attachableTo: 'device-only',
        },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects attachableTo as null', () => {
    expect(
      canCreateCategory({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...createCategoryDoc('super_uid'), attachableTo: null },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('accepts attachableTo with all 5 allowed kinds', () => {
    expect(
      canCreateCategory({
        auth: asAuth('super_uid'),
        users,
        requestData: {
          ...createCategoryDoc('super_uid'),
          attachableTo: [
            'warehouse',
            'employee',
            'branch',
            'department',
            'asset',
          ],
        },
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });
});

describe('rules mirror — /categories update', () => {
  it('super_admin can update', () => {
    const before = existingCategoryDoc('super_uid');
    const after = {
      ...before,
      inventoryCodePrefix: '501',
      updatedBy: 'super_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateCategory({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it.each(['asset_uid', 'tech_uid', 'emp_uid'])(
    '%s cannot update',
    (uid) => {
      const before = existingCategoryDoc('super_uid');
      const after = { ...before, updatedBy: uid, updatedAt: REQ_TIME };
      expect(
        canUpdateCategory({
          auth: asAuth(uid),
          users,
          before,
          requestData: after,
          requestTime: REQ_TIME,
        })
      ).toBe(false);
    }
  );

  it('rejects update that changes createdBy', () => {
    const before = existingCategoryDoc('super_uid');
    const after = {
      ...before,
      createdBy: 'asset_uid',
      updatedBy: 'super_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateCategory({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects update with stale updatedAt', () => {
    const before = existingCategoryDoc('super_uid');
    const after = { ...before, updatedBy: 'super_uid', updatedAt: 'STALE' };
    expect(
      canUpdateCategory({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects update where updatedBy != auth.uid', () => {
    const before = existingCategoryDoc('super_uid');
    const after = { ...before, updatedBy: 'asset_uid', updatedAt: REQ_TIME };
    expect(
      canUpdateCategory({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });
});

describe('rules mirror — /categories delete', () => {
  it.each([
    ['super_admin', 'super_uid', true],
    ['asset_admin', 'asset_uid', false],
    ['tech_admin', 'tech_uid', false],
    ['employee', 'emp_uid', false],
    ['anonymous', null, false],
  ])('%s delete category -> %s (Wave A.9)', (_label, uid, expected) => {
    expect(canDeleteCategory({ auth: asAuth(uid), users })).toBe(expected);
  });
});

describe('rules mirror — /category_counters read', () => {
  it.each([
    ['super_admin', 'super_uid', true],
    ['asset_admin', 'asset_uid', true],
    ['tech_admin', 'tech_uid', true],
    ['employee', 'emp_uid', false],
    ['anonymous', null, false],
  ])('%s read counter -> %s', (_label, uid, expected) => {
    expect(canReadCategoryCounter({ auth: asAuth(uid), users })).toBe(expected);
  });
});

describe('rules mirror — /category_counters create', () => {
  const validCreate = { next: 1, updatedAt: REQ_TIME };

  it('super_admin can create with next=1', () => {
    expect(
      canCreateCategoryCounter({
        auth: asAuth('super_uid'),
        users,
        requestData: validCreate,
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it.each(['asset_uid', 'tech_uid', 'emp_uid'])(
    '%s cannot create',
    (uid) => {
      expect(
        canCreateCategoryCounter({
          auth: asAuth(uid),
          users,
          requestData: validCreate,
          requestTime: REQ_TIME,
        })
      ).toBe(false);
    }
  );

  it('rejects create with next != 1', () => {
    expect(
      canCreateCategoryCounter({
        auth: asAuth('super_uid'),
        users,
        requestData: { next: 5, updatedAt: REQ_TIME },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects create with extra keys', () => {
    expect(
      canCreateCategoryCounter({
        auth: asAuth('super_uid'),
        users,
        requestData: { next: 1, updatedAt: REQ_TIME, owner: 'evil' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects create with stale updatedAt', () => {
    expect(
      canCreateCategoryCounter({
        auth: asAuth('super_uid'),
        users,
        requestData: { next: 1, updatedAt: 'OLD' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });
});

describe('rules mirror — /category_counters update', () => {
  const before = { next: 5, updatedAt: 'OLD' };

  it('super_admin can increment by exactly 1', () => {
    expect(
      canUpdateCategoryCounter({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: { next: 6, updatedAt: REQ_TIME },
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('asset_admin can increment by exactly 1', () => {
    expect(
      canUpdateCategoryCounter({
        auth: asAuth('asset_uid'),
        users,
        before,
        requestData: { next: 6, updatedAt: REQ_TIME },
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it.each(['tech_uid', 'emp_uid'])(
    '%s cannot increment',
    (uid) => {
      expect(
        canUpdateCategoryCounter({
          auth: asAuth(uid),
          users,
          before,
          requestData: { next: 6, updatedAt: REQ_TIME },
          requestTime: REQ_TIME,
        })
      ).toBe(false);
    }
  );

  it('rejects skip-ahead increment (>+1)', () => {
    expect(
      canUpdateCategoryCounter({
        auth: asAuth('asset_uid'),
        users,
        before,
        requestData: { next: 7, updatedAt: REQ_TIME },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects decrement', () => {
    expect(
      canUpdateCategoryCounter({
        auth: asAuth('asset_uid'),
        users,
        before,
        requestData: { next: 4, updatedAt: REQ_TIME },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects same-value write', () => {
    expect(
      canUpdateCategoryCounter({
        auth: asAuth('asset_uid'),
        users,
        before,
        requestData: { next: 5, updatedAt: REQ_TIME },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects stale updatedAt', () => {
    expect(
      canUpdateCategoryCounter({
        auth: asAuth('asset_uid'),
        users,
        before,
        requestData: { next: 6, updatedAt: 'STALE' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects non-integer next', () => {
    expect(
      canUpdateCategoryCounter({
        auth: asAuth('asset_uid'),
        users,
        before,
        requestData: { next: 6.5, updatedAt: REQ_TIME },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });
});

describe('rules mirror — /category_counters delete', () => {
  it.each([
    ['super_admin', 'super_uid', true],
    ['asset_admin', 'asset_uid', false],
    ['tech_admin', 'tech_uid', false],
    ['employee', 'emp_uid', false],
    ['anonymous', null, false],
  ])('%s delete counter -> %s (Wave A.9)', (_label, uid, expected) => {
    expect(canDeleteCategoryCounter({ auth: asAuth(uid), users })).toBe(expected);
  });
});
