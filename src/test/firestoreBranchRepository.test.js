import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock storage that the firebase/firestore mock will reach into.
const mocks = vi.hoisted(() => ({
  docCounter: 0,
  newDoc: () => ({ id: `doc_${++mocks.docCounter}` }),
  capturedTx: { sets: [], updates: [], gets: [] },
  runTransactionImpl: null,
  onSnapshotUnsub: vi.fn(),
  // `getDocs(query(...))` is used by createBranch / updateBranch to find
  // currently-primary branches outside of the transaction. Default to "no
  // primary" — individual tests opt in by overriding this.
  primaryBranchSnapshots: [],
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
  where: vi.fn((field, op, value) => ({ __where: [field, op, value] })),
  query: vi.fn((coll, ...mods) => ({ __query: coll, mods })),
  getDocs: vi.fn(() => Promise.resolve({ docs: mocks.primaryBranchSnapshots })),
  runTransaction: vi.fn((_db, fn) => {
    mocks.capturedTx = { sets: [], updates: [], gets: [] };
    const tx = {
      get: vi.fn((ref) => {
        mocks.capturedTx.gets.push(ref);
        // Resolve to the snapshot whose `.ref` matches; otherwise empty.
        const match = mocks.primaryBranchSnapshots.find((s) => s.ref === ref);
        return Promise.resolve(
          match ?? { exists: () => false, data: () => undefined, ref, id: ref?.id }
        );
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
  createBranch,
  updateBranch,
  setBranchActive,
  subscribeBranches,
  subscribeBranch,
  firestoreBranchRepository,
} from '@/infra/repositories/firestoreBranchRepository.js';

beforeEach(() => {
  mocks.docCounter = 0;
  mocks.primaryBranchSnapshots = [];
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
          phone: '+374 99 12 34 56',
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
        phone: '+374 99 12 34 56',
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
        phone: '+374 99 12 34 56',
        responsibleEmployeeId: null,
        isActive: true,
        isPrimary: false,
      });
    });

    it('demotes the previously-primary branch when creating a new primary one', async () => {
      // Existing primary doc; refs are matched by reference equality in the
      // mocked transaction.
      const previousPrimaryRef = { id: 'b_old', __ref: ['branches', 'b_old'] };
      mocks.primaryBranchSnapshots = [
        {
          id: 'b_old',
          ref: previousPrimaryRef,
          exists: () => true,
          data: () => ({
            name: { ru: 'Старый', en: 'Old', hy: 'Հին' },
            type: 'branch',
            address: '',
            responsibleEmployeeId: null,
            isActive: true,
            isPrimary: true,
          }),
        },
      ];

      await createBranch(
        {
          name: { ru: 'Главный', en: 'HQ', hy: 'Գ' },
          type: 'branch',
          address: '',
          responsibleEmployeeId: null,
          isActive: true,
          isPrimary: true,
        },
        { uid: 'u_1', role: 'super_admin' }
      );

      // Two writes inside the tx: the new branch (set) + the demotion (update).
      // Plus two audit_logs sets — one for the new branch's create, one for
      // the demotion.
      const demote = mocks.capturedTx.updates.find((u) => u.ref === previousPrimaryRef);
      expect(demote).toBeDefined();
      expect(demote.data).toMatchObject({
        isPrimary: false,
        updatedBy: 'u_1',
      });
      // The new branch set carries isPrimary: true.
      expect(mocks.capturedTx.sets[0].data.isPrimary).toBe(true);
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
          phone: '  +374 12 34 56 78  ',
        },
        { uid: 'u_1', role: 'super_admin' }
      );
      expect(mocks.capturedTx.sets[0].data.name).toEqual({
        ru: 'Главный',
        en: 'HQ',
        hy: 'Գ',
      });
      expect(mocks.capturedTx.sets[0].data.address).toBe('Yerevan');
      expect(mocks.capturedTx.sets[0].data.phone).toBe('+374 12 34 56 78');
    });
  });

  describe('updateBranch', () => {
    it('writes a tx update + audit_logs row with before/after diff', async () => {
      const before = {
        branchId: 'b1',
        name: { ru: 'Старое', en: 'Old', hy: 'Հին' },
        type: 'branch',
        address: 'A',
        phone: '+374 1',
        responsibleEmployeeId: null,
        isActive: true,
      };
      await updateBranch(
        'b1',
        {
          name: { ru: 'Новое', en: 'New', hy: 'Նոր' },
          type: 'branch',
          address: 'B',
          phone: '+374 2',
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
        phone: '+374 2',
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
          phone: '+374 1',
        },
        after: {
          name: { ru: 'Новое', en: 'New', hy: 'Նոր' },
          address: 'B',
          phone: '+374 2',
        },
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
