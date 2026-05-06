import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock storage that the firebase/firestore mock will reach into.
const mocks = vi.hoisted(() => ({
  docCounter: 0,
  newDoc: () => ({ id: `doc_${++mocks.docCounter}` }),
  capturedTx: { sets: [], updates: [] },
  runTransactionImpl: null,
  onSnapshotUnsub: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((_dbOrCol, ...args) => {
    if (args.length === 0) {
      // doc(collectionRef) => auto-id
      return mocks.newDoc();
    }
    return { id: args[args.length - 1], __ref: args };
  }),
  onSnapshot: vi.fn(() => mocks.onSnapshotUnsub),
  orderBy: vi.fn((field, dir) => ({ __order: [field, dir] })),
  query: vi.fn((coll, ...mods) => ({ __query: coll, mods })),
  runTransaction: vi.fn((_db, fn) => {
    mocks.capturedTx = { sets: [], updates: [] };
    const tx = {
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
  createBranch,
  updateBranch,
  setBranchActive,
  subscribeBranches,
  subscribeBranch,
  firestoreBranchRepository,
} from '@/infra/repositories/firestoreBranchRepository.js';

beforeEach(() => {
  mocks.docCounter = 0;
  auditMocks.newAuditLogRef.mockClear();
  auditMocks.buildAuditLog.mockClear();
  auditMocks.newAuditLogRef.mockImplementation(() => ({ id: 'audit_1' }));
  auditMocks.buildAuditLog.mockImplementation((args) => ({ __audit: true, ...args }));
});

describe('firestoreBranchRepository', () => {
  it('exports an adapter object matching the port shape', () => {
    expect(firestoreBranchRepository).toMatchObject({
      list: expect.any(Function),
      get: expect.any(Function),
      create: expect.any(Function),
      update: expect.any(Function),
      setActive: expect.any(Function),
    });
    expect(Object.isFrozen(firestoreBranchRepository)).toBe(true);
  });

  describe('createBranch', () => {
    it('writes the branch doc and an audit_logs entry in one transaction', async () => {
      const id = await createBranch(
        {
          name: { ru: 'Главный', en: 'HQ', hy: 'Գլխավոր' },
          type: 'warehouse',
          address: 'Yerevan central',
          responsibleEmployeeId: null,
          isActive: true,
        },
        { uid: 'u_123', role: 'super_admin' }
      );

      expect(typeof id).toBe('string');
      expect(mocks.capturedTx.sets).toHaveLength(2);

      const [branchSet, auditSet] = mocks.capturedTx.sets;
      expect(branchSet.data).toMatchObject({
        name: { ru: 'Главный', en: 'HQ', hy: 'Գլխավոր' },
        type: 'warehouse',
        address: 'Yerevan central',
        responsibleEmployeeId: null,
        isActive: true,
        createdBy: 'u_123',
        updatedBy: 'u_123',
        createdAt: 'SERVER_TS',
        updatedAt: 'SERVER_TS',
      });
      expect(branchSet.data.branchId).toBe(id);

      expect(auditSet.data).toMatchObject({
        __audit: true,
        entity: 'branch',
        entityId: id,
        action: 'create',
        actorUid: 'u_123',
        actorRole: 'super_admin',
        before: null,
      });
      // Audit `after` blob must NOT contain server-timestamp sentinels.
      expect(auditSet.data.after).toEqual({
        name: { ru: 'Главный', en: 'HQ', hy: 'Գլխավոր' },
        type: 'warehouse',
        address: 'Yerevan central',
        responsibleEmployeeId: null,
        isActive: true,
      });
    });

    it('rejects a missing actor', async () => {
      await expect(
        createBranch({ name: { ru: 'a', en: 'b', hy: 'c' }, type: 'branch' }, {})
      ).rejects.toThrow(/actor.uid/);
    });

    it('sanitizes input (trims whitespace)', async () => {
      await createBranch(
        {
          name: { ru: '  Главный  ', en: '  HQ  ', hy: '  Գ  ' },
          type: 'branch',
          address: '  Yerevan  ',
        },
        { uid: 'u_1', role: 'super_admin' }
      );
      expect(mocks.capturedTx.sets[0].data.name).toEqual({
        ru: 'Главный',
        en: 'HQ',
        hy: 'Գ',
      });
      expect(mocks.capturedTx.sets[0].data.address).toBe('Yerevan');
    });
  });

  describe('updateBranch', () => {
    it('writes a tx update + audit_logs row with before/after diff', async () => {
      const before = {
        branchId: 'b1',
        name: { ru: 'Старое', en: 'Old', hy: 'Հին' },
        type: 'branch',
        address: 'A',
        responsibleEmployeeId: null,
        isActive: true,
      };
      await updateBranch(
        'b1',
        {
          name: { ru: 'Новое', en: 'New', hy: 'Նոր' },
          type: 'branch',
          address: 'B',
          responsibleEmployeeId: null,
          isActive: true,
        },
        before,
        { uid: 'u_2', role: 'super_admin' }
      );

      expect(mocks.capturedTx.updates).toHaveLength(1);
      expect(mocks.capturedTx.sets).toHaveLength(1); // audit log

      const update = mocks.capturedTx.updates[0];
      expect(update.data).toMatchObject({
        name: { ru: 'Новое', en: 'New', hy: 'Նոր' },
        address: 'B',
        updatedBy: 'u_2',
        updatedAt: 'SERVER_TS',
      });
      // updateBranch must NOT touch createdAt / createdBy.
      expect(update.data.createdAt).toBeUndefined();
      expect(update.data.createdBy).toBeUndefined();

      const audit = mocks.capturedTx.sets[0].data;
      expect(audit).toMatchObject({
        action: 'update',
        before: {
          name: { ru: 'Старое', en: 'Old', hy: 'Հին' },
          address: 'A',
        },
        after: { name: { ru: 'Новое', en: 'New', hy: 'Նոր' }, address: 'B' },
      });
    });

    it('rejects a missing before snapshot', async () => {
      await expect(
        updateBranch(
          'b1',
          { name: { ru: 'a', en: 'b', hy: 'c' }, type: 'branch' },
          null,
          { uid: 'u_1', role: 'super_admin' }
        )
      ).rejects.toThrow(/before snapshot/);
    });
  });

  describe('setBranchActive', () => {
    it('writes deactivate audit when isActive flips to false', async () => {
      const before = {
        branchId: 'b1',
        name: { ru: 'Главный', en: 'HQ', hy: 'Գ' },
        type: 'branch',
        address: 'A',
        responsibleEmployeeId: null,
        isActive: true,
      };
      await setBranchActive('b1', false, before, { uid: 'u_2', role: 'super_admin' });

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
        branchId: 'b1',
        name: { ru: 'Г', en: 'H', hy: 'Գ' },
        type: 'branch',
        address: '',
        responsibleEmployeeId: null,
        isActive: false,
      };
      await setBranchActive('b1', true, before, { uid: 'u_3', role: 'super_admin' });
      expect(mocks.capturedTx.sets[0].data.action).toBe('activate');
      expect(mocks.capturedTx.updates[0].data.isActive).toBe(true);
    });
  });

  describe('subscribeBranches', () => {
    it('attaches an onSnapshot listener and returns the unsubscribe', () => {
      const onData = vi.fn();
      const unsub = subscribeBranches(onData);
      expect(unsub).toBe(mocks.onSnapshotUnsub);
    });
  });

  describe('subscribeBranch', () => {
    it('attaches an onSnapshot listener for a single doc', () => {
      const onData = vi.fn();
      const unsub = subscribeBranch('b1', onData);
      expect(unsub).toBe(mocks.onSnapshotUnsub);
    });
  });
});
