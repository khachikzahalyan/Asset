import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock storage that the firebase/firestore mock will reach into.
const mocks = vi.hoisted(() => ({
  docCounter: 0,
  newDoc: () => ({ id: `doc_${++mocks.docCounter}` }),
  capturedTx: { sets: [], updates: [], gets: [] },
  onSnapshotUnsub: vi.fn(),
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
  runTransaction: vi.fn((_db, fn) => {
    mocks.capturedTx = { sets: [], updates: [], gets: [] };
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
  createCategory,
  updateCategory,
  setCategoryActive,
  subscribeCategories,
  subscribeCategory,
  firestoreCategoryRepository,
} from '@/infra/repositories/firestoreCategoryRepository.js';

beforeEach(() => {
  mocks.docCounter = 0;
  auditMocks.newAuditLogRef.mockClear();
  auditMocks.buildAuditLog.mockClear();
  auditMocks.newAuditLogRef.mockImplementation(() => ({ id: 'audit_1' }));
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
    });
    expect(Object.isFrozen(firestoreCategoryRepository)).toBe(true);
  });

  describe('createCategory', () => {
    it('writes the category doc and an audit_logs entry in one transaction', async () => {
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
      expect(mocks.capturedTx.sets).toHaveLength(2);

      const [catSet, auditSet] = mocks.capturedTx.sets;
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
        isActive: true,
      });
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
