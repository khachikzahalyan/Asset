/**
 * Wave-A Fix 4 + Fix 5 — createAssignmentEvent guards tests.
 *
 * Fix 4: cycle detection when toAssignment.kind === 'asset'.
 * Fix 5: final-status rejection when asset.statusId resolves to isFinal === true.
 *
 * Uses an augmented version of the standard mock in
 * firestoreAssignmentEventRepository.test.js, extended to also serve
 * asset_statuses docs from the tx.get mock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  docCounter: 0,
  newDoc: () => ({ id: `doc_${++mocks.docCounter}` }),
  capturedTx: { sets: [], updates: [], gets: [] },
  onSnapshotUnsub: vi.fn(),
  // Configurable asset state.
  asset: {
    exists: true,
    data: {
      assetId: 'a_1',
      assignedTo: { kind: 'warehouse', id: null },
      statusId: 'warehouse',
      branchId: 'b_main',
    },
  },
  // Per-id asset_statuses docs.
  statuses: new Map([
    ['warehouse', { isFinal: false }],
    ['assigned', { isFinal: false }],
    ['written_off', { isFinal: true }],
    ['disposed', { isFinal: true }],
  ]),
  // Per-id secondary asset docs (for cycle-walk lookups).
  assets: new Map(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((_dbOrCol, ...args) => {
    if (args.length === 0) return mocks.newDoc();
    return { id: args[args.length - 1], __ref: args };
  }),
  onSnapshot: vi.fn(() => mocks.onSnapshotUnsub),
  orderBy: vi.fn((field, dir) => ({ __order: [field, dir] })),
  query: vi.fn((coll, ...mods) => ({ __query: coll, mods })),
  where: vi.fn((field, op, val) => ({ __where: [field, op, val] })),
  runTransaction: vi.fn((_db, fn) => {
    mocks.capturedTx = { sets: [], updates: [], gets: [] };
    const tx = {
      get: vi.fn((ref) => {
        mocks.capturedTx.gets.push(ref);
        const path = Array.isArray(ref?.__ref) ? ref.__ref[0] : null;
        const id = Array.isArray(ref?.__ref) ? ref.__ref[1] : null;

        if (path === 'asset_statuses') {
          const data = mocks.statuses.get(id);
          return Promise.resolve({
            exists: () => data !== undefined,
            data: () => data,
            ref,
          });
        }

        if (path === 'assets') {
          // Primary asset (a_1) vs secondary assets for cycle lookup.
          if (id === 'a_1') {
            return Promise.resolve({
              exists: () => mocks.asset.exists,
              data: () => (mocks.asset.exists ? mocks.asset.data : undefined),
              ref,
            });
          }
          const data = mocks.assets.get(id);
          return Promise.resolve({
            exists: () => data !== undefined,
            data: () => data,
            ref,
          });
        }

        return Promise.resolve({ exists: () => false, data: () => undefined, ref });
      }),
      set: vi.fn((ref, data) => { mocks.capturedTx.sets.push({ ref, data }); }),
      update: vi.fn((ref, data) => { mocks.capturedTx.updates.push({ ref, data }); }),
    };
    return Promise.resolve(fn(tx));
  }),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
  Timestamp: { fromDate: (d) => ({ __ts: d.valueOf() }) },
  getFirestore: vi.fn(() => ({})),
}));

vi.mock('@/lib/firebase/index.js', () => ({ db: { __db: true } }));

const auditMocks = vi.hoisted(() => ({
  newAuditLogRef: vi.fn(() => ({ id: 'audit_1' })),
  buildAuditLog: vi.fn((args) => ({ __audit: true, ...args })),
}));
vi.mock('@/lib/audit/auditHelper.js', () => auditMocks);

import { createAssignmentEvent } from '@/infra/repositories/firestoreAssignmentEventRepository.js';
import { AssetStatusFinalError, AssignmentCycleError, AssignmentSelfError } from '@/domain/assets.js';

const ACTOR = { uid: 'u_admin', role: 'asset_admin' };

function baseInput(overrides = {}) {
  return {
    assetId: 'a_1',
    fromAssignment: { kind: 'warehouse', id: null },
    toAssignment: { kind: 'employee', id: 'emp-1' },
    occurredAt: new Date(),
    notes: null,
    actUploadPath: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.docCounter = 0;
  mocks.asset = {
    exists: true,
    data: {
      assetId: 'a_1',
      assignedTo: { kind: 'warehouse', id: null },
      statusId: 'warehouse',
      branchId: 'b_main',
    },
  };
  mocks.assets = new Map();
  auditMocks.newAuditLogRef.mockClear();
  auditMocks.buildAuditLog.mockClear();
  auditMocks.newAuditLogRef.mockImplementation(() => ({ id: 'audit_1' }));
  auditMocks.buildAuditLog.mockImplementation((args) => ({ __audit: true, ...args }));
});

// ---------------------------------------------------------------------------
// Fix 5: final-status guard in createAssignmentEvent
// ---------------------------------------------------------------------------

describe('createAssignmentEvent — Fix 5: final-status guard', () => {
  it('rejects issuance when asset status is written_off (isFinal: true)', async () => {
    mocks.asset.data.statusId = 'written_off';

    await expect(
      createAssignmentEvent(
        baseInput({ fromAssignment: { kind: 'warehouse', id: null } }),
        ACTOR,
      )
    ).rejects.toBeInstanceOf(AssetStatusFinalError);
  });

  it('rejects when status is disposed (isFinal: true)', async () => {
    mocks.asset.data.statusId = 'disposed';

    await expect(
      createAssignmentEvent(
        baseInput({ fromAssignment: { kind: 'warehouse', id: null } }),
        ACTOR,
      )
    ).rejects.toBeInstanceOf(AssetStatusFinalError);
  });

  it('allows issuance when status is warehouse (isFinal: false)', async () => {
    mocks.asset.data.statusId = 'warehouse';

    await expect(
      createAssignmentEvent(baseInput(), ACTOR)
    ).resolves.toBeDefined();
  });

  it('allows issuance when status has no isFinal field (unknown status = not final)', async () => {
    mocks.asset.data.statusId = 'custom_non_final';
    // Not in mocks.statuses → exists() returns false → treated as non-final.

    await expect(
      createAssignmentEvent(baseInput(), ACTOR)
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Fix 4: cycle check in createAssignmentEvent
// ---------------------------------------------------------------------------

describe('createAssignmentEvent — Fix 4: self-assign cycle', () => {
  it('throws AssignmentSelfError when toAssignment targets the same asset', async () => {
    await expect(
      createAssignmentEvent(
        baseInput({
          assetId: 'a_1',
          fromAssignment: { kind: 'warehouse', id: null },
          toAssignment: { kind: 'asset', id: 'a_1' },
        }),
        ACTOR,
      )
    ).rejects.toBeInstanceOf(AssignmentSelfError);
  });
});

describe('createAssignmentEvent — Fix 4: indirect cycle', () => {
  it('throws AssignmentCycleError when target asset points back to host', async () => {
    // Asset a_1 is being assigned to asset-B. asset-B currently points to a_1.
    mocks.assets.set('asset-B', {
      assetId: 'asset-B',
      assignedTo: { kind: 'asset', id: 'a_1' },
      statusId: 'assigned',
    });

    await expect(
      createAssignmentEvent(
        baseInput({
          assetId: 'a_1',
          fromAssignment: { kind: 'warehouse', id: null },
          toAssignment: { kind: 'asset', id: 'asset-B' },
        }),
        ACTOR,
      )
    ).rejects.toBeInstanceOf(AssignmentCycleError);
  });

  it('allows assignment to an asset that has no further asset chain', async () => {
    // asset-B is in warehouse (no asset chain) — safe to assign.
    mocks.assets.set('asset-B', {
      assetId: 'asset-B',
      assignedTo: { kind: 'warehouse', id: null },
      statusId: 'warehouse',
    });

    await expect(
      createAssignmentEvent(
        baseInput({
          assetId: 'a_1',
          fromAssignment: { kind: 'warehouse', id: null },
          toAssignment: { kind: 'asset', id: 'asset-B' },
        }),
        ACTOR,
      )
    ).resolves.toBeDefined();
  });
});
