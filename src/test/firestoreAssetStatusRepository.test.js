import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  createAssetStatus,
  updateAssetStatus,
  setAssetStatusActive,
  subscribeAssetStatuses,
  subscribeAssetStatus,
  firestoreAssetStatusRepository,
} from '@/infra/repositories/firestoreAssetStatusRepository.js';

beforeEach(() => {
  mocks.docCounter = 0;
  auditMocks.newAuditLogRef.mockClear();
  auditMocks.buildAuditLog.mockClear();
  auditMocks.newAuditLogRef.mockImplementation(() => ({ id: 'audit_1' }));
  auditMocks.buildAuditLog.mockImplementation((args) => ({ __audit: true, ...args }));
});

describe('firestoreAssetStatusRepository', () => {
  it('exports an adapter object matching the port shape', () => {
    expect(firestoreAssetStatusRepository).toMatchObject({
      list: expect.any(Function),
      get: expect.any(Function),
      create: expect.any(Function),
      update: expect.any(Function),
      setActive: expect.any(Function),
    });
    expect(Object.isFrozen(firestoreAssetStatusRepository)).toBe(true);
  });

  describe('createAssetStatus', () => {
    it('writes the status doc and an audit_logs entry in one transaction', async () => {
      const id = await createAssetStatus(
        {
          name: { ru: 'Склад', en: 'Warehouse', hy: 'Պահեստ' },
          color: '#64748b',
          isFinal: false,
          isAssignable: false,
          sortOrder: 1,
          isActive: true,
        },
        { uid: 'u_1', role: 'super_admin' },
        { id: 'warehouse' }
      );

      expect(id).toBe('warehouse');
      expect(mocks.capturedTx.sets).toHaveLength(2);

      const [statusSet, auditSet] = mocks.capturedTx.sets;
      expect(statusSet.data).toMatchObject({
        name: { ru: 'Склад', en: 'Warehouse', hy: 'Պահեստ' },
        color: '#64748b',
        isFinal: false,
        isAssignable: false,
        sortOrder: 1,
        isActive: true,
        createdBy: 'u_1',
        updatedBy: 'u_1',
        createdAt: 'SERVER_TS',
        updatedAt: 'SERVER_TS',
      });
      expect(statusSet.data.statusId).toBe('warehouse');

      expect(auditSet.data).toMatchObject({
        __audit: true,
        entity: 'asset_status',
        entityId: 'warehouse',
        action: 'create',
        actorUid: 'u_1',
        actorRole: 'super_admin',
        before: null,
      });
      expect(auditSet.data.after).toEqual({
        name: { ru: 'Склад', en: 'Warehouse', hy: 'Պահեստ' },
        color: '#64748b',
        isFinal: false,
        isAssignable: false,
        sortOrder: 1,
        isActive: true,
      });
    });

    it('lowercases an uppercase color at write time', async () => {
      await createAssetStatus(
        {
          name: { ru: 'a', en: 'b', hy: 'c' },
          color: '#16A34A',
          isFinal: false,
          isAssignable: true,
          sortOrder: 2,
        },
        { uid: 'u_1', role: 'super_admin' }
      );
      expect(mocks.capturedTx.sets[0].data.color).toBe('#16a34a');
    });

    it('coerces sortOrder via the domain sanitizer', async () => {
      await createAssetStatus(
        {
          name: { ru: 'a', en: 'b', hy: 'c' },
          color: '#16a34a',
          sortOrder: '7',
        },
        { uid: 'u_1', role: 'super_admin' }
      );
      expect(mocks.capturedTx.sets[0].data.sortOrder).toBe(7);
    });

    it('rejects a missing actor', async () => {
      await expect(
        createAssetStatus(
          { name: { ru: 'a', en: 'b', hy: 'c' }, color: '#16a34a' },
          {}
        )
      ).rejects.toThrow(/actor.uid/);
    });
  });

  describe('updateAssetStatus', () => {
    it('writes a tx update + audit_logs row with before/after diff', async () => {
      const before = {
        statusId: 'assigned',
        name: { ru: 'Выдан', en: 'Assigned', hy: 'Տրված' },
        color: '#16a34a',
        isFinal: false,
        isAssignable: true,
        sortOrder: 2,
        isActive: true,
      };
      await updateAssetStatus(
        'assigned',
        {
          name: { ru: 'Выдан', en: 'Assigned', hy: 'Տրված' },
          color: '#15803d',
          isFinal: false,
          isAssignable: true,
          sortOrder: 2,
          isActive: true,
        },
        before,
        { uid: 'u_2', role: 'super_admin' }
      );

      expect(mocks.capturedTx.updates).toHaveLength(1);
      expect(mocks.capturedTx.sets).toHaveLength(1); // audit only

      const update = mocks.capturedTx.updates[0];
      expect(update.data).toMatchObject({
        color: '#15803d',
        isFinal: false,
        isAssignable: true,
        sortOrder: 2,
        updatedBy: 'u_2',
        updatedAt: 'SERVER_TS',
      });
      expect(update.data.createdAt).toBeUndefined();
      expect(update.data.createdBy).toBeUndefined();

      const audit = mocks.capturedTx.sets[0].data;
      expect(audit).toMatchObject({
        action: 'update',
        before: { color: '#16a34a' },
        after: { color: '#15803d' },
      });
    });

    it('rejects a missing before snapshot', async () => {
      await expect(
        updateAssetStatus(
          'assigned',
          { name: { ru: 'a', en: 'b', hy: 'c' }, color: '#16a34a' },
          null,
          { uid: 'u_1', role: 'super_admin' }
        )
      ).rejects.toThrow(/before snapshot/);
    });
  });

  describe('setAssetStatusActive', () => {
    it('writes deactivate audit when isActive flips to false', async () => {
      const before = {
        statusId: 'assigned',
        name: { ru: 'Выдан', en: 'Assigned', hy: 'Տրված' },
        color: '#16a34a',
        isFinal: false,
        isAssignable: true,
        sortOrder: 2,
        isActive: true,
      };
      await setAssetStatusActive('assigned', false, before, { uid: 'u_2', role: 'super_admin' });
      expect(mocks.capturedTx.updates[0].data).toMatchObject({
        isActive: false,
        updatedBy: 'u_2',
      });
      const audit = mocks.capturedTx.sets[0].data;
      expect(audit.action).toBe('deactivate');
      expect(audit.before.isActive).toBe(true);
      expect(audit.after.isActive).toBe(false);
    });

    it('writes activate audit when isActive flips to true', async () => {
      const before = {
        statusId: 'assigned',
        name: { ru: 'a', en: 'b', hy: 'c' },
        color: '#16a34a',
        isFinal: false,
        isAssignable: true,
        sortOrder: 2,
        isActive: false,
      };
      await setAssetStatusActive('assigned', true, before, { uid: 'u_3', role: 'super_admin' });
      expect(mocks.capturedTx.sets[0].data.action).toBe('activate');
      expect(mocks.capturedTx.updates[0].data.isActive).toBe(true);
    });
  });

  describe('subscribeAssetStatuses', () => {
    it('attaches an onSnapshot listener and returns the unsubscribe', () => {
      const onData = vi.fn();
      const unsub = subscribeAssetStatuses(onData);
      expect(unsub).toBe(mocks.onSnapshotUnsub);
    });
  });

  describe('subscribeAssetStatus', () => {
    it('attaches an onSnapshot listener for a single doc', () => {
      const onData = vi.fn();
      const unsub = subscribeAssetStatus('warehouse', onData);
      expect(unsub).toBe(mocks.onSnapshotUnsub);
    });
  });
});
