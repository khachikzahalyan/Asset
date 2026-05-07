/**
 * Rules-permission mirror tests for `/assignment_events/{eventId}`.
 *
 * Mirrors the role/shape gating in `firestore.rules` (Wave-1 Step 4) as
 * plain JavaScript predicates. Same rationale as
 * `assets.rulesMirror.test.js`: the dev workstation has no JRE so the
 * Firestore emulator suite is unavailable; this file MUST stay
 * byte-aligned with the `/assignment_events/{eventId}` block in
 * `firestore.rules` until the emulator becomes available.
 *
 * Coverage:
 *   - read matrix (admin yes, employee no, anonymous no)
 *   - create matrix (super_admin / asset_admin yes; tech_admin /
 *     employee / anonymous no)
 *   - shape validation (eventId mismatch, bad eventType, bad
 *     fromAssignment / toAssignment shapes, oversized notes, bad
 *     actUploadPath, forged actorUid, stale createdAt)
 *   - immutability (update / delete denied for everyone)
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

function isValidAssignedTo(a) {
  if (!a || typeof a !== 'object') return false;
  const keys = Object.keys(a);
  if (keys.some((k) => k !== 'kind' && k !== 'id')) return false;
  if (a.kind === 'warehouse') return a.id === null;
  if (a.kind === 'employee' || a.kind === 'branch' || a.kind === 'department') {
    return typeof a.id === 'string' && a.id.length > 0;
  }
  return false;
}

function isValidEventType(t) {
  return t === 'issue' || t === 'return' || t === 'transfer';
}

const ACT_RE = /^assets\/[^/]+\/acts\/[^/]+\.(pdf|jpg|jpeg|png)$/;
function isValidActUploadPath(p) {
  return p === null || (typeof p === 'string' && ACT_RE.test(p));
}

// ---- /assignment_events/{eventId} ---------------------------------------

function canReadAssignmentEvent({ auth, users }) {
  return isAdmin(auth, users);
}

function canCreateAssignmentEvent({ auth, users, eventId, requestData, requestTime }) {
  if (!(isSuperAdmin(auth, users) || isAssetAdmin(auth, users))) return false;
  if (requestData.eventId !== eventId) return false;
  if (typeof requestData.assetId !== 'string' || requestData.assetId.length === 0)
    return false;
  if (
    !(
      requestData.fromAssignment === null ||
      isValidAssignedTo(requestData.fromAssignment)
    )
  )
    return false;
  if (!isValidAssignedTo(requestData.toAssignment)) return false;
  if (!isValidEventType(requestData.eventType)) return false;
  // occurredAt must be a Timestamp; in this mirror we represent that as
  // the sentinel object {__ts: ...} the firestore mock uses, OR as any
  // Date instance (the test sometimes passes raw Date refs through).
  if (
    !(
      requestData.occurredAt &&
      (requestData.occurredAt.__ts !== undefined ||
        requestData.occurredAt instanceof Date ||
        typeof requestData.occurredAt === 'object')
    )
  )
    return false;
  if (
    !(
      requestData.notes === null ||
      (typeof requestData.notes === 'string' && requestData.notes.length <= 1000)
    )
  )
    return false;
  if (!isValidActUploadPath(requestData.actUploadPath)) return false;
  if (requestData.actorUid !== auth.uid) return false;
  if (typeof requestData.actorRole !== 'string') return false;
  if (requestData.createdAt !== requestTime) return false;
  return true;
}

function canUpdateAssignmentEvent() {
  return false;
}
function canDeleteAssignmentEvent() {
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

const VALID_TS = { __ts: 1715068800000 }; // 2024-05-07 — sentinel mirroring Timestamp.fromDate(...)

function validEventCreate(actorUid, eventId = 'event_1') {
  return {
    eventId,
    assetId: 'a_1',
    fromAssignment: { kind: 'warehouse', id: null },
    toAssignment: { kind: 'employee', id: 'e_5' },
    eventType: 'issue',
    occurredAt: VALID_TS,
    notes: null,
    actUploadPath: null,
    actorUid,
    actorRole: 'asset_admin',
    createdAt: REQ_TIME,
  };
}

function asAuth(uid) {
  return uid ? { uid } : null;
}

// -------------------------------------------------------------------------

describe('rules mirror — /assignment_events read', () => {
  it.each([
    ['super_admin', 'super_uid', true],
    ['asset_admin', 'asset_uid', true],
    ['tech_admin', 'tech_uid', true],
    ['employee', 'emp_uid', false],
    ['anonymous', null, false],
  ])('%s read assignment_events -> %s', (_label, uid, expected) => {
    expect(canReadAssignmentEvent({ auth: asAuth(uid), users })).toBe(expected);
  });
});

describe('rules mirror — /assignment_events create role gating', () => {
  it('super_admin can create with a valid shape', () => {
    expect(
      canCreateAssignmentEvent({
        auth: asAuth('super_uid'),
        users,
        eventId: 'event_1',
        requestData: validEventCreate('super_uid'),
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('asset_admin can create with a valid shape', () => {
    expect(
      canCreateAssignmentEvent({
        auth: asAuth('asset_uid'),
        users,
        eventId: 'event_1',
        requestData: validEventCreate('asset_uid'),
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it.each([
    ['tech_admin', 'tech_uid'],
    ['employee', 'emp_uid'],
  ])('%s cannot create', (_label, uid) => {
    expect(
      canCreateAssignmentEvent({
        auth: asAuth(uid),
        users,
        eventId: 'event_1',
        requestData: validEventCreate(uid),
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('anonymous cannot create', () => {
    expect(
      canCreateAssignmentEvent({
        auth: null,
        users,
        eventId: 'event_1',
        requestData: validEventCreate('anon'),
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });
});

describe('rules mirror — /assignment_events create shape validation', () => {
  it('rejects when eventId field does not match the doc id', () => {
    expect(
      canCreateAssignmentEvent({
        auth: asAuth('super_uid'),
        users,
        eventId: 'event_1',
        requestData: { ...validEventCreate('super_uid'), eventId: 'mismatch' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects empty assetId', () => {
    expect(
      canCreateAssignmentEvent({
        auth: asAuth('super_uid'),
        users,
        eventId: 'event_1',
        requestData: { ...validEventCreate('super_uid'), assetId: '' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('accepts fromAssignment=null (very first issue)', () => {
    expect(
      canCreateAssignmentEvent({
        auth: asAuth('super_uid'),
        users,
        eventId: 'event_1',
        requestData: { ...validEventCreate('super_uid'), fromAssignment: null },
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('rejects fromAssignment with extra keys', () => {
    expect(
      canCreateAssignmentEvent({
        auth: asAuth('super_uid'),
        users,
        eventId: 'event_1',
        requestData: {
          ...validEventCreate('super_uid'),
          fromAssignment: { kind: 'warehouse', id: null, evil: 1 },
        },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects fromAssignment.kind=employee with id=null', () => {
    expect(
      canCreateAssignmentEvent({
        auth: asAuth('super_uid'),
        users,
        eventId: 'event_1',
        requestData: {
          ...validEventCreate('super_uid'),
          fromAssignment: { kind: 'employee', id: null },
        },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects toAssignment.kind=warehouse with id set', () => {
    expect(
      canCreateAssignmentEvent({
        auth: asAuth('super_uid'),
        users,
        eventId: 'event_1',
        requestData: {
          ...validEventCreate('super_uid'),
          toAssignment: { kind: 'warehouse', id: 'oops' },
        },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects toAssignment with unknown kind', () => {
    expect(
      canCreateAssignmentEvent({
        auth: asAuth('super_uid'),
        users,
        eventId: 'event_1',
        requestData: {
          ...validEventCreate('super_uid'),
          toAssignment: { kind: 'cosmos', id: 'x' },
        },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it.each([
    ['unknown event type', 'somethingelse'],
    ['empty string', ''],
    ['null', null],
    ['number', 7],
  ])('rejects bad eventType (%s)', (_label, val) => {
    expect(
      canCreateAssignmentEvent({
        auth: asAuth('super_uid'),
        users,
        eventId: 'event_1',
        requestData: { ...validEventCreate('super_uid'), eventType: val },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it.each(['issue', 'return', 'transfer'])(
    'accepts valid eventType %s',
    (eventType) => {
      expect(
        canCreateAssignmentEvent({
          auth: asAuth('super_uid'),
          users,
          eventId: 'event_1',
          requestData: { ...validEventCreate('super_uid'), eventType },
          requestTime: REQ_TIME,
        })
      ).toBe(true);
    }
  );

  it('accepts notes exactly at 1000 chars', () => {
    expect(
      canCreateAssignmentEvent({
        auth: asAuth('super_uid'),
        users,
        eventId: 'event_1',
        requestData: { ...validEventCreate('super_uid'), notes: 'x'.repeat(1000) },
        requestTime: REQ_TIME,
      })
    ).toBe(true);
  });

  it('rejects notes longer than 1000 chars', () => {
    expect(
      canCreateAssignmentEvent({
        auth: asAuth('super_uid'),
        users,
        eventId: 'event_1',
        requestData: { ...validEventCreate('super_uid'), notes: 'x'.repeat(1001) },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects notes that are not string or null', () => {
    expect(
      canCreateAssignmentEvent({
        auth: asAuth('super_uid'),
        users,
        eventId: 'event_1',
        requestData: { ...validEventCreate('super_uid'), notes: 42 },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it.each([
    ['valid pdf', 'assets/abc/acts/event.pdf', true],
    ['valid jpg', 'assets/abc/acts/event.jpg', true],
    ['valid jpeg', 'assets/abc/acts/event.jpeg', true],
    ['valid png', 'assets/abc/acts/event.png', true],
    ['null (no act yet)', null, true],
    ['wrong root prefix', 'foo/abc/acts/event.pdf', false],
    ['wrong extension', 'assets/abc/acts/event.txt', false],
    ['extra path segment', 'assets/abc/acts/sub/event.pdf', false],
    ['too few segments', 'assets/abc/event.pdf', false],
  ])('actUploadPath shape %s -> %s', (_label, p, expected) => {
    expect(
      canCreateAssignmentEvent({
        auth: asAuth('super_uid'),
        users,
        eventId: 'event_1',
        requestData: { ...validEventCreate('super_uid'), actUploadPath: p },
        requestTime: REQ_TIME,
      })
    ).toBe(expected);
  });

  it('rejects when actorUid != auth.uid (forged actor)', () => {
    expect(
      canCreateAssignmentEvent({
        auth: asAuth('super_uid'),
        users,
        eventId: 'event_1',
        requestData: { ...validEventCreate('asset_uid') },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects when actorRole is not a string', () => {
    expect(
      canCreateAssignmentEvent({
        auth: asAuth('super_uid'),
        users,
        eventId: 'event_1',
        requestData: { ...validEventCreate('super_uid'), actorRole: 42 },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });

  it('rejects stale createdAt (must equal request.time)', () => {
    expect(
      canCreateAssignmentEvent({
        auth: asAuth('super_uid'),
        users,
        eventId: 'event_1',
        requestData: { ...validEventCreate('super_uid'), createdAt: 'OLD_TIME' },
        requestTime: REQ_TIME,
      })
    ).toBe(false);
  });
});

describe('rules mirror — /assignment_events immutability', () => {
  it.each([
    ['super_admin', 'super_uid'],
    ['asset_admin', 'asset_uid'],
    ['tech_admin', 'tech_uid'],
    ['employee', 'emp_uid'],
    ['anonymous', null],
  ])('%s cannot update an event', () => {
    expect(canUpdateAssignmentEvent()).toBe(false);
  });

  it.each([
    ['super_admin', 'super_uid'],
    ['asset_admin', 'asset_uid'],
    ['tech_admin', 'tech_uid'],
    ['employee', 'emp_uid'],
    ['anonymous', null],
  ])('%s cannot delete an event', () => {
    expect(canDeleteAssignmentEvent()).toBe(false);
  });
});
