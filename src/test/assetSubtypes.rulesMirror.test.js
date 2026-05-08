/**
 * Rules-permission mirror tests for `/asset_subtypes/{subtypeId}`.
 *
 * Mirrors the role/shape gating in `firestore.rules` (Wave-A Task 6) as
 * plain JavaScript predicates and verifies every admission case for the
 * sub-type catalog.
 *
 * Why a mirror instead of the real emulator: the dev workstation has no
 * Java runtime, so the Firestore emulator suite is unavailable. This is
 * the same pattern `categories.rulesMirror.test.js` and
 * `assets.rulesMirror.test.js` use; they will be superseded by
 * emulator-based suites once a JRE is available, but the mirror MUST
 * stay byte-aligned with `firestore.rules` until then. Every change to
 * the `/asset_subtypes/{subtypeId}` block in firestore.rules MUST be
 * reflected here.
 *
 * IMPORTANT: per user authorization (Wave A, 2026-05-07) read access on
 * `/asset_subtypes/*` is opened to ANY signed-in user (not just admins),
 * because the asset-create form must show a sub-type dropdown to all
 * admins AND the registry view shows sub-type names to all signed-in
 * users. Write remains super_admin only.
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

function isValidSubtypeName(n) {
  if (!n || typeof n !== 'object') return false;
  const allowed = ['ru', 'en', 'hy'];
  const keys = Object.keys(n);
  if (keys.some((k) => !allowed.includes(k))) return false;
  if (typeof n.ru !== 'string') return false;
  if (typeof n.en !== 'string') return false;
  if (typeof n.hy !== 'string') return false;
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

// ---- /asset_subtypes/{subtypeId} ----------------------------------------

function canReadSubtype({ auth }) {
  // User-authorized override: any signed-in user may read.
  return isSignedIn(auth);
}

function canCreateSubtype({ auth, users, requestData }) {
  if (!isSuperAdmin(auth, users)) return false;
  const allowed = [
    'categoryId', 'name', 'requiresMultilang', 'attachableTo',
    'sortOrder', 'isActive',
    'createdAt', 'createdBy', 'updatedAt', 'updatedBy',
  ];
  const keys = Object.keys(requestData);
  if (keys.some((k) => !allowed.includes(k))) return false;
  if (typeof requestData.categoryId !== 'string' || requestData.categoryId.length === 0) return false;
  if (!isValidSubtypeName(requestData.name)) return false;
  if (typeof requestData.requiresMultilang !== 'boolean') return false;
  if (!isValidAttachableTo(requestData.attachableTo)) return false;
  if (!Number.isInteger(requestData.sortOrder)) return false;
  if (typeof requestData.isActive !== 'boolean') return false;
  if (requestData.createdBy !== auth.uid) return false;
  if (requestData.updatedBy !== auth.uid) return false;
  return true;
}

function canUpdateSubtype({ auth, users, before, requestData }) {
  if (!isSuperAdmin(auth, users)) return false;
  const changed = Array.from(
    new Set([
      ...Object.keys(before).filter(
        (k) => JSON.stringify(before[k]) !== JSON.stringify(requestData[k])
      ),
      ...Object.keys(requestData).filter(
        (k) => JSON.stringify(before[k]) !== JSON.stringify(requestData[k])
      ),
    ])
  );
  const allowedChange = [
    'name', 'requiresMultilang', 'attachableTo', 'sortOrder',
    'isActive', 'updatedAt', 'updatedBy',
  ];
  if (changed.some((k) => !allowedChange.includes(k))) return false;
  if (changed.includes('name') && !isValidSubtypeName(requestData.name)) return false;
  if (
    changed.includes('attachableTo')
    && !isValidAttachableTo(requestData.attachableTo)
  ) {
    return false;
  }
  if (requestData.updatedBy !== auth.uid) return false;
  return true;
}

// Wave A.9: hard-delete by super_admin only. Repository pre-flight
// enforces "no asset references this subtype" before issuing the delete.
function canDeleteSubtype({ auth, users }) {
  return isSuperAdmin(auth, users);
}

// ---- Test fixtures -------------------------------------------------------

const users = {
  super_uid: { role: ROLES.SUPER_ADMIN },
  asset_uid: { role: ROLES.ASSET_ADMIN },
  tech_uid: { role: ROLES.TECH_ADMIN },
  emp_uid: { role: ROLES.EMPLOYEE },
};

function asAuth(uid) {
  return uid ? { uid } : null;
}

function validSubtypeCreate(actorUid) {
  return {
    categoryId: 'device',
    name: { ru: 'Laptop', en: 'Laptop', hy: 'Laptop' },
    requiresMultilang: false,
    attachableTo: ['warehouse', 'employee'],
    sortOrder: 1,
    isActive: true,
    createdAt: 'REQ_TIME',
    createdBy: actorUid,
    updatedAt: 'REQ_TIME',
    updatedBy: actorUid,
  };
}

function existingSubtypeDoc(creatorUid = 'super_uid') {
  return {
    ...validSubtypeCreate(creatorUid),
    createdAt: 'OLD_TIME',
    updatedAt: 'OLD_TIME',
  };
}

// -------------------------------------------------------------------------

describe('rules mirror — /asset_subtypes read', () => {
  it.each([
    ['super_admin', 'super_uid', true],
    ['asset_admin', 'asset_uid', true],
    ['tech_admin', 'tech_uid', true],
    ['employee', 'emp_uid', true],
    ['anonymous', null, false],
  ])('%s read subtypes -> %s', (_label, uid, expected) => {
    expect(canReadSubtype({ auth: asAuth(uid), users })).toBe(expected);
    // Sanity: explicitly assert the override is "any signed-in", not "any admin".
    if (uid === 'emp_uid') {
      expect(isAdmin(asAuth(uid), users)).toBe(false);
    }
  });
});

describe('rules mirror — /asset_subtypes create', () => {
  it('super_admin can create with a valid shape', () => {
    expect(
      canCreateSubtype({
        auth: asAuth('super_uid'),
        users,
        requestData: validSubtypeCreate('super_uid'),
      })
    ).toBe(true);
  });

  it.each([
    ['asset_admin', 'asset_uid'],
    ['tech_admin', 'tech_uid'],
    ['employee', 'emp_uid'],
  ])('%s cannot create', (_label, uid) => {
    expect(
      canCreateSubtype({
        auth: asAuth(uid),
        users,
        requestData: validSubtypeCreate(uid),
      })
    ).toBe(false);
  });

  it('anonymous cannot create', () => {
    expect(
      canCreateSubtype({
        auth: null,
        users,
        requestData: validSubtypeCreate('anon'),
      })
    ).toBe(false);
  });

  it('rejects extra keys', () => {
    expect(
      canCreateSubtype({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...validSubtypeCreate('super_uid'), evil: 1 },
      })
    ).toBe(false);
  });

  it('rejects empty categoryId', () => {
    expect(
      canCreateSubtype({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...validSubtypeCreate('super_uid'), categoryId: '' },
      })
    ).toBe(false);
  });

  it('rejects missing locale in name', () => {
    expect(
      canCreateSubtype({
        auth: asAuth('super_uid'),
        users,
        requestData: {
          ...validSubtypeCreate('super_uid'),
          name: { ru: 'x', en: 'y' },
        },
      })
    ).toBe(false);
  });

  it('rejects locale map with extra keys', () => {
    expect(
      canCreateSubtype({
        auth: asAuth('super_uid'),
        users,
        requestData: {
          ...validSubtypeCreate('super_uid'),
          name: { ru: 'x', en: 'y', hy: 'z', fr: 'w' },
        },
      })
    ).toBe(false);
  });

  it('rejects unknown kind in attachableTo', () => {
    expect(
      canCreateSubtype({
        auth: asAuth('super_uid'),
        users,
        requestData: {
          ...validSubtypeCreate('super_uid'),
          attachableTo: ['warehouse', 'wat'],
        },
      })
    ).toBe(false);
  });

  it('rejects empty attachableTo array', () => {
    expect(
      canCreateSubtype({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...validSubtypeCreate('super_uid'), attachableTo: [] },
      })
    ).toBe(false);
  });

  it('rejects attachableTo as legacy string', () => {
    expect(
      canCreateSubtype({
        auth: asAuth('super_uid'),
        users,
        requestData: {
          ...validSubtypeCreate('super_uid'),
          attachableTo: 'device-only',
        },
      })
    ).toBe(false);
  });

  it('rejects attachableTo as null', () => {
    expect(
      canCreateSubtype({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...validSubtypeCreate('super_uid'), attachableTo: null },
      })
    ).toBe(false);
  });

  it.each([
    [['asset']],
    [['asset', 'employee']],
    [['warehouse', 'employee', 'branch', 'department', 'asset']],
  ])('accepts attachableTo=%j', (value) => {
    expect(
      canCreateSubtype({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...validSubtypeCreate('super_uid'), attachableTo: value },
      })
    ).toBe(true);
  });

  it('rejects non-integer sortOrder', () => {
    expect(
      canCreateSubtype({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...validSubtypeCreate('super_uid'), sortOrder: 1.5 },
      })
    ).toBe(false);
  });

  it('rejects non-boolean isActive', () => {
    expect(
      canCreateSubtype({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...validSubtypeCreate('super_uid'), isActive: 'yes' },
      })
    ).toBe(false);
  });

  it('rejects when createdBy != auth.uid (forged actor)', () => {
    expect(
      canCreateSubtype({
        auth: asAuth('super_uid'),
        users,
        requestData: validSubtypeCreate('asset_uid'),
      })
    ).toBe(false);
  });
});

describe('rules mirror — /asset_subtypes update', () => {
  it('super_admin can update name', () => {
    const before = existingSubtypeDoc('super_uid');
    const after = {
      ...before,
      name: { ru: 'Notebook', en: 'Notebook', hy: 'Notebook' },
      updatedBy: 'super_uid',
      updatedAt: 'REQ_TIME',
    };
    expect(
      canUpdateSubtype({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
      })
    ).toBe(true);
  });

  it('super_admin can flip isActive', () => {
    const before = existingSubtypeDoc('super_uid');
    const after = {
      ...before,
      isActive: false,
      updatedBy: 'super_uid',
      updatedAt: 'REQ_TIME',
    };
    expect(
      canUpdateSubtype({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
      })
    ).toBe(true);
  });

  it.each([
    ['asset_admin', 'asset_uid'],
    ['tech_admin', 'tech_uid'],
    ['employee', 'emp_uid'],
  ])('%s cannot update', (_label, uid) => {
    const before = existingSubtypeDoc('super_uid');
    const after = {
      ...before,
      isActive: false,
      updatedBy: uid,
      updatedAt: 'REQ_TIME',
    };
    expect(
      canUpdateSubtype({
        auth: asAuth(uid),
        users,
        before,
        requestData: after,
      })
    ).toBe(false);
  });

  it('rejects categoryId change', () => {
    const before = existingSubtypeDoc('super_uid');
    const after = {
      ...before,
      categoryId: 'license',
      updatedBy: 'super_uid',
      updatedAt: 'REQ_TIME',
    };
    expect(
      canUpdateSubtype({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
      })
    ).toBe(false);
  });

  it('rejects createdBy change', () => {
    const before = existingSubtypeDoc('super_uid');
    const after = {
      ...before,
      createdBy: 'attacker',
      updatedBy: 'super_uid',
      updatedAt: 'REQ_TIME',
    };
    expect(
      canUpdateSubtype({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
      })
    ).toBe(false);
  });

  it('rejects createdAt change', () => {
    const before = existingSubtypeDoc('super_uid');
    const after = {
      ...before,
      createdAt: 'TAMPERED',
      updatedBy: 'super_uid',
      updatedAt: 'REQ_TIME',
    };
    expect(
      canUpdateSubtype({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
      })
    ).toBe(false);
  });

  it('rejects update where updatedBy != auth.uid', () => {
    const before = existingSubtypeDoc('super_uid');
    const after = {
      ...before,
      isActive: false,
      updatedBy: 'asset_uid',
      updatedAt: 'REQ_TIME',
    };
    expect(
      canUpdateSubtype({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
      })
    ).toBe(false);
  });

  it('rejects invalid name shape on update', () => {
    const before = existingSubtypeDoc('super_uid');
    const after = {
      ...before,
      name: { ru: 'x', en: 'y' },
      updatedBy: 'super_uid',
      updatedAt: 'REQ_TIME',
    };
    expect(
      canUpdateSubtype({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
      })
    ).toBe(false);
  });

  it('rejects invalid attachableTo on update', () => {
    const before = existingSubtypeDoc('super_uid');
    const after = {
      ...before,
      attachableTo: ['cosmos'],
      updatedBy: 'super_uid',
      updatedAt: 'REQ_TIME',
    };
    expect(
      canUpdateSubtype({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
      })
    ).toBe(false);
  });

  it('rejects empty attachableTo on update', () => {
    const before = existingSubtypeDoc('super_uid');
    const after = {
      ...before,
      attachableTo: [],
      updatedBy: 'super_uid',
      updatedAt: 'REQ_TIME',
    };
    expect(
      canUpdateSubtype({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
      })
    ).toBe(false);
  });
});

describe('rules mirror — /asset_subtypes delete', () => {
  it.each([
    ['super_admin', 'super_uid', true],
    ['asset_admin', 'asset_uid', false],
    ['tech_admin', 'tech_uid', false],
    ['employee', 'emp_uid', false],
    ['anonymous', null, false],
  ])('%s delete subtype -> %s (Wave A.9)', (_label, uid, expected) => {
    expect(canDeleteSubtype({ auth: asAuth(uid), users })).toBe(expected);
  });
});
