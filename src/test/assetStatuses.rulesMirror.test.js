/**
 * Rules-permission mirror tests for `/asset_statuses`.
 *
 * Mirrors the role/shape gating in `firestore.rules` as plain JavaScript
 * predicates. The lifecycle invariant under test: `isFinal` is one-way
 * (it may flip false -> true OR stay equal, but never true -> false).
 *
 * See `categories.rulesMirror.test.js` for the rationale on why this is
 * a hand-written mirror instead of an emulator-driven suite — short
 * version: the dev workstation has no JRE.
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

const COLOR_RE = /^#[0-9a-f]{6}$/;
const isValidColorHex = (c) => typeof c === 'string' && COLOR_RE.test(c);

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

function canReadAssetStatus({ auth, users }) {
  return isAdmin(auth, users);
}

function canCreateAssetStatus({ auth, users, requestData, requestTime }) {
  if (!isSuperAdmin(auth, users)) return false;
  if (!isValidLocaleMap(requestData.name)) return false;
  if (!isValidColorHex(requestData.color)) return false;
  if (typeof requestData.isFinal !== 'boolean') return false;
  if (typeof requestData.isAssignable !== 'boolean') return false;
  if (!Number.isInteger(requestData.sortOrder)) return false;
  if (typeof requestData.isActive !== 'boolean') return false;
  if (requestData.createdBy !== auth.uid) return false;
  if (requestData.updatedBy !== auth.uid) return false;
  if (requestData.createdAt !== requestTime) return false;
  if (requestData.updatedAt !== requestTime) return false;
  return true;
}

function canUpdateAssetStatus({ auth, users, before, requestData, requestTime }) {
  if (!isSuperAdmin(auth, users)) return false;
  if (!isValidLocaleMap(requestData.name)) return false;
  if (!isValidColorHex(requestData.color)) return false;
  if (typeof requestData.isFinal !== 'boolean') return false;
  if (typeof requestData.isAssignable !== 'boolean') return false;
  if (!Number.isInteger(requestData.sortOrder)) return false;
  if (typeof requestData.isActive !== 'boolean') return false;
  if (requestData.createdBy !== before.createdBy) return false;
  if (requestData.createdAt !== before.createdAt) return false;
  if (requestData.updatedBy !== auth.uid) return false;
  if (requestData.updatedAt !== requestTime) return false;
  // isFinal is one-way: stay-the-same or false -> true.
  if (
    requestData.isFinal !== before.isFinal &&
    !(before.isFinal === false && requestData.isFinal === true)
  ) {
    return false;
  }
  return true;
}

function canDeleteAssetStatus() {
  return false;
}

const REQ_TIME = 'REQUEST_TIME';
const users = {
  super_uid: { role: ROLES.SUPER_ADMIN },
  asset_uid: { role: ROLES.ASSET_ADMIN },
  tech_uid: { role: ROLES.TECH_ADMIN },
  emp_uid: { role: ROLES.EMPLOYEE },
};

const validStatus = {
  name: { ru: 'Склад', en: 'Warehouse', hy: 'Պահեստ' },
  color: '#64748b',
  isFinal: false,
  isAssignable: false,
  sortOrder: 1,
  isActive: true,
};

function createStatusDoc(actorUid) {
  return {
    ...validStatus,
    createdBy: actorUid,
    updatedBy: actorUid,
    createdAt: REQ_TIME,
    updatedAt: REQ_TIME,
  };
}

function existingStatusDoc(creatorUid = 'super_uid', overrides = {}) {
  return {
    ...validStatus,
    createdBy: creatorUid,
    updatedBy: creatorUid,
    createdAt: 'OLD_TIME',
    updatedAt: 'OLD_TIME',
    ...overrides,
  };
}

function asAuth(uid) {
  return uid ? { uid } : null;
}

// -------------------------------------------------------------------------

describe('rules mirror — /asset_statuses read', () => {
  it.each([
    ['super_admin', 'super_uid', true],
    ['asset_admin', 'asset_uid', true],
    ['tech_admin', 'tech_uid', true],
    ['employee', 'emp_uid', false],
    ['anonymous', null, false],
  ])('%s read statuses -> %s', (_label, uid, expected) => {
    expect(canReadAssetStatus({ auth: asAuth(uid), users })).toBe(expected);
  });
});

describe('rules mirror — /asset_statuses create', () => {
  it('super_admin can create with a valid shape', () => {
    expect(
      canCreateAssetStatus({
        auth: asAuth('super_uid'),
        users,
        requestData: createStatusDoc('super_uid'),
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it.each(['asset_uid', 'tech_uid', 'emp_uid'])(
    '%s cannot create',
    (uid) => {
      expect(
        canCreateAssetStatus({
          auth: asAuth(uid),
          users,
          requestData: createStatusDoc(uid),
          requestTime: REQ_TIME,
        })
      ).toBe(false);
    }
  );

  it('rejects uppercase color hex', () => {
    expect(
      canCreateAssetStatus({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...createStatusDoc('super_uid'), color: '#FFFFFF' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects malformed color', () => {
    expect(
      canCreateAssetStatus({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...createStatusDoc('super_uid'), color: '#zzz111' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects non-integer sortOrder', () => {
    expect(
      canCreateAssetStatus({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...createStatusDoc('super_uid'), sortOrder: 1.5 },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects when createdBy != auth.uid', () => {
    expect(
      canCreateAssetStatus({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...createStatusDoc('asset_uid') },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects locale map with extra keys', () => {
    expect(
      canCreateAssetStatus({
        auth: asAuth('super_uid'),
        users,
        requestData: {
          ...createStatusDoc('super_uid'),
          name: { ru: 'a', en: 'b', hy: 'c', ka: 'd' },
        },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });
});

describe('rules mirror — /asset_statuses update', () => {
  it('super_admin can update non-final fields', () => {
    const before = existingStatusDoc('super_uid');
    const after = {
      ...before,
      color: '#15803d',
      sortOrder: 2,
      updatedBy: 'super_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateAssetStatus({
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
      const before = existingStatusDoc('super_uid');
      const after = { ...before, color: '#15803d', updatedBy: uid, updatedAt: REQ_TIME };
      expect(
        canUpdateAssetStatus({
          auth: asAuth(uid),
          users,
          before,
          requestData: after,
          requestTime: REQ_TIME,
        })
      ).toBe(false);
    }
  );

  it('allows isFinal flip false -> true', () => {
    const before = existingStatusDoc('super_uid', { isFinal: false });
    const after = { ...before, isFinal: true, updatedBy: 'super_uid', updatedAt: REQ_TIME };
    expect(
      canUpdateAssetStatus({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('rejects isFinal flip true -> false (one-way invariant)', () => {
    const before = existingStatusDoc('super_uid', { isFinal: true });
    const after = { ...before, isFinal: false, updatedBy: 'super_uid', updatedAt: REQ_TIME };
    expect(
      canUpdateAssetStatus({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects update that changes createdBy', () => {
    const before = existingStatusDoc('super_uid');
    const after = {
      ...before,
      createdBy: 'asset_uid',
      updatedBy: 'super_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateAssetStatus({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects update where updatedBy != auth.uid', () => {
    const before = existingStatusDoc('super_uid');
    const after = { ...before, color: '#15803d', updatedBy: 'asset_uid', updatedAt: REQ_TIME };
    expect(
      canUpdateAssetStatus({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects stale updatedAt', () => {
    const before = existingStatusDoc('super_uid');
    const after = { ...before, color: '#15803d', updatedBy: 'super_uid', updatedAt: 'STALE' };
    expect(
      canUpdateAssetStatus({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });
});

describe('rules mirror — /asset_statuses delete', () => {
  it('every role denied', () => {
    expect(canDeleteAssetStatus()).toBe(false);
  });
});
