import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock storage that the firebase/firestore mock will reach into.
const mocks = vi.hoisted(() => ({
  docCounter: 0,
  newDoc: () => ({ id: `doc_${++mocks.docCounter}` }),
  capturedTx: { sets: [], updates: [], deletes: [], gets: [] },
  onSnapshotUnsub: vi.fn(),
  // Per-collection count returned by getCountFromServer. Tests overwrite
  // before invoking deleteCategory to simulate referenced/unreferenced state.
  countByCollection: { assets: 0, asset_subtypes: 0 },
  // Per-collection doc list returned by getDocs. Tests overwrite before
  // invoking deleteCategory to simulate cascade-delete payloads.
  docsByCollection: { asset_subtypes: [] },
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((_dbOrCol, ...args) => {
    if (args.length === 0) {
      return mocks.newDoc();
    }
    return { id: args[args.length - 1], __ref: args };
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
  getDocs: vi.fn(async (q) => {
    const collName = q?.__query?.__collection;
    const items = mocks.docsByCollection[collName] ?? [];
    return {
      docs: items.map((item) => ({
        id: item.id,
        ref: { id: item.id, __ref: [collName, item.id] },
        data: () => item.data,
      })),
    };
  }),
  runTransaction: vi.fn((_db, fn) => {
    mocks.capturedTx = { sets: [], updates: [], deletes: [], gets: [] };
    const tx = {
      get: vi.fn((ref) => {
        mocks.capturedTx.gets.push(ref);
        return Promise.resolve({ exists: () => false, data: () => undefined, ref });
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

const auditMocks = vi.hoisted(() => {
  let n = 0;
  return {
    counter: 0,
    newAuditLogRef: vi.fn(() => ({ id: `audit_${++n}` })),
    buildAuditLog: vi.fn((args) => ({ __audit: true, ...args })),
    reset() {
      n = 0;
    },
  };
});
vi.mock('@/lib/audit/auditHelper.js', () => auditMocks);

import {
  createCategory,
  updateCategory,
  setCategoryActive,
  deleteCategory,
  subscribeCategories,
  subscribeCategory,
  firestoreCategoryRepository,
} from '@/infra/repositories/firestoreCategoryRepository.js';
import {
  CategoryIdConflictError,
  CategoryReferencedError,
} from '@/domain/categories.js';

beforeEach(() => {
  mocks.docCounter = 0;
  mocks.countByCollection = { assets: 0, asset_subtypes: 0 };
  mocks.docsByCollection = { asset_subtypes: [] };
  mocks.capturedTx = { sets: [], updates: [], deletes: [], gets: [] };
  auditMocks.reset();
  auditMocks.newAuditLogRef.mockClear();
  auditMocks.buildAuditLog.mockClear();
  let n = 0;
  auditMocks.newAuditLogRef.mockImplementation(() => ({ id: `audit_${++n}` }));
  auditMocks.buildAuditLog.mockImplementation((args) => ({ __audit: true, ...args }));
});

describe('firestoreCategoryRepository', () => {
  it('exports an adapter object matching the port shape', () => {
    expect(firestoreCategoryRepository).toMatchObject({
      list: expect.any(Function),
      get: expect.any(Function),
      create: expect.any(Function),
      update: expect.any(Function),
      setActive: expect.any(Function),
      delete: expect.any(Function),
    });
    expect(Object.isFrozen(firestoreCategoryRepository)).toBe(true);
  });

  describe('createCategory', () => {
    it('writes category doc, audit_logs, counter doc and counter_initialized audit in one transaction', async () => {
      const id = await createCategory(
        {
          name: { ru: 'Мебель', en: 'Furniture', hy: 'Կահույք' },
          inventoryCodePrefix: '500',
          requiresMultilang: true,
          isActive: true,
        },
        { uid: 'u_123', role: 'super_admin' }
      );

      expect(typeof id).toBe('string');
      // 4 writes: category doc, create-audit, counter doc, counter-init audit.
      expect(mocks.capturedTx.sets).toHaveLength(4);

      const [catSet, auditSet, counterSet, counterAuditSet] = mocks.capturedTx.sets;
      expect(catSet.data).toMatchObject({
        name: { ru: 'Мебель', en: 'Furniture', hy: 'Կահույք' },
        inventoryCodePrefix: '500',
        requiresMultilang: true,
        isActive: true,
        createdBy: 'u_123',
        updatedBy: 'u_123',
        createdAt: 'SERVER_TS',
        updatedAt: 'SERVER_TS',
      });
      expect(catSet.data.categoryId).toBe(id);

      expect(auditSet.data).toMatchObject({
        __audit: true,
        entity: 'category',
        entityId: id,
        action: 'create',
        actorUid: 'u_123',
        actorRole: 'super_admin',
        before: null,
      });
      // Audit `after` blob must NOT contain server-timestamp sentinels.
      expect(auditSet.data.after).toEqual({
        name: { ru: 'Мебель', en: 'Furniture', hy: 'Կահույք' },
        inventoryCodePrefix: '500',
        requiresMultilang: true,
        assignsInventoryCode: true,
        isActive: true,
      });

      // Counter doc seeded with next=1.
      expect(counterSet.data).toMatchObject({
        next: 1,
        updatedAt: 'SERVER_TS',
      });

      // Counter-init audit row.
      expect(counterAuditSet.data).toMatchObject({
        __audit: true,
        entity: 'category',
        entityId: id,
        action: 'counter_initialized',
        actorUid: 'u_123',
        actorRole: 'super_admin',
      });
      expect(counterAuditSet.data.after).toEqual({ next: 1 });
    });

    it('uses the supplied id when options.id is set', async () => {
      const id = await createCategory(
        {
          name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
          inventoryCodePrefix: '400',
          requiresMultilang: false,
          isActive: true,
        },
        { uid: 'u_1', role: 'super_admin' },
        { id: 'device' }
      );
      expect(id).toBe('device');
      expect(mocks.capturedTx.sets[0].data.categoryId).toBe('device');
    });

    it('throws CategoryIdConflictError when options.id targets an existing doc', async () => {
      // Hoisted mock returns exists() === false by default; flip it for
      // this single tx invocation.
      const { runTransaction } = await import('firebase/firestore');
      runTransaction.mockImplementationOnce(async (_db, fn) => {
        mocks.capturedTx = { sets: [], updates: [], gets: [] };
        const tx = {
          get: vi.fn(() =>
            Promise.resolve({
              exists: () => true,
              data: () => ({ categoryId: 'device' }),
            })
          ),
          set: vi.fn(),
          update: vi.fn(),
        };
        return fn(tx);
      });

      await expect(
        createCategory(
          {
            name: { ru: 'Дубликат', en: 'Dup', hy: 'Կրկնակի' },
            inventoryCodePrefix: '400',
            requiresMultilang: false,
          },
          { uid: 'u_1', role: 'super_admin' },
          { id: 'device' }
        )
      ).rejects.toBeInstanceOf(CategoryIdConflictError);
    });

    it('mirrors the single-language name across all three locales when requiresMultilang=false', async () => {
      await createCategory(
        {
          name: { ru: 'Лицензии', en: '', hy: '' },
          inventoryCodePrefix: 'LIC',
          requiresMultilang: false,
        },
        { uid: 'u_1', role: 'super_admin' },
        { id: 'license' }
      );
      expect(mocks.capturedTx.sets[0].data.name).toEqual({
        ru: 'Лицензии',
        en: 'Лицензии',
        hy: 'Лицензии',
      });
    });

    it('uppercases a lowercase prefix at write time', async () => {
      await createCategory(
        {
          name: { ru: 'a', en: 'b', hy: 'c' },
          inventoryCodePrefix: 'lic',
          requiresMultilang: true,
        },
        { uid: 'u_1', role: 'super_admin' }
      );
      expect(mocks.capturedTx.sets[0].data.inventoryCodePrefix).toBe('LIC');
    });

    it('rejects a missing actor', async () => {
      await expect(
        createCategory(
          { name: { ru: 'a', en: 'b', hy: 'c' }, inventoryCodePrefix: '400' },
          {}
        )
      ).rejects.toThrow(/actor.uid/);
    });

    it('sanitizes input (trims whitespace)', async () => {
      await createCategory(
        {
          name: { ru: '  Мебель  ', en: '  Furniture  ', hy: '  Կահույք  ' },
          inventoryCodePrefix: '  500  ',
          requiresMultilang: true,
        },
        { uid: 'u_1', role: 'super_admin' }
      );
      expect(mocks.capturedTx.sets[0].data.name).toEqual({
        ru: 'Мебель',
        en: 'Furniture',
        hy: 'Կահույք',
      });
      expect(mocks.capturedTx.sets[0].data.inventoryCodePrefix).toBe('500');
    });
  });

  describe('updateCategory', () => {
    it('writes a tx update + audit_logs row with before/after diff', async () => {
      const before = {
        categoryId: 'device',
        name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
        inventoryCodePrefix: '400',
        requiresMultilang: false,
        isActive: true,
      };
      await updateCategory(
        'device',
        {
          name: { ru: 'Девайс', en: 'Device', hy: 'Սարք' },
          inventoryCodePrefix: '401',
          requiresMultilang: true,
          isActive: true,
        },
        before,
        { uid: 'u_2', role: 'super_admin' }
      );

      expect(mocks.capturedTx.updates).toHaveLength(1);
      expect(mocks.capturedTx.sets).toHaveLength(1); // audit log

      const update = mocks.capturedTx.updates[0];
      expect(update.data).toMatchObject({
        name: { ru: 'Девайс', en: 'Device', hy: 'Սարք' },
        inventoryCodePrefix: '401',
        requiresMultilang: true,
        updatedBy: 'u_2',
        updatedAt: 'SERVER_TS',
      });
      // updateCategory must NOT touch createdAt / createdBy.
      expect(update.data.createdAt).toBeUndefined();
      expect(update.data.createdBy).toBeUndefined();

      const audit = mocks.capturedTx.sets[0].data;
      expect(audit).toMatchObject({
        action: 'update',
        before: {
          name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
          inventoryCodePrefix: '400',
          requiresMultilang: false,
        },
        after: {
          name: { ru: 'Девайс', en: 'Device', hy: 'Սարք' },
          inventoryCodePrefix: '401',
          requiresMultilang: true,
        },
      });
    });

    it('rejects a missing actor', async () => {
      const before = {
        categoryId: 'device',
        name: { ru: 'a', en: 'b', hy: 'c' },
        inventoryCodePrefix: '400',
        requiresMultilang: true,
        isActive: true,
      };
      await expect(
        updateCategory(
          'device',
          { name: { ru: 'a', en: 'b', hy: 'c' }, inventoryCodePrefix: '400' },
          before,
          {}
        )
      ).rejects.toThrow(/actor.uid/);
    });

    it('rejects a missing before snapshot', async () => {
      await expect(
        updateCategory(
          'device',
          { name: { ru: 'a', en: 'b', hy: 'c' }, inventoryCodePrefix: '400' },
          null,
          { uid: 'u_1', role: 'super_admin' }
        )
      ).rejects.toThrow(/before snapshot/);
    });

    it('does NOT touch category_counters/{id} on update', async () => {
      const before = {
        categoryId: 'device',
        name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
        inventoryCodePrefix: '400',
        requiresMultilang: false,
        isActive: true,
      };
      await updateCategory(
        'device',
        {
          name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
          inventoryCodePrefix: '401',
          requiresMultilang: false,
          isActive: true,
        },
        before,
        { uid: 'u_2', role: 'super_admin' }
      );

      // Only the audit_logs row is set (the cat doc is updated, not set).
      // Critically, no `category_counters/{...}` write must appear.
      expect(mocks.capturedTx.sets).toHaveLength(1);
      const refsTouched = mocks.capturedTx.sets
        .map((s) => s.ref?.__ref ?? [])
        .concat(mocks.capturedTx.updates.map((u) => u.ref?.__ref ?? []));
      const flat = refsTouched.flat();
      expect(flat.includes('category_counters')).toBe(false);
    });

    it('flipping isActive via update writes an audit row through the same helper', async () => {
      // The "active toggle" flow uses setCategoryActive(), but this test
      // confirms the update() path also routes through buildAuditLog —
      // i.e. the audit invariant holds for any mutation, not just setActive.
      const before = {
        categoryId: 'device',
        name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
        inventoryCodePrefix: '400',
        requiresMultilang: false,
        isActive: true,
      };
      await updateCategory(
        'device',
        {
          name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
          inventoryCodePrefix: '400',
          requiresMultilang: false,
          isActive: false,
        },
        before,
        { uid: 'u_2', role: 'super_admin' }
      );

      expect(auditMocks.buildAuditLog).toHaveBeenCalledTimes(1);
      const auditCall = auditMocks.buildAuditLog.mock.calls[0][0];
      expect(auditCall.action).toBe('update');
      expect(auditCall.before.isActive).toBe(true);
      expect(auditCall.after.isActive).toBe(false);
    });
  });

  describe('setCategoryActive', () => {
    it('writes deactivate audit when isActive flips to false', async () => {
      const before = {
        categoryId: 'device',
        name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
        inventoryCodePrefix: '400',
        requiresMultilang: false,
        isActive: true,
      };
      await setCategoryActive('device', false, before, { uid: 'u_2', role: 'super_admin' });

      expect(mocks.capturedTx.updates).toHaveLength(1);
      expect(mocks.capturedTx.updates[0].data).toMatchObject({
        isActive: false,
        updatedBy: 'u_2',
        updatedAt: 'SERVER_TS',
      });
      const audit = mocks.capturedTx.sets[0].data;
      expect(audit.action).toBe('deactivate');
      expect(audit.before.isActive).toBe(true);
      expect(audit.after.isActive).toBe(false);
    });

    it('writes activate audit when isActive flips to true', async () => {
      const before = {
        categoryId: 'device',
        name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
        inventoryCodePrefix: '400',
        requiresMultilang: false,
        isActive: false,
      };
      await setCategoryActive('device', true, before, { uid: 'u_3', role: 'super_admin' });
      expect(mocks.capturedTx.sets[0].data.action).toBe('activate');
      expect(mocks.capturedTx.updates[0].data.isActive).toBe(true);
    });

    it('rejects a missing actor', async () => {
      await expect(
        setCategoryActive('device', false, { isActive: true }, {})
      ).rejects.toThrow(/actor.uid/);
    });

    it('rejects a missing before snapshot', async () => {
      await expect(
        setCategoryActive('device', false, null, { uid: 'u_1', role: 'super_admin' })
      ).rejects.toThrow(/before snapshot/);
    });
  });

  describe('deleteCategory', () => {
    const before = {
      categoryId: 'device',
      name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
      inventoryCodePrefix: '400',
      requiresMultilang: false,
      isActive: true,
    };

    it('deletes the category doc, the counter doc, and writes a deleted audit row in one transaction', async () => {
      mocks.countByCollection = { assets: 0, asset_subtypes: 0 };
      await deleteCategory('device', before, {
        uid: 'u_super',
        role: 'super_admin',
      });

      // Two tx.delete calls: category doc + counter doc.
      expect(mocks.capturedTx.deletes).toHaveLength(2);
      const deletedRefs = mocks.capturedTx.deletes.map((d) => d.ref?.__ref ?? []);
      const flat = deletedRefs.flat();
      expect(flat).toContain('categories');
      expect(flat).toContain('category_counters');

      // One tx.set for the audit row only.
      expect(mocks.capturedTx.sets).toHaveLength(1);
      const audit = mocks.capturedTx.sets[0].data;
      expect(audit).toMatchObject({
        __audit: true,
        entity: 'category',
        entityId: 'device',
        action: 'deleted',
        actorUid: 'u_super',
        actorRole: 'super_admin',
        after: null,
      });
      expect(audit.before).toMatchObject({
        name: before.name,
        inventoryCodePrefix: '400',
        requiresMultilang: false,
        isActive: true,
      });
    });

    it('throws CategoryReferencedError when assets reference this category (no writes)', async () => {
      mocks.countByCollection = { assets: 3, asset_subtypes: 1 };
      await expect(
        deleteCategory('device', before, {
          uid: 'u_super',
          role: 'super_admin',
        })
      ).rejects.toBeInstanceOf(CategoryReferencedError);
      // No tx writes performed because pre-flight failed.
      expect(mocks.capturedTx.deletes).toHaveLength(0);
      expect(mocks.capturedTx.sets).toHaveLength(0);
    });

    it('cascades sub-type deletes when no assets reference the category', async () => {
      mocks.countByCollection = { assets: 0 };
      mocks.docsByCollection = {
        asset_subtypes: [
          {
            id: 'device_laptop',
            data: {
              categoryId: 'device',
              name: { ru: 'Ноутбук', en: 'Laptop', hy: 'Նոթբուք' },
              requiresMultilang: true,
              attachableTo: null,
              sortOrder: 1,
              isActive: true,
            },
          },
          {
            id: 'device_monitor',
            data: {
              categoryId: 'device',
              name: { ru: 'Монитор', en: 'Monitor', hy: 'Մոնիտոր' },
              requiresMultilang: true,
              attachableTo: null,
              sortOrder: 2,
              isActive: true,
            },
          },
        ],
      };

      await deleteCategory('device', before, {
        uid: 'u_super',
        role: 'super_admin',
      });

      // 2 subtypes + category + counter = 4 tx.delete calls.
      expect(mocks.capturedTx.deletes).toHaveLength(4);
      const flat = mocks.capturedTx.deletes
        .map((d) => d.ref?.__ref ?? [])
        .flat();
      expect(flat).toContain('asset_subtypes');
      expect(flat).toContain('categories');
      expect(flat).toContain('category_counters');

      // 3 audit rows: one per subtype + one for the category itself.
      expect(mocks.capturedTx.sets).toHaveLength(3);
      const subtypeAudits = mocks.capturedTx.sets
        .map((s) => s.data)
        .filter((a) => a.entity === 'asset_subtype');
      expect(subtypeAudits).toHaveLength(2);
      for (const audit of subtypeAudits) {
        expect(audit.action).toBe('deleted');
        expect(audit.actorUid).toBe('u_super');
        expect(audit.meta).toEqual({ cascadeFromCategory: 'device' });
        expect(audit.after).toBeNull();
      }
      const categoryAudit = mocks.capturedTx.sets
        .map((s) => s.data)
        .find((a) => a.entity === 'category');
      expect(categoryAudit).toMatchObject({
        action: 'deleted',
        meta: { cascadedSubtypeCount: 2 },
      });
    });

    it('CategoryReferencedError carries assetCount on the instance', async () => {
      mocks.countByCollection = { assets: 5 };
      try {
        await deleteCategory('device', before, {
          uid: 'u_super',
          role: 'super_admin',
        });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CategoryReferencedError);
        expect(err.assetCount).toBe(5);
        expect(err.id).toBe('device');
      }
    });

    it('rejects a missing actor', async () => {
      await expect(
        deleteCategory('device', before, {})
      ).rejects.toThrow(/actor.uid/);
    });

    it('rejects a missing before snapshot', async () => {
      await expect(
        deleteCategory('device', null, { uid: 'u_super', role: 'super_admin' })
      ).rejects.toThrow(/before snapshot/);
    });
  });

  describe('subscribeCategories', () => {
    it('attaches an onSnapshot listener and returns the unsubscribe', () => {
      const onData = vi.fn();
      const unsub = subscribeCategories(onData);
      expect(unsub).toBe(mocks.onSnapshotUnsub);
    });
  });

  describe('subscribeCategory', () => {
    it('attaches an onSnapshot listener for a single doc', () => {
      const onData = vi.fn();
      const unsub = subscribeCategory('device', onData);
      expect(unsub).toBe(mocks.onSnapshotUnsub);
    });
  });
});

describe('firestoreCategoryRepository — assignsInventoryCode persistence', () => {
  it('writes assignsInventoryCode=true on createCategory by default', async () => {
    await createCategory(
      {
        name: { ru: 'X', en: 'X', hy: 'X' },
        inventoryCodePrefix: 'X1',
        attachableTo: ['warehouse'],
      },
      { uid: 'u1', role: 'super_admin' }
    );
    const catSet = mocks.capturedTx.sets.find(
      (s) => s.data?.inventoryCodePrefix === 'X1'
    );
    expect(catSet).toBeDefined();
    expect(catSet.data.assignsInventoryCode).toBe(true);
  });

  it('persists assignsInventoryCode=false when caller provides it', async () => {
    await createCategory(
      {
        name: { ru: 'License', en: 'License', hy: 'License' },
        inventoryCodePrefix: 'LIC',
        attachableTo: ['warehouse', 'employee'],
        requiresMultilang: false,
        assignsInventoryCode: false,
      },
      { uid: 'u1', role: 'super_admin' }
    );
    const catSet = mocks.capturedTx.sets.find(
      (s) => s.data?.inventoryCodePrefix === 'LIC'
    );
    expect(catSet).toBeDefined();
    expect(catSet.data.assignsInventoryCode).toBe(false);
  });

  it('updateCategory passes assignsInventoryCode through', async () => {
    const before = {
      categoryId: 'cat1',
      name: { ru: 'X', en: 'X', hy: 'X' },
      inventoryCodePrefix: 'X1',
      requiresMultilang: true,
      attachableTo: ['warehouse'],
      assignsInventoryCode: true,
      isActive: true,
    };
    await updateCategory(
      'cat1',
      {
        name: { ru: 'X', en: 'X', hy: 'X' },
        inventoryCodePrefix: 'X1',
        requiresMultilang: true,
        attachableTo: ['warehouse'],
        assignsInventoryCode: false,
        isActive: true,
      },
      before,
      { uid: 'u1', role: 'super_admin' }
    );
    expect(mocks.capturedTx.updates).toHaveLength(1);
    expect(mocks.capturedTx.updates[0].data.assignsInventoryCode).toBe(false);
  });
});
