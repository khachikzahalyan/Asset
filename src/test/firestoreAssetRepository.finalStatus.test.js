/**
 * Wave-A Fix 5 — final-status guard tests.
 *
 * Verifies that setAssetStatus, updateAsset, and createAssignmentEvent
 * all reject mutations when the current asset status has isFinal: true.
 *
 * Uses the same hoisted-mock pattern as firestoreAssetRepository.test.js.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  docCounter: 0,
  newDoc: () => ({ id: `doc_${++mocks.docCounter}` }),
  capturedTx: { sets: [], updates: [], gets: [] },
  onSnapshotUnsub: vi.fn(),
  // Per-id asset_statuses docs.
  statuses: new Map([
    ['warehouse', { isFinal: false }],
    ['assigned', { isFinal: false }],
    ['written_off', { isFinal: true }],
    ['disposed', { isFinal: true }],
  ]),
  // category + counter for createAsset support
  category: { exists: true, data: { inventoryCodePrefix: '400', isActive: true } },
  counter: { exists: true, data: { next: 5 } },
  subtypes: new Map([
    ['device_laptop', { categoryId: 'device', attachableTo: null, isActive: true, name: 'Laptop' }],
  ]),
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
        if (path === 'categories') {
          return Promise.resolve({
            exists: () => mocks.category.exists,
            data: () => (mocks.category.exists ? mocks.category.data : undefined),
            ref,
          });
        }
        if (path === 'category_counters') {
          return Promise.resolve({
            exists: () => mocks.counter.exists,
            data: () => (mocks.counter.exists ? mocks.counter.data : undefined),
            ref,
          });
        }
        if (path === 'asset_subtypes') {
          const data = mocks.subtypes.get(id);
          return Promise.resolve({
            exists: () => data !== undefined,
            data: () => data,
            ref,
          });
        }
        if (path === 'assets') {
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

import { setAssetStatus, updateAsset } from '@/infra/repositories/firestoreAssetRepository.js';
import { AssetStatusFinalError } from '@/domain/assets.js';

beforeEach(() => {
  mocks.docCounter = 0;
  mocks.capturedTx = { sets: [], updates: [], gets: [] };
  mocks.assets = new Map();
  auditMocks.newAuditLogRef.mockClear();
  auditMocks.buildAuditLog.mockClear();
  auditMocks.newAuditLogRef.mockImplementation(() => ({ id: 'audit_1' }));
  auditMocks.buildAuditLog.mockImplementation((args) => ({ __audit: true, ...args }));
});

// ---------------------------------------------------------------------------
// setAssetStatus — final-status guard
// ---------------------------------------------------------------------------

describe('setAssetStatus — Fix 5: final-status guard', () => {
  const beforeWrittenOff = {
    assetId: 'a_1',
    inventoryCode: '400/5',
    categoryId: 'device',
    statusId: 'written_off',
    assignedTo: { kind: 'warehouse', id: null },
    isActive: false,
  };

  const beforeNonFinal = {
    ...beforeWrittenOff,
    statusId: 'assigned',
    isActive: true,
  };

  it('rejects status change away from a final status (default: no override)', async () => {
    await expect(
      setAssetStatus('a_1', 'warehouse', beforeWrittenOff, { uid: 'u1', role: 'asset_admin' })
    ).rejects.toBeInstanceOf(AssetStatusFinalError);
  });

  it('rejects status change for asset_admin even with allowOverride=true (not super_admin)', async () => {
    await expect(
      setAssetStatus('a_1', 'warehouse', beforeWrittenOff, { uid: 'u1', role: 'asset_admin' }, { allowOverride: true })
    ).rejects.toBeInstanceOf(AssetStatusFinalError);
  });

  it('allows super_admin to override with allowOverride: true', async () => {
    await expect(
      setAssetStatus('a_1', 'warehouse', beforeWrittenOff, { uid: 'u1', role: 'super_admin' }, { allowOverride: true })
    ).resolves.toBeUndefined();
  });

  it('allows same-status no-op on a final status', async () => {
    await expect(
      setAssetStatus('a_1', 'written_off', beforeWrittenOff, { uid: 'u1', role: 'asset_admin' })
    ).resolves.toBeUndefined();
  });

  it('allows status change from a non-final status', async () => {
    await expect(
      setAssetStatus('a_1', 'warehouse', beforeNonFinal, { uid: 'u1', role: 'asset_admin' })
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// updateAsset — final-status guard
// ---------------------------------------------------------------------------

describe('updateAsset — Fix 5: final-status guard', () => {
  const beforeFinal = {
    assetId: 'a_1',
    inventoryCode: '400/5',
    categoryId: 'device',
    subtypeId: 'device_laptop',
    statusId: 'written_off',
    assignedTo: { kind: 'warehouse', id: null },
    branchId: 'b_main',
    name: 'Device',
    brandId: null,
    modelId: null,
    serialNumber: null,
    notes: null,
    purchaseDate: null,
    purchasePrice: null,
    condition: 'new',
    warrantyStart: null,
    warrantyEnd: null,
    licenseType: null,
    subscribedAt: null,
    expiresAt: null,
    isActive: false,
  };

  it('rejects changing assignedTo when status is final', async () => {
    await expect(
      updateAsset(
        'a_1',
        {
          ...beforeFinal,
          assignedTo: { kind: 'employee', id: 'emp-1' }, // changed!
          branchId: null,
        },
        beforeFinal,
        { uid: 'u1', role: 'asset_admin' },
        { category: { requiresMultilang: false } },
      )
    ).rejects.toBeInstanceOf(AssetStatusFinalError);
  });

  it('rejects changing branchId when status is final', async () => {
    await expect(
      updateAsset(
        'a_1',
        {
          ...beforeFinal,
          branchId: 'b_different', // changed!
        },
        beforeFinal,
        { uid: 'u1', role: 'asset_admin' },
        { category: { requiresMultilang: false } },
      )
    ).rejects.toBeInstanceOf(AssetStatusFinalError);
  });

  it('allows updating notes even when status is final', async () => {
    // notes is not in the gated fields list.
    await expect(
      updateAsset(
        'a_1',
        {
          ...beforeFinal,
          notes: 'Archived device — for reference only',
          // assignedTo, branchId unchanged
          assignedTo: beforeFinal.assignedTo,
          branchId: beforeFinal.branchId,
        },
        beforeFinal,
        { uid: 'u1', role: 'asset_admin' },
        { category: { requiresMultilang: false } },
      )
    ).resolves.toBeUndefined();
  });
});
