import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock storage that the firebase/firestore mock will reach into.
const mocks = vi.hoisted(() => ({
  docCounter: 0,
  newDoc: () => ({ id: `doc_${++mocks.docCounter}` }),
  capturedTx: { sets: [], updates: [], deletes: [], gets: [] },
  // Per-doc "exists" map keyed by `${collection}/${id}`.
  preseed: new Map(),
  onSnapshotUnsub: vi.fn(),
  // Per-collection count returned by getCountFromServer. Tests overwrite
  // before invoking deleteAssetSubtype to simulate referenced state.
  countByCollection: { assets: 0 },
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((_dbOrCol, ...args) => {
    if (args.length === 0) {
      return mocks.newDoc();
    }
    const [coll, id] = args;
    return { id: args[args.length - 1], __ref: args, __path: `${coll}/${id}` };
  }),
  onSnapshot: vi.fn(() => mocks.onSnapshotUnsub),
  orderBy: vi.fn((field, dir) => ({ __order: [field, dir] })),
  query: vi.fn((coll, ...mods) => ({ __query: coll, mods })),
  where: vi.fn((field, op, value) => ({ __where: [field, op, value] })),
  getCountFromServer: vi.fn(async (q) => {
    const collName = q?.__query?.__collection;
    const count = mocks.countByCollection[collName] ?? 0;
    return { data: () => ({ count }) };
  }),
  runTransaction: vi.fn((_db, fn) => {
    mocks.capturedTx = { sets: [], updates: [], deletes: [], gets: [] };
    const tx = {
      get: vi.fn((ref) => {
        mocks.capturedTx.gets.push(ref);
        const data = mocks.preseed.get(ref.__path);
        return Promise.resolve({
          exists: () => data !== undefined,
          data: () => data,
          ref,
        });
      }),
      set: vi.fn((ref, data) => {
        mocks.capturedTx.sets.push({ ref, data });
      }),
      update: vi.fn((ref, data) => {
        mocks.capturedTx.updates.push({ ref, data });
      }),
      delete: vi.fn((ref) => {
        mocks.capturedTx.deletes.push({ ref });
      }),
    };
    return Promise.resolve(fn(tx));
  }),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
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
  createAssetSubtype,
  updateAssetSubtype,
  setAssetSubtypeActive,
  deleteAssetSubtype,
  subscribeAssetSubtypes,
  subscribeAssetSubtype,
  firestoreAssetSubtypeRepository,
} from '@/infra/repositories/firestoreAssetSubtypeRepository.js';
import {
  AssetSubtypeIdConflictError,
  AssetSubtypeReferencedError,
} from '@/domain/assetSubtypes.js';

beforeEach(() => {
  mocks.docCounter = 0;
  mocks.preseed.clear();
  mocks.countByCollection = { assets: 0 };
  mocks.capturedTx = { sets: [], updates: [], deletes: [], gets: [] };
  auditMocks.newAuditLogRef.mockClear();
  auditMocks.buildAuditLog.mockClear();
  auditMocks.newAuditLogRef.mockImplementation(() => ({ id: 'audit_1' }));
  auditMocks.buildAuditLog.mockImplementation((args) => ({ __audit: true, ...args }));
});

describe('firestoreAssetSubtypeRepository', () => {
  it('exports an adapter object matching the port shape', () => {
    expect(firestoreAssetSubtypeRepository).toMatchObject({
      list: expect.any(Function),
      get: expect.any(Function),
      create: expect.any(Function),
      update: expect.any(Function),
      setActive: expect.any(Function),
      delete: expect.any(Function),
    });
    expect(Object.isFrozen(firestoreAssetSubtypeRepository)).toBe(true);
  });

  describe('createAssetSubtype', () => {
    it('writes the subtype doc and an audit_logs entry in one transaction', async () => {
      const id = await createAssetSubtype(
        {
          categoryId: 'device',
          name: 'Server',
          requiresMultilang: false,
        },
        { uid: 'u_1', role: 'super_admin' },
        { id: 'device_server' }
      );
      expect(id).toBe('device_server');
      expect(mocks.capturedTx.sets).toHaveLength(2);

      const [subSet, auditSet] = mocks.capturedTx.sets;
      expect(subSet.data).toMatchObject({
        categoryId: 'device',
        name: { ru: 'Server', en: 'Server', hy: 'Server' },
        requiresMultilang: false,
        attachableTo: [],
        sortOrder: 0,
        isActive: true,
        createdBy: 'u_1',
        updatedBy: 'u_1',
        createdAt: 'SERVER_TS',
        updatedAt: 'SERVER_TS',
      });
      expect(auditSet.data).toMatchObject({
        entity: 'asset_subtype',
        entityId: 'device_server',
        action: 'create',
        actorUid: 'u_1',
        actorRole: 'super_admin',
        before: null,
      });
      expect(auditSet.data.after).toMatchObject({
        categoryId: 'device',
        name: { ru: 'Server', en: 'Server', hy: 'Server' },
        requiresMultilang: false,
        attachableTo: [],
        sortOrder: 0,
        isActive: true,
      });
    });

    it('persists attachableTo for license subtypes', async () => {
      await createAssetSubtype(
        {
          categoryId: 'license',
          name: 'Windows OS',
          requiresMultilang: false,
          attachableTo: ['asset'],
          sortOrder: 10,
        },
        { uid: 'u_1', role: 'super_admin' },
        { id: 'license_windows' }
      );
      expect(mocks.capturedTx.sets[0].data.attachableTo).toEqual(['asset']);
      expect(mocks.capturedTx.sets[0].data.sortOrder).toBe(10);
    });

    it('throws AssetSubtypeIdConflictError when the id already exists', async () => {
      mocks.preseed.set('asset_subtypes/device_laptop', {
        categoryId: 'device',
        name: { ru: 'Laptop', en: 'Laptop', hy: 'Laptop' },
        requiresMultilang: false,
        attachableTo: null,
        sortOrder: 1,
        isActive: true,
      });
      await expect(
        createAssetSubtype(
          { categoryId: 'device', name: 'Laptop' },
          { uid: 'u_1', role: 'super_admin' },
          { id: 'device_laptop' }
        )
      ).rejects.toBeInstanceOf(AssetSubtypeIdConflictError);
    });

    it('rejects a missing actor', async () => {
      await expect(
        createAssetSubtype(
          { categoryId: 'device', name: 'Laptop' },
          {},
          { id: 'device_laptop' }
        )
      ).rejects.toThrow(/actor.uid/);
    });

    it('rejects a missing options.id', async () => {
      await expect(
        createAssetSubtype(
          { categoryId: 'device', name: 'Laptop' },
          { uid: 'u_1', role: 'super_admin' }
        )
      ).rejects.toThrow(/options\.id/);
    });
  });

  describe('updateAssetSubtype', () => {
    it('writes a tx update + audit_logs row with before/after diff', async () => {
      const before = {
        subtypeId: 'device_laptop',
        categoryId: 'device',
        name: { ru: 'Laptop', en: 'Laptop', hy: 'Laptop' },
        requiresMultilang: false,
        attachableTo: null,
        sortOrder: 1,
        isActive: true,
      };
      await updateAssetSubtype(
        'device_laptop',
        { name: 'Notebook' },
        before,
        { uid: 'u_2', role: 'super_admin' }
      );

      expect(mocks.capturedTx.updates).toHaveLength(1);
      expect(mocks.capturedTx.sets).toHaveLength(1); // audit log

      const update = mocks.capturedTx.updates[0];
      expect(update.data).toMatchObject({
        name: { ru: 'Notebook', en: 'Notebook', hy: 'Notebook' },
        updatedBy: 'u_2',
        updatedAt: 'SERVER_TS',
      });
      // updateAssetSubtype must NOT touch createdAt / createdBy.
      expect(update.data.createdAt).toBeUndefined();
      expect(update.data.createdBy).toBeUndefined();

      const audit = mocks.capturedTx.sets[0].data;
      expect(audit).toMatchObject({
        action: 'update',
        entity: 'asset_subtype',
      });
      expect(audit.before.name).toEqual({ ru: 'Laptop', en: 'Laptop', hy: 'Laptop' });
      expect(audit.after.name).toEqual({ ru: 'Notebook', en: 'Notebook', hy: 'Notebook' });
    });

    it('rejects a missing actor', async () => {
      const before = {
        subtypeId: 'device_laptop',
        categoryId: 'device',
        name: { ru: 'Laptop', en: 'Laptop', hy: 'Laptop' },
        requiresMultilang: false,
        attachableTo: null,
        sortOrder: 1,
        isActive: true,
      };
      await expect(
        updateAssetSubtype('device_laptop', { name: 'Notebook' }, before, {})
      ).rejects.toThrow(/actor.uid/);
    });

    it('rejects a missing before snapshot', async () => {
      await expect(
        updateAssetSubtype(
          'device_laptop',
          { name: 'Notebook' },
          null,
          { uid: 'u_1', role: 'super_admin' }
        )
      ).rejects.toThrow(/before snapshot/);
    });
  });

  describe('setAssetSubtypeActive', () => {
    it('writes deactivate audit when isActive flips to false', async () => {
      const before = {
        subtypeId: 'device_laptop',
        categoryId: 'device',
        name: { ru: 'Laptop', en: 'Laptop', hy: 'Laptop' },
        requiresMultilang: false,
        attachableTo: null,
        sortOrder: 1,
        isActive: true,
      };
      await setAssetSubtypeActive('device_laptop', false, before, {
        uid: 'u_2',
        role: 'super_admin',
      });

      expect(mocks.capturedTx.updates).toHaveLength(1);
      expect(mocks.capturedTx.updates[0].data).toMatchObject({
        isActive: false,
        updatedBy: 'u_2',
        updatedAt: 'SERVER_TS',
      });
      const audit = mocks.capturedTx.sets[0].data;
      expect(audit.action).toBe('deactivate');
      expect(audit.entity).toBe('asset_subtype');
      expect(audit.before.isActive).toBe(true);
      expect(audit.after.isActive).toBe(false);
    });

    it('writes activate audit when isActive flips to true', async () => {
      const before = {
        subtypeId: 'device_laptop',
        categoryId: 'device',
        name: { ru: 'Laptop', en: 'Laptop', hy: 'Laptop' },
        requiresMultilang: false,
        attachableTo: null,
        sortOrder: 1,
        isActive: false,
      };
      await setAssetSubtypeActive('device_laptop', true, before, {
        uid: 'u_3',
        role: 'super_admin',
      });
      expect(mocks.capturedTx.sets[0].data.action).toBe('activate');
      expect(mocks.capturedTx.updates[0].data.isActive).toBe(true);
    });

    it('rejects a missing actor', async () => {
      await expect(
        setAssetSubtypeActive('device_laptop', false, { isActive: true }, {})
      ).rejects.toThrow(/actor.uid/);
    });

    it('rejects a missing before snapshot', async () => {
      await expect(
        setAssetSubtypeActive('device_laptop', false, null, {
          uid: 'u_1',
          role: 'super_admin',
        })
      ).rejects.toThrow(/before snapshot/);
    });
  });

  describe('deleteAssetSubtype', () => {
    const before = {
      subtypeId: 'device_laptop',
      categoryId: 'device',
      name: { ru: 'Laptop', en: 'Laptop', hy: 'Laptop' },
      requiresMultilang: false,
      attachableTo: null,
      sortOrder: 1,
      isActive: true,
    };

    it('deletes the subtype doc and writes a deleted audit row in one transaction', async () => {
      mocks.countByCollection = { assets: 0 };
      await deleteAssetSubtype('device_laptop', before, {
        uid: 'u_super',
        role: 'super_admin',
      });

      expect(mocks.capturedTx.deletes).toHaveLength(1);
      const deletedRefs = mocks.capturedTx.deletes[0].ref?.__ref ?? [];
      expect(deletedRefs).toContain('asset_subtypes');
      expect(deletedRefs).toContain('device_laptop');

      // One tx.set for the audit row only.
      expect(mocks.capturedTx.sets).toHaveLength(1);
      const audit = mocks.capturedTx.sets[0].data;
      expect(audit).toMatchObject({
        __audit: true,
        entity: 'asset_subtype',
        entityId: 'device_laptop',
        action: 'deleted',
        actorUid: 'u_super',
        actorRole: 'super_admin',
        after: null,
      });
      expect(audit.before).toMatchObject({
        categoryId: 'device',
        name: before.name,
        attachableTo: null,
        sortOrder: 1,
        isActive: true,
      });
    });

    it('throws AssetSubtypeReferencedError when assets reference this subtype (no writes)', async () => {
      mocks.countByCollection = { assets: 4 };
      await expect(
        deleteAssetSubtype('device_laptop', before, {
          uid: 'u_super',
          role: 'super_admin',
        })
      ).rejects.toBeInstanceOf(AssetSubtypeReferencedError);
      expect(mocks.capturedTx.deletes).toHaveLength(0);
      expect(mocks.capturedTx.sets).toHaveLength(0);
    });

    it('AssetSubtypeReferencedError carries the asset count', async () => {
      mocks.countByCollection = { assets: 7 };
      try {
        await deleteAssetSubtype('device_laptop', before, {
          uid: 'u_super',
          role: 'super_admin',
        });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(AssetSubtypeReferencedError);
        expect(err.assetCount).toBe(7);
        expect(err.id).toBe('device_laptop');
      }
    });

    it('rejects a missing actor', async () => {
      await expect(
        deleteAssetSubtype('device_laptop', before, {})
      ).rejects.toThrow(/actor.uid/);
    });

    it('rejects a missing before snapshot', async () => {
      await expect(
        deleteAssetSubtype('device_laptop', null, {
          uid: 'u_super',
          role: 'super_admin',
        })
      ).rejects.toThrow(/before snapshot/);
    });
  });

  describe('subscribeAssetSubtypes', () => {
    it('attaches an onSnapshot listener and returns the unsubscribe', () => {
      const onData = vi.fn();
      const unsub = subscribeAssetSubtypes(onData);
      expect(unsub).toBe(mocks.onSnapshotUnsub);
    });
  });

  describe('subscribeAssetSubtype', () => {
    it('attaches an onSnapshot listener for a single doc', () => {
      const onData = vi.fn();
      const unsub = subscribeAssetSubtype('device_laptop', onData);
      expect(unsub).toBe(mocks.onSnapshotUnsub);
    });
  });
});
