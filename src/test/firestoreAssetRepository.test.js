/**
 * Tests for firestoreAssetRepository.
 *
 * Mirrors the hoisted-mock pattern in firestoreCategoryRepository.test.js.
 * The Firestore SDK is fully mocked; transactions capture set / update / get
 * calls so each behavior assertion is on the captured payloads.
 *
 * The test mock for `tx.get` is parameterized: the first matching path
 * segment in the ref's `__ref` chain determines which fake document is
 * returned. This lets us model the real two-step transaction body:
 *
 *   1. tx.get(categories/{id})
 *   2. tx.get(category_counters/{id})
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  docCounter: 0,
  newDoc: () => ({ id: `doc_${++mocks.docCounter}` }),
  capturedTx: { sets: [], updates: [], gets: [] },
  onSnapshotUnsub: vi.fn(),
  // Fake category and counter shapes used by every test. Reset in beforeEach.
  category: { exists: true, data: { inventoryCodePrefix: '400', isActive: true } },
  counter: { exists: true, data: { next: 5 } },
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((_dbOrCol, ...args) => {
    if (args.length === 0) {
      // doc(collection) — ref for a brand-new doc.
      return mocks.newDoc();
    }
    // doc(db, collectionName, id) → ref carrying the path so the tx.get
    // mock can switch on collection name.
    return { id: args[args.length - 1], __ref: args };
  }),
  onSnapshot: vi.fn(() => mocks.onSnapshotUnsub),
  orderBy: vi.fn((field, dir) => ({ __order: [field, dir] })),
  query: vi.fn((coll, ...mods) => ({ __query: coll, mods })),
  runTransaction: vi.fn((_db, fn) => {
    mocks.capturedTx = { sets: [], updates: [], gets: [] };
    const tx = {
      get: vi.fn((ref) => {
        mocks.capturedTx.gets.push(ref);
        const path = Array.isArray(ref?.__ref) ? ref.__ref[0] : null;
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
        return Promise.resolve({ exists: () => false, data: () => undefined, ref });
      }),
      set: vi.fn((ref, data) => {
        mocks.capturedTx.sets.push({ ref, data });
      }),
      update: vi.fn((ref, data) => {
        mocks.capturedTx.updates.push({ ref, data });
      }),
    };
    return Promise.resolve(fn(tx));
  }),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
  Timestamp: {
    fromDate: (d) => ({ __ts: d.valueOf() }),
  },
  getFirestore: vi.fn(() => ({})),
}));

vi.mock('@/lib/firebase/index.js', () => ({
  db: { __db: true },
}));

const auditMocks = vi.hoisted(() => ({
  newAuditLogRef: vi.fn(() => ({ id: 'audit_1' })),
  buildAuditLog: vi.fn((args) => ({ __audit: true, ...args })),
}));
vi.mock('@/lib/audit/auditHelper.js', () => auditMocks);

import {
  createAsset,
  updateAsset,
  setAssetStatus,
  subscribeAssets,
  subscribeAsset,
  firestoreAssetRepository,
} from '@/infra/repositories/firestoreAssetRepository.js';
import {
  AssetCategoryInactiveError,
  AssetCounterMissingError,
} from '@/domain/assets.js';

beforeEach(() => {
  mocks.docCounter = 0;
  mocks.category = { exists: true, data: { inventoryCodePrefix: '400', isActive: true } };
  mocks.counter = { exists: true, data: { next: 5 } };
  auditMocks.newAuditLogRef.mockClear();
  auditMocks.buildAuditLog.mockClear();
  auditMocks.newAuditLogRef.mockImplementation(() => ({ id: 'audit_1' }));
  auditMocks.buildAuditLog.mockImplementation((args) => ({ __audit: true, ...args }));
});

describe('firestoreAssetRepository', () => {
  it('exports an adapter object matching the port shape', () => {
    expect(firestoreAssetRepository).toMatchObject({
      list: expect.any(Function),
      get: expect.any(Function),
      create: expect.any(Function),
      update: expect.any(Function),
      setStatus: expect.any(Function),
    });
    expect(Object.isFrozen(firestoreAssetRepository)).toBe(true);
  });

  describe('createAsset', () => {
    it('writes asset + audit_logs and increments the counter', async () => {
      const id = await createAsset(
        {
          categoryId: 'device',
          name: 'ASUS X550',
          brand: 'ASUS',
          assignedTo: { kind: 'warehouse', id: null },
          branchId: 'b_main',
          statusId: 'warehouse',
        },
        { uid: 'u_1', role: 'super_admin' },
        { category: { requiresMultilang: false } }
      );

      expect(typeof id).toBe('string');

      // 1 update (counter) + 2 sets (asset, audit)
      expect(mocks.capturedTx.updates).toHaveLength(1);
      expect(mocks.capturedTx.sets).toHaveLength(2);

      const counterUpdate = mocks.capturedTx.updates[0];
      expect(counterUpdate.data).toMatchObject({
        next: 6,
        updatedAt: 'SERVER_TS',
      });

      const [assetSet, auditSet] = mocks.capturedTx.sets;
      expect(assetSet.data).toMatchObject({
        inventoryCode: '400/5',
        categoryId: 'device',
        statusId: 'warehouse',
        name: 'ASUS X550',
        brand: 'ASUS',
        branchId: 'b_main',
        assignedTo: { kind: 'warehouse', id: null },
        isActive: true,
        createdBy: 'u_1',
        updatedBy: 'u_1',
        createdAt: 'SERVER_TS',
        updatedAt: 'SERVER_TS',
      });
      expect(assetSet.data.assetId).toBe(id);

      expect(auditSet.data).toMatchObject({
        __audit: true,
        entity: 'asset',
        entityId: id,
        action: 'create',
        actorUid: 'u_1',
        actorRole: 'super_admin',
        before: null,
      });
      expect(auditSet.data.after).toMatchObject({
        inventoryCode: '400/5',
        categoryId: 'device',
        statusId: 'warehouse',
        brand: 'ASUS',
      });
    });

    it('two consecutive creates yield distinct inventory codes from a monotonic counter', async () => {
      mocks.counter = { exists: true, data: { next: 5 } };
      await createAsset(
        {
          categoryId: 'device',
          name: 'A',
          assignedTo: { kind: 'warehouse', id: null },
          branchId: 'b',
          statusId: 'warehouse',
        },
        { uid: 'u_1', role: 'super_admin' },
        { category: { requiresMultilang: false } }
      );
      const firstCode = mocks.capturedTx.sets[0].data.inventoryCode;

      // Simulate the post-update counter state
      mocks.counter = { exists: true, data: { next: 6 } };
      await createAsset(
        {
          categoryId: 'device',
          name: 'B',
          assignedTo: { kind: 'warehouse', id: null },
          branchId: 'b',
          statusId: 'warehouse',
        },
        { uid: 'u_1', role: 'super_admin' },
        { category: { requiresMultilang: false } }
      );
      const secondCode = mocks.capturedTx.sets[0].data.inventoryCode;

      expect(firstCode).toBe('400/5');
      expect(secondCode).toBe('400/6');
      expect(firstCode).not.toBe(secondCode);
    });

    it('throws AssetCategoryInactiveError when the category is missing', async () => {
      mocks.category = { exists: false };
      await expect(
        createAsset(
          {
            categoryId: 'device',
            name: 'X',
            assignedTo: { kind: 'warehouse', id: null },
            branchId: 'b',
          },
          { uid: 'u_1', role: 'super_admin' },
          { category: { requiresMultilang: false } }
        )
      ).rejects.toBeInstanceOf(AssetCategoryInactiveError);
    });

    it('throws AssetCategoryInactiveError when the category is soft-deleted', async () => {
      mocks.category = {
        exists: true,
        data: { inventoryCodePrefix: '400', isActive: false },
      };
      await expect(
        createAsset(
          {
            categoryId: 'device',
            name: 'X',
            assignedTo: { kind: 'warehouse', id: null },
            branchId: 'b',
          },
          { uid: 'u_1', role: 'super_admin' },
          { category: { requiresMultilang: false } }
        )
      ).rejects.toBeInstanceOf(AssetCategoryInactiveError);
    });

    it('throws AssetCounterMissingError when the counter doc is missing', async () => {
      mocks.counter = { exists: false };
      await expect(
        createAsset(
          {
            categoryId: 'device',
            name: 'X',
            assignedTo: { kind: 'warehouse', id: null },
            branchId: 'b',
          },
          { uid: 'u_1', role: 'super_admin' },
          { category: { requiresMultilang: false } }
        )
      ).rejects.toBeInstanceOf(AssetCounterMissingError);
    });

    it('rejects a missing actor', async () => {
      await expect(
        createAsset(
          { categoryId: 'device', name: 'X' },
          {}
        )
      ).rejects.toThrow(/actor.uid/);
    });
  });

  describe('updateAsset', () => {
    const before = {
      assetId: 'a_1',
      inventoryCode: '400/5',
      categoryId: 'device',
      statusId: 'warehouse',
      name: 'A',
      brand: 'ASUS',
      model: null,
      serialNumber: null,
      branchId: 'b_main',
      assignedTo: { kind: 'warehouse', id: null },
      notes: null,
      purchaseDate: null,
      purchasePrice: null,
      isActive: true,
    };

    it('writes update payload WITHOUT inventoryCode / categoryId / statusId', async () => {
      await updateAsset(
        'a_1',
        {
          categoryId: 'OTHER_CATEGORY',
          statusId: 'OTHER_STATUS',
          name: 'A2',
          brand: 'Lenovo',
          assignedTo: { kind: 'warehouse', id: null },
          branchId: 'b_main',
        },
        before,
        { uid: 'u_2', role: 'asset_admin' },
        { category: { requiresMultilang: false } }
      );

      expect(mocks.capturedTx.updates).toHaveLength(1);
      const update = mocks.capturedTx.updates[0].data;
      expect(update).toMatchObject({
        name: 'A2',
        brand: 'Lenovo',
        updatedBy: 'u_2',
        updatedAt: 'SERVER_TS',
      });
      expect(update.inventoryCode).toBeUndefined();
      expect(update.categoryId).toBeUndefined();
      expect(update.statusId).toBeUndefined();
      expect(update.createdAt).toBeUndefined();
      expect(update.createdBy).toBeUndefined();
    });

    it('writes a single audit row with action="update"', async () => {
      await updateAsset(
        'a_1',
        {
          categoryId: 'device',
          name: 'A2',
          assignedTo: { kind: 'warehouse', id: null },
          branchId: 'b_main',
        },
        before,
        { uid: 'u_2', role: 'asset_admin' },
        { category: { requiresMultilang: false } }
      );

      const audit = mocks.capturedTx.sets[0].data;
      expect(audit.action).toBe('update');
      expect(audit.entity).toBe('asset');
      expect(audit.before).toMatchObject({ name: 'A' });
      expect(audit.after).toMatchObject({ name: 'A2' });
      // Immutable fields preserved in the audit `after` blob.
      expect(audit.after.inventoryCode).toBe('400/5');
      expect(audit.after.categoryId).toBe('device');
      expect(audit.after.statusId).toBe('warehouse');
    });

    it('rejects a missing actor', async () => {
      await expect(
        updateAsset('a_1', { categoryId: 'device', name: 'X' }, before, {})
      ).rejects.toThrow(/actor.uid/);
    });

    it('rejects a missing before snapshot', async () => {
      await expect(
        updateAsset('a_1', { categoryId: 'device', name: 'X' }, null, {
          uid: 'u_1',
          role: 'asset_admin',
        })
      ).rejects.toThrow(/before snapshot/);
    });
  });

  describe('setAssetStatus', () => {
    const before = {
      assetId: 'a_1',
      inventoryCode: '400/5',
      categoryId: 'device',
      statusId: 'warehouse',
      name: 'A',
      brand: 'ASUS',
      branchId: 'b_main',
      assignedTo: { kind: 'warehouse', id: null },
      notes: null,
      isActive: true,
    };

    it('updates statusId only and writes a status_change audit row', async () => {
      await setAssetStatus(
        'a_1',
        'in_repair',
        before,
        { uid: 'u_3', role: 'asset_admin' },
        { comment: 'Cracked screen' }
      );

      expect(mocks.capturedTx.updates).toHaveLength(1);
      expect(mocks.capturedTx.updates[0].data).toMatchObject({
        statusId: 'in_repair',
        updatedBy: 'u_3',
        updatedAt: 'SERVER_TS',
      });
      // Must NOT touch other fields.
      expect(mocks.capturedTx.updates[0].data.name).toBeUndefined();
      expect(mocks.capturedTx.updates[0].data.assignedTo).toBeUndefined();

      const audit = mocks.capturedTx.sets[0].data;
      expect(audit.action).toBe('status_change');
      expect(audit.meta).toMatchObject({
        fromStatusId: 'warehouse',
        toStatusId: 'in_repair',
        comment: 'Cracked screen',
      });
      expect(audit.before.statusId).toBe('warehouse');
      expect(audit.after.statusId).toBe('in_repair');
    });

    it('rejects a missing statusId', async () => {
      await expect(
        setAssetStatus('a_1', '', before, { uid: 'u_1', role: 'asset_admin' })
      ).rejects.toThrow(/statusId/);
    });

    it('rejects a missing actor', async () => {
      await expect(
        setAssetStatus('a_1', 'in_repair', before, {})
      ).rejects.toThrow(/actor.uid/);
    });

    it('rejects a missing before snapshot', async () => {
      await expect(
        setAssetStatus('a_1', 'in_repair', null, { uid: 'u_1', role: 'asset_admin' })
      ).rejects.toThrow(/before snapshot/);
    });
  });

  describe('subscriptions', () => {
    it('subscribeAssets attaches an onSnapshot listener', () => {
      const unsub = subscribeAssets(vi.fn());
      expect(unsub).toBe(mocks.onSnapshotUnsub);
    });

    it('subscribeAsset attaches an onSnapshot listener', () => {
      const unsub = subscribeAsset('a_1', vi.fn());
      expect(unsub).toBe(mocks.onSnapshotUnsub);
    });
  });
});
