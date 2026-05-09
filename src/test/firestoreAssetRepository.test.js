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
  // Wave-A: per-id subtype docs returned by `tx.get(doc(db, 'asset_subtypes', id))`.
  // Default seeds a generic device-laptop subtype so every existing test
  // continues to pass without touching its assertions.
  subtypes: new Map([
    [
      'device_laptop',
      {
        categoryId: 'device',
        attachableTo: null,
        isActive: true,
        name: 'Laptop',
      },
    ],
  ]),
  // Wave-A: per-id asset docs (used when assignedTo.kind = 'asset').
  assets: new Map(),
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
        const id = Array.isArray(ref?.__ref) ? ref.__ref[1] : null;
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
  // Reset subtype catalog to the default seed.
  mocks.subtypes = new Map([
    [
      'device_laptop',
      {
        categoryId: 'device',
        attachableTo: null,
        isActive: true,
        name: 'Laptop',
      },
    ],
  ]);
  mocks.assets = new Map();
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
          subtypeId: 'device_laptop',
          brandId: 'brand_asus',
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
        brandId: 'brand_asus',
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
        brandId: 'brand_asus',
      });
    });

    it('two consecutive creates yield distinct inventory codes from a monotonic counter', async () => {
      mocks.counter = { exists: true, data: { next: 5 } };
      await createAsset(
        {
          categoryId: 'device',
          subtypeId: 'device_laptop',
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
          subtypeId: 'device_laptop',
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
            subtypeId: 'device_laptop',
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
            subtypeId: 'device_laptop',
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
            subtypeId: 'device_laptop',
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
          brandId: 'brand_lenovo',
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
        brandId: 'brand_lenovo',
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
          brandId: 'brand_lenovo',
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
      expect(audit.before).toMatchObject({ brandId: null });
      expect(audit.after).toMatchObject({ brandId: 'brand_lenovo' });
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

describe('firestoreAssetRepository — subtype + condition + warranty + asset-target invariants', () => {
  it('persists subtypeId, condition, warrantyStart, warrantyEnd on create', async () => {
    const start = new Date('2027-01-01T00:00:00Z');
    const end = new Date('2028-01-01T00:00:00Z');
    const id = await createAsset(
      {
        categoryId: 'device',
        subtypeId: 'device_laptop',
        name: 'X',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b_main',
        statusId: 'warehouse',
        condition: 'new',
        warrantyStart: start,
        warrantyEnd: end,
      },
      { uid: 'u_1', role: 'super_admin' },
      { category: { requiresMultilang: false } }
    );

    expect(typeof id).toBe('string');

    const [assetSet, auditSet] = mocks.capturedTx.sets;
    expect(assetSet.data).toMatchObject({
      subtypeId: 'device_laptop',
      condition: 'new',
      warrantyStart: { __ts: start.valueOf() },
      warrantyEnd: { __ts: end.valueOf() },
    });

    expect(auditSet.data.after).toMatchObject({
      subtypeId: 'device_laptop',
      condition: 'new',
    });
    // Audit snapshot stores Date-equivalents (Date or millis), not Firestore
    // Timestamps. Assert they round-trip.
    expect(auditSet.data.after.warrantyStart).toBeTruthy();
    expect(auditSet.data.after.warrantyEnd).toBeTruthy();
  });

  it('coerces warranty fields to null when condition is used', async () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2027-01-01T00:00:00Z');
    await createAsset(
      {
        categoryId: 'device',
        subtypeId: 'device_laptop',
        name: 'Y',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b_main',
        statusId: 'warehouse',
        condition: 'used',
        warrantyStart: start,
        warrantyEnd: end,
      },
      { uid: 'u_1', role: 'super_admin' },
      { category: { requiresMultilang: false } }
    );

    const [assetSet] = mocks.capturedTx.sets;
    expect(assetSet.data.condition).toBe('used');
    expect(assetSet.data.warrantyStart).toBeNull();
    expect(assetSet.data.warrantyEnd).toBeNull();
  });

  it('rejects employee assignment when subtype.attachableTo does not include employee', async () => {
    // Pre-seed a license-os subtype that only allows attachment to assets.
    mocks.subtypes.set('license_os', {
      categoryId: 'license',
      attachableTo: ['asset'],
      isActive: true,
      name: 'Operating System',
    });

    await expect(
      createAsset(
        {
          categoryId: 'license',
          subtypeId: 'license_os',
          name: 'OS license',
          assignedTo: { kind: 'employee', id: 'emp_1' },
          statusId: 'warehouse',
          condition: 'new',
        },
        { uid: 'u_1', role: 'super_admin' },
        { category: { requiresMultilang: false } }
      )
    ).rejects.toThrow(/invariant|errorAssignedKindNotAllowed|attachable/i);
  });

  it('accepts asset-kind assignment for license + valid subtype', async () => {
    // Pre-seed a license subtype that allows asset + employee.
    mocks.subtypes.set('license_office_suite', {
      categoryId: 'license',
      attachableTo: ['asset', 'employee'],
      isActive: true,
      name: 'Office Suite',
    });
    // Pre-seed the target device the license attaches to.
    mocks.assets.set('asset_target', {
      assetId: 'asset_target',
      categoryId: 'device',
      isActive: true,
    });

    const id = await createAsset(
      {
        categoryId: 'license',
        subtypeId: 'license_office_suite',
        name: 'Office Pro Plus',
        assignedTo: { kind: 'asset', id: 'asset_target' },
        statusId: 'warehouse',
        condition: 'new',
        licenseType: 'business',
        subscribedAt: new Date('2026-01-01'),
        expiresAt: new Date('2027-01-01'),
      },
      { uid: 'u_1', role: 'super_admin' },
      { category: { requiresMultilang: false } }
    );

    expect(typeof id).toBe('string');
    const [assetSet] = mocks.capturedTx.sets;
    expect(assetSet.data.assignedTo).toEqual({ kind: 'asset', id: 'asset_target' });
    expect(assetSet.data.subtypeId).toBe('license_office_suite');
  });

  it('rejects when subtype is missing or inactive', async () => {
    // No 'license_unknown' in mocks.subtypes -> AssetSubtypeInactiveError.
    await expect(
      createAsset(
        {
          categoryId: 'license',
          subtypeId: 'license_unknown',
          name: 'X',
          assignedTo: { kind: 'warehouse', id: null },
          branchId: 'b_main',
          statusId: 'warehouse',
          condition: 'new',
        },
        { uid: 'u_1', role: 'super_admin' },
        { category: { requiresMultilang: false } }
      )
    ).rejects.toThrow(/inactive|missing/i);
  });
});

describe('firestoreAssetRepository — license categories skip counter', () => {
  // Each test sets up a license category with assignsInventoryCode: false.
  // We do this by overriding mocks.category and seeding mocks.subtypes.
  // The tx.get mock branches on ref.__ref[0] (path) → returns mocks.category
  // for 'categories', mocks.subtypes.get(id) for 'asset_subtypes'.
  // The 'category_counters' branch is never reached when wantsCode === false.

  // Licenses can only be assigned to 'asset' or 'employee' — never to
  // warehouse, branch, or department. Use 'employee' as the valid holder.
  const licenseInput = {
    categoryId: 'license',
    subtypeId: 'license_windows',
    statusId: 'assigned',
    assignedTo: { kind: 'employee', id: 'emp-1' },
    branchId: null,
    condition: 'new',
    licenseType: 'business',
    subscribedAt: new Date('2026-01-01'),
    expiresAt: new Date('2027-01-01'),
  };

  beforeEach(() => {
    mocks.category = {
      exists: true,
      data: {
        categoryId: 'license',
        inventoryCodePrefix: 'LIC',
        assignsInventoryCode: false,
        isActive: true,
        requiresMultilang: false,
        attachableTo: ['asset', 'employee'],
      },
    };
    mocks.subtypes.set('license_windows', {
      categoryId: 'license',
      attachableTo: ['asset', 'employee'],
      isActive: true,
      name: 'Windows',
    });
  });

  it('does NOT touch category_counters when category.assignsInventoryCode === false', async () => {
    await createAsset(licenseInput, { uid: 'u1', role: 'super_admin' }, { category: { requiresMultilang: false } });

    const counterUpdate = mocks.capturedTx.updates.find(
      (u) => Array.isArray(u.ref?.__ref) && u.ref.__ref[0] === 'category_counters'
    );
    expect(counterUpdate).toBeUndefined();
  });

  it('writes inventoryCode=null on the asset doc when category opts out', async () => {
    await createAsset(licenseInput, { uid: 'u1', role: 'super_admin' }, { category: { requiresMultilang: false } });

    const assetSet = mocks.capturedTx.sets.find(
      (s) => s.data?.categoryId === 'license'
    );
    expect(assetSet).toBeDefined();
    expect(assetSet.data.inventoryCode).toBeNull();
  });

  it('writes the license-secret doc inside the same transaction when licenseKey provided', async () => {
    await createAsset(
      { ...licenseInput, licenseKey: 'TOP-SECRET-VALUE' },
      { uid: 'u1', role: 'super_admin' },
      { category: { requiresMultilang: false } }
    );

    // asset doc + asset audit + secret doc + secret audit = 4 sets minimum
    expect(mocks.capturedTx.sets.length).toBeGreaterThanOrEqual(3);

    // The secret doc ref must point to assets/{id}/secrets/key
    const secretSet = mocks.capturedTx.sets.find(
      (s) =>
        Array.isArray(s.ref?.__ref) &&
        s.ref.__ref.includes('secrets') &&
        s.ref.__ref.includes('key')
    );
    expect(secretSet).toBeDefined();

    // Audit rows for license_key_set must NOT contain the raw key value —
    // only the asset doc itself carries the value (in the secret subcollection).
    const licenseKeyAuditSet = mocks.capturedTx.sets.find(
      (s) => s.data?.action === 'license_key_set'
    );
    expect(licenseKeyAuditSet).toBeDefined();
    expect(JSON.stringify(licenseKeyAuditSet.data)).not.toContain('TOP-SECRET-VALUE');
    expect(licenseKeyAuditSet.data.before).toEqual({ licenseKeySet: false });
    expect(licenseKeyAuditSet.data.after).toEqual({ licenseKeySet: true });

    // Issue 2: Asset doc body must NOT carry licenseKey or the raw value.
    // The asset doc ref is created via doc(collection(...)) → mocks.newDoc(),
    // which returns { id: 'doc_N' } with no __ref. The secret doc ref is created
    // via doc(db, 'assets', id, 'secrets', 'key') → has __ref. Distinguish by
    // looking for the set whose ref has no __ref and whose data.categoryId matches.
    const assetDocSet = mocks.capturedTx.sets.find(
      (s) => !s.ref?.__ref && s.data?.categoryId === 'license'
    );
    expect(assetDocSet).toBeDefined();
    expect(assetDocSet.data).not.toHaveProperty('licenseKey');
    expect(JSON.stringify(assetDocSet.data)).not.toContain('TOP-SECRET-VALUE');

    // Issue 2b: License dates must appear as numeric millis in the create-audit row,
    // not null (regression guard for the auditSnapshot Date-vs-Timestamp fix).
    const createAuditSet = mocks.capturedTx.sets.find(
      (s) => s.data?.entity === 'asset' && s.data?.action === 'create'
    );
    expect(createAuditSet).toBeDefined();
    expect(createAuditSet.data.after.subscribedAt).toBe(new Date('2026-01-01').valueOf());
    expect(createAuditSet.data.after.expiresAt).toBe(new Date('2027-01-01').valueOf());
  });
});

describe('firestoreAssetRepository — auditSnapshot omits brand/model strings', () => {
  it('audit before/after never contain free-text brand/model fields', async () => {
    // Use the default device category (assignsInventoryCode defaults to true
    // because the field is absent → wantsCode = true).
    // mocks.category is already { inventoryCodePrefix: '400', isActive: true }
    // from the outer beforeEach. No override needed.

    await createAsset(
      {
        categoryId: 'device',
        subtypeId: 'device_laptop',
        statusId: 'warehouse',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: 'b1',
        condition: 'new',
        brandId: 'hp',
        modelId: 'hp_elitebook',
      },
      { uid: 'u1', role: 'super_admin' },
      { category: { requiresMultilang: false } }
    );

    // buildAuditLog is mocked to pass args through, so the set data carries
    // the raw args including `after`. Find the create audit set.
    const auditSet = mocks.capturedTx.sets.find(
      (s) => s.data?.entity === 'asset' && s.data?.action === 'create'
    );
    expect(auditSet).toBeDefined();
    expect(auditSet.data.after).toBeDefined();
    expect('brand' in auditSet.data.after).toBe(false);
    expect('model' in auditSet.data.after).toBe(false);
    expect(auditSet.data.after.brandId).toBe('hp');
    expect(auditSet.data.after.modelId).toBe('hp_elitebook');
  });
});
