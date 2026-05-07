/**
 * Rules-permission mirror tests.
 *
 * Mirrors the role/shape gating in `firestore.rules` for the `/employees`
 * and `/email_index` blocks as a plain JavaScript pure function and verifies
 * every case in the rules-test matrix from
 * `docs/superpowers/plans/employees-foundation.md` §9.3.
 *
 * Why a mirror instead of the real emulator:
 *   - The Firestore emulator requires Java; the AMS dev workstation does not
 *     have a JRE. The plan's §9.3 note allows falling back to a pure-JS
 *     permission-mapper unit test when the emulator is unavailable.
 *   - This file does NOT replace the emulator-based suite; the scaffolded
 *     `firestore-tests/employees.rules.test.js` is checked in for the day a
 *     JRE is available. See `firestore-tests/README.md`.
 *
 * Contract: the mirror must stay byte-aligned with the actual rules. Every
 * change to `firestore.rules` for employees/email_index MUST be reflected
 * here. The same is true in reverse — a green test here without a matching
 * rule is meaningless.
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

const ASCII_EMAIL = /^[\x21-\x7E]+@[\x21-\x7E]+\.[\x21-\x7E]+$/;
const isAsciiPrintableEmail = (s) => typeof s === 'string' && ASCII_EMAIL.test(s);

function isValidEmployeeShape(d) {
  if (typeof d.firstName !== 'string' || d.firstName.length === 0) return false;
  if (typeof d.lastName !== 'string' || d.lastName.length === 0) return false;
  if (typeof d.email !== 'string' || !isAsciiPrintableEmail(d.email)) return false;
  if ('phone' in d && d.phone !== null && typeof d.phone !== 'string') return false;
  // Wave 1.5: branchId REQUIRED — must be a non-empty string.
  if (typeof d.branchId !== 'string' || d.branchId.length === 0) return false;
  if ('departmentId' in d && d.departmentId !== null && typeof d.departmentId !== 'string')
    return false;
  if ('department' in d && d.department !== null && typeof d.department !== 'string')
    return false;
  if (typeof d.isActive !== 'boolean') return false;
  return true;
}

// Pure mirrors of the actual rule predicates, mapping verbatim from
// firestore.rules.
function canReadEmployee({ auth, users }) {
  return isAdmin(auth, users);
}

function canCreateEmployee({ auth, users, requestData, requestTime }) {
  if (!(isSuperAdmin(auth, users) || isAssetAdmin(auth, users))) return false;
  if (!isValidEmployeeShape(requestData)) return false;
  if (requestData.createdBy !== auth.uid) return false;
  if (requestData.updatedBy !== auth.uid) return false;
  if (requestData.createdAt !== requestTime) return false;
  if (requestData.updatedAt !== requestTime) return false;
  if (requestData.terminatedAt !== null) return false;
  return true;
}

function canUpdateEmployee({ auth, users, before, requestData, requestTime }) {
  if (!(isSuperAdmin(auth, users) || isAssetAdmin(auth, users))) return false;
  if (!isValidEmployeeShape(requestData)) return false;
  if (requestData.createdBy !== before.createdBy) return false;
  if (requestData.createdAt !== before.createdAt) return false;
  if (requestData.updatedBy !== auth.uid) return false;
  if (requestData.updatedAt !== requestTime) return false;
  // Reactivation guard
  const isReactivation = before.isActive === false && requestData.isActive === true;
  if (isReactivation && !isSuperAdmin(auth, users)) return false;
  return true;
}

function canDeleteEmployee() {
  return false;
}

function canReadEmailIndex({ auth, users }) {
  return isAdmin(auth, users);
}

function canCreateEmailIndex({ auth, users, requestData, requestTime }) {
  if (!(isSuperAdmin(auth, users) || isAssetAdmin(auth, users))) return false;
  if (typeof requestData.employeeId !== 'string') return false;
  if (requestData.createdAt !== requestTime) return false;
  return true;
}

function canDeleteEmailIndex({ auth, users }) {
  return isSuperAdmin(auth, users) || isAssetAdmin(auth, users);
}

// ---- Test fixtures --------------------------------------------------------

const REQ_TIME = 'REQUEST_TIME';
const users = {
  super_uid: { role: ROLES.SUPER_ADMIN },
  asset_uid: { role: ROLES.ASSET_ADMIN },
  tech_uid: { role: ROLES.TECH_ADMIN },
  emp_uid: { role: ROLES.EMPLOYEE },
};

const validEmployee = {
  firstName: 'Khach',
  lastName: 'Z',
  email: 'khach@example.com',
  phone: null,
  branchId: 'b_main',
  departmentId: null,
  department: null,
  isActive: true,
};

function createDoc(actorUid) {
  return {
    ...validEmployee,
    createdBy: actorUid,
    updatedBy: actorUid,
    createdAt: REQ_TIME,
    updatedAt: REQ_TIME,
    terminatedAt: null,
  };
}

function existingDoc(creatorUid = 'super_uid') {
  return {
    ...validEmployee,
    createdBy: creatorUid,
    updatedBy: creatorUid,
    createdAt: 'OLD_TIME',
    updatedAt: 'OLD_TIME',
    terminatedAt: null,
  };
}

function asAuth(uid) {
  return uid ? { uid } : null;
}

// ---------------------------------------------------------------------------

describe('rules mirror — /employees read', () => {
  it.each([
    ['super_admin', 'super_uid', true],
    ['asset_admin', 'asset_uid', true],
    ['tech_admin', 'tech_uid', true],
    ['employee', 'emp_uid', false],
    ['anonymous', null, false],
  ])('%s read employees -> %s', (_label, uid, expected) => {
    expect(canReadEmployee({ auth: asAuth(uid), users })).toBe(expected);
  });
});

describe('rules mirror — /employees create', () => {
  it('super_admin can create with a valid shape', () => {
    expect(
      canCreateEmployee({
        auth: asAuth('super_uid'),
        users,
        requestData: createDoc('super_uid'),
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('asset_admin can create with a valid shape', () => {
    expect(
      canCreateEmployee({
        auth: asAuth('asset_uid'),
        users,
        requestData: createDoc('asset_uid'),
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('tech_admin cannot create', () => {
    expect(
      canCreateEmployee({
        auth: asAuth('tech_uid'),
        users,
        requestData: createDoc('tech_uid'),
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('employee role cannot create', () => {
    expect(
      canCreateEmployee({
        auth: asAuth('emp_uid'),
        users,
        requestData: createDoc('emp_uid'),
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('anon cannot create', () => {
    expect(
      canCreateEmployee({
        auth: null,
        users,
        requestData: createDoc('whatever'),
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects non-ASCII email', () => {
    expect(
      canCreateEmployee({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...createDoc('super_uid'), email: 'тест@example.com' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects null branchId on create (Wave 1.5 makes it required)', () => {
    expect(
      canCreateEmployee({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...createDoc('super_uid'), branchId: null },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects an empty-string branchId on create', () => {
    expect(
      canCreateEmployee({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...createDoc('super_uid'), branchId: '' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('accepts a non-empty string branchId on create', () => {
    expect(
      canCreateEmployee({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...createDoc('super_uid'), branchId: 'b_yerevan' },
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('rejects when createdBy != auth.uid (forged actor)', () => {
    expect(
      canCreateEmployee({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...createDoc('asset_uid'), updatedBy: 'super_uid' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects non-null terminatedAt at creation', () => {
    expect(
      canCreateEmployee({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...createDoc('super_uid'), terminatedAt: REQ_TIME },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });
});

describe('rules mirror — /employees update', () => {
  it('super_admin can deactivate (true -> false)', () => {
    const before = existingDoc('super_uid');
    const after = {
      ...before,
      isActive: false,
      updatedBy: 'super_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateEmployee({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('asset_admin can deactivate (true -> false)', () => {
    const before = existingDoc('super_uid');
    const after = { ...before, isActive: false, updatedBy: 'asset_uid', updatedAt: REQ_TIME };
    expect(
      canUpdateEmployee({
        auth: asAuth('asset_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('super_admin can reactivate (false -> true)', () => {
    const before = { ...existingDoc('super_uid'), isActive: false };
    const after = { ...before, isActive: true, updatedBy: 'super_uid', updatedAt: REQ_TIME };
    expect(
      canUpdateEmployee({
        auth: asAuth('super_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('asset_admin CANNOT reactivate (false -> true)', () => {
    const before = { ...existingDoc('super_uid'), isActive: false };
    const after = { ...before, isActive: true, updatedBy: 'asset_uid', updatedAt: REQ_TIME };
    expect(
      canUpdateEmployee({
        auth: asAuth('asset_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('tech_admin cannot update', () => {
    const before = existingDoc('super_uid');
    const after = { ...before, department: 'X', updatedBy: 'tech_uid', updatedAt: REQ_TIME };
    expect(
      canUpdateEmployee({
        auth: asAuth('tech_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('employee cannot update', () => {
    const before = existingDoc('super_uid');
    const after = { ...before, department: 'X', updatedBy: 'emp_uid', updatedAt: REQ_TIME };
    expect(
      canUpdateEmployee({
        auth: asAuth('emp_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects update that changes createdBy', () => {
    const before = existingDoc('super_uid');
    const after = {
      ...before,
      createdBy: 'asset_uid',
      updatedBy: 'asset_uid',
      updatedAt: REQ_TIME,
    };
    expect(
      canUpdateEmployee({
        auth: asAuth('asset_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects update where updatedBy != auth.uid', () => {
    const before = existingDoc('super_uid');
    const after = { ...before, department: 'X', updatedBy: 'tech_uid', updatedAt: REQ_TIME };
    expect(
      canUpdateEmployee({
        auth: asAuth('asset_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects update with stale updatedAt', () => {
    const before = existingDoc('super_uid');
    const after = { ...before, department: 'X', updatedBy: 'asset_uid', updatedAt: 'STALE' };
    expect(
      canUpdateEmployee({
        auth: asAuth('asset_uid'),
        users,
        before,
        requestData: after,
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });
});

describe('rules mirror — /employees delete', () => {
  it('every role denied', () => {
    expect(canDeleteEmployee()).toBe(false);
  });
});

describe('rules mirror — /email_index', () => {
  const idxDoc = { employeeId: 'e1', createdAt: REQ_TIME };

  it('admins can read; employee cannot', () => {
    expect(canReadEmailIndex({ auth: asAuth('super_uid'), users })).toBe(true);
    expect(canReadEmailIndex({ auth: asAuth('asset_uid'), users })).toBe(true);
    expect(canReadEmailIndex({ auth: asAuth('tech_uid'), users })).toBe(true);
    expect(canReadEmailIndex({ auth: asAuth('emp_uid'), users })).toBe(false);
    expect(canReadEmailIndex({ auth: null, users })).toBe(false);
  });

  it('super_admin and asset_admin can create the sentinel', () => {
    for (const uid of ['super_uid', 'asset_uid']) {
      expect(
        canCreateEmailIndex({
          auth: asAuth(uid),
          users,
          requestData: idxDoc,
          requestTime: REQ_TIME,
        })
      ).toBe(true);
    }
  });

  it('tech_admin and employee cannot create the sentinel', () => {
    for (const uid of ['tech_uid', 'emp_uid']) {
      expect(
        canCreateEmailIndex({
          auth: asAuth(uid),
          users,
          requestData: idxDoc,
          requestTime: REQ_TIME,
        })
      ).toBe(false);
    }
  });

  it('rejects sentinel create with non-string employeeId', () => {
    expect(
      canCreateEmailIndex({
        auth: asAuth('super_uid'),
        users,
        requestData: { ...idxDoc, employeeId: 123 },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('admins can delete the sentinel; non-admins cannot', () => {
    expect(canDeleteEmailIndex({ auth: asAuth('super_uid'), users })).toBe(true);
    expect(canDeleteEmailIndex({ auth: asAuth('asset_uid'), users })).toBe(true);
    expect(canDeleteEmailIndex({ auth: asAuth('tech_uid'), users })).toBe(false);
    expect(canDeleteEmailIndex({ auth: asAuth('emp_uid'), users })).toBe(false);
  });
});
