import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock storage that the firebase/firestore mock will reach into.
const mocks = vi.hoisted(() => ({
  docCounter: 0,
  newDoc: () => ({ id: `doc_${++mocks.docCounter}` }),
  capturedTx: { sets: [], updates: [], deletes: [], gets: [] },
  // Keyed by the second-arg path of `doc(db, 'collection', 'id')` so tests can
  // simulate `tx.get` exists/doesn't-exist behavior.
  existsByPath: new Map(),
  onSnapshotUnsub: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((_dbOrCol, ...args) => {
    if (args.length === 0) {
      // doc(collectionRef) => auto-id
      return mocks.newDoc();
    }
    // doc(db, 'collectionName', 'docId') => deterministic ref
    const [coll, id] = args;
    return { id, __ref: { coll, id } };
  }),
  onSnapshot: vi.fn(() => mocks.onSnapshotUnsub),
  orderBy: vi.fn((field, dir) => ({ __order: [field, dir] })),
  query: vi.fn((coll, ...mods) => ({ __query: coll, mods })),
  runTransaction: vi.fn((_db, fn) => {
    mocks.capturedTx = { sets: [], updates: [], deletes: [], gets: [] };
    const tx = {
      get: vi.fn(async (ref) => {
        mocks.capturedTx.gets.push({ ref });
        const path = ref?.__ref ? `${ref.__ref.coll}/${ref.__ref.id}` : `auto/${ref?.id}`;
        const exists = mocks.existsByPath.has(path);
        const data = mocks.existsByPath.get(path);
        return {
          exists: () => exists,
          data: () => data,
          id: ref?.id,
        };
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
  Timestamp: {
    fromDate: vi.fn((d) => ({ __ts: d.toISOString() })),
  },
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
  createEmployee,
  updateEmployee,
  setEmployeeActive,
  subscribeEmployees,
  subscribeEmployee,
  firestoreEmployeeRepository,
} from '@/infra/repositories/firestoreEmployeeRepository.js';
import {
  EmployeeEmailTakenError,
  EmployeeHasActiveAssignmentsError,
} from '@/domain/employees.js';

beforeEach(() => {
  mocks.docCounter = 0;
  mocks.existsByPath = new Map();
  // Reset captured tx ops so an early-throw test (no runTransaction call)
  // doesn't see writes leaked from a previous test in the same file.
  mocks.capturedTx = { sets: [], updates: [], deletes: [], gets: [] };
  auditMocks.newAuditLogRef.mockClear();
  auditMocks.buildAuditLog.mockClear();
  auditMocks.newAuditLogRef.mockImplementation(() => ({ id: 'audit_1' }));
  auditMocks.buildAuditLog.mockImplementation((args) => ({ __audit: true, ...args }));
});

const happyInput = {
  firstName: 'Khach',
  lastName: 'Z',
  email: 'khach@example.com',
  phone: null,
  branchId: 'b1',
  departmentId: null,
  department: null,
  isActive: true,
};

describe('firestoreEmployeeRepository', () => {
  it('exports an adapter object matching the port shape', () => {
    expect(firestoreEmployeeRepository).toMatchObject({
      list: expect.any(Function),
      get: expect.any(Function),
      create: expect.any(Function),
      update: expect.any(Function),
      setActive: expect.any(Function),
    });
    expect(Object.isFrozen(firestoreEmployeeRepository)).toBe(true);
  });

  describe('createEmployee', () => {
    it('writes employee + email_index + audit in one transaction', async () => {
      const id = await createEmployee(happyInput, { uid: 'u_123', role: 'super_admin' });

      expect(typeof id).toBe('string');
      // Two sets are entity + audit; index gets a third set.
      expect(mocks.capturedTx.sets).toHaveLength(3);

      const [empSet, idxSet, auditSet] = mocks.capturedTx.sets;
      expect(empSet.data).toMatchObject({
        firstName: 'Khach',
        lastName: 'Z',
        email: 'khach@example.com',
        branchId: 'b1',
        isActive: true,
        terminatedAt: null,
        createdBy: 'u_123',
        updatedBy: 'u_123',
        createdAt: 'SERVER_TS',
        updatedAt: 'SERVER_TS',
      });
      expect(empSet.data.employeeId).toBe(id);

      expect(idxSet.ref.__ref).toEqual({ coll: 'email_index', id: 'khach@example.com' });
      expect(idxSet.data).toMatchObject({
        employeeId: id,
        createdAt: 'SERVER_TS',
      });

      expect(auditSet.data).toMatchObject({
        __audit: true,
        entity: 'employee',
        entityId: id,
        action: 'create',
        actorUid: 'u_123',
        actorRole: 'super_admin',
        before: null,
        relatedEmployeeId: id,
      });
      // Audit `after` blob is JSON-clean — no SERVER_TS sentinels in it.
      expect(auditSet.data.after).toMatchObject({
        firstName: 'Khach',
        lastName: 'Z',
        email: 'khach@example.com',
        branchId: 'b1',
        isActive: true,
      });
      expect(auditSet.data.after.createdAt).toBeUndefined();
      expect(auditSet.data.after.updatedAt).toBeUndefined();
    });

    it('rejects with EmployeeEmailTakenError when the index doc already exists', async () => {
      mocks.existsByPath.set('email_index/khach@example.com', { employeeId: 'other' });

      await expect(
        createEmployee(happyInput, { uid: 'u_123', role: 'super_admin' })
      ).rejects.toBeInstanceOf(EmployeeEmailTakenError);
    });

    it('rejects when actor.uid missing', async () => {
      await expect(createEmployee(happyInput, {})).rejects.toThrow(/actor.uid/);
    });

    it('rejects when email is empty', async () => {
      await expect(
        createEmployee({ ...happyInput, email: '' }, { uid: 'u', role: 'super_admin' })
      ).rejects.toThrow(/email required/);
    });

    it('lower-cases the index key from a mixed-case email', async () => {
      await createEmployee(
        { ...happyInput, email: '  Khach@EXAMPLE.com ' },
        { uid: 'u_1', role: 'super_admin' }
      );
      const idxSet = mocks.capturedTx.sets[1];
      expect(idxSet.ref.__ref.id).toBe('khach@example.com');
    });
  });

  describe('updateEmployee', () => {
    const before = {
      employeeId: 'e1',
      firstName: 'Khach',
      lastName: 'Z',
      email: 'khach@example.com',
      phone: null,
      branchId: 'b1',
      departmentId: null,
      department: null,
      isActive: true,
      terminatedAt: null,
    };

    it('writes update + audit; does NOT touch email_index when email unchanged', async () => {
      await updateEmployee(
        'e1',
        { ...happyInput, phone: '+1 555 1234' },
        before,
        { uid: 'u_2', role: 'asset_admin' }
      );

      expect(mocks.capturedTx.updates).toHaveLength(1);
      expect(mocks.capturedTx.deletes).toHaveLength(0);
      // audit log only — no index sentinel touch.
      expect(mocks.capturedTx.sets).toHaveLength(1);

      const update = mocks.capturedTx.updates[0];
      expect(update.data).toMatchObject({
        phone: '+1 555 1234',
        updatedBy: 'u_2',
        updatedAt: 'SERVER_TS',
      });
      // updateEmployee must NOT touch createdAt / createdBy / employeeId.
      expect(update.data.createdAt).toBeUndefined();
      expect(update.data.createdBy).toBeUndefined();
      expect(update.data.employeeId).toBeUndefined();

      const audit = mocks.capturedTx.sets[0].data;
      expect(audit).toMatchObject({
        action: 'update',
        before: { email: 'khach@example.com' },
        after: { email: 'khach@example.com', phone: '+1 555 1234' },
      });
    });

    it('moves email_index when email changes (delete old, create new) after collision check', async () => {
      await updateEmployee(
        'e1',
        { ...happyInput, email: 'NEW@example.com' },
        before,
        { uid: 'u_2', role: 'asset_admin' }
      );

      // collision check + actual move
      expect(mocks.capturedTx.gets).toHaveLength(1);
      expect(mocks.capturedTx.gets[0].ref.__ref).toEqual({
        coll: 'email_index',
        id: 'new@example.com',
      });
      expect(mocks.capturedTx.deletes).toHaveLength(1);
      expect(mocks.capturedTx.deletes[0].ref.__ref).toEqual({
        coll: 'email_index',
        id: 'khach@example.com',
      });
      // sets: new index sentinel + audit
      expect(mocks.capturedTx.sets).toHaveLength(2);
      const [newIdxSet, auditSet] = mocks.capturedTx.sets;
      expect(newIdxSet.ref.__ref).toEqual({
        coll: 'email_index',
        id: 'new@example.com',
      });
      expect(newIdxSet.data).toMatchObject({ employeeId: 'e1', createdAt: 'SERVER_TS' });
      expect(auditSet.data.action).toBe('update');
    });

    it('rejects with EmployeeEmailTakenError when the new email collides with another employee', async () => {
      mocks.existsByPath.set('email_index/new@example.com', { employeeId: 'OTHER' });

      await expect(
        updateEmployee(
          'e1',
          { ...happyInput, email: 'new@example.com' },
          before,
          { uid: 'u_2', role: 'asset_admin' }
        )
      ).rejects.toBeInstanceOf(EmployeeEmailTakenError);
    });

    it('does NOT collide with itself when index already points to this employee', async () => {
      // Defensive: if a previous run partially wrote, the index already points
      // to the same employee. updateEmployee should not throw.
      mocks.existsByPath.set('email_index/new@example.com', { employeeId: 'e1' });

      await updateEmployee(
        'e1',
        { ...happyInput, email: 'new@example.com' },
        before,
        { uid: 'u_2', role: 'asset_admin' }
      );

      expect(mocks.capturedTx.updates).toHaveLength(1);
    });

    it('rejects when before snapshot missing', async () => {
      await expect(
        updateEmployee('e1', happyInput, null, { uid: 'u', role: 'super_admin' })
      ).rejects.toThrow(/before snapshot/);
    });

    it('rejects when actor.uid missing', async () => {
      await expect(
        updateEmployee('e1', happyInput, before, {})
      ).rejects.toThrow(/actor.uid/);
    });
  });

  describe('setEmployeeActive', () => {
    const activeBefore = {
      employeeId: 'e1',
      firstName: 'Khach',
      lastName: 'Z',
      email: 'khach@example.com',
      phone: null,
      branchId: 'b1',
      departmentId: null,
      department: null,
      isActive: true,
      terminatedAt: null,
    };

    it('writes deactivate + terminatedAt SERVER_TS when count is 0', async () => {
      await setEmployeeActive('e1', false, activeBefore, { uid: 'u_2', role: 'super_admin' });

      expect(mocks.capturedTx.updates).toHaveLength(1);
      expect(mocks.capturedTx.updates[0].data).toMatchObject({
        isActive: false,
        terminatedAt: 'SERVER_TS',
        updatedBy: 'u_2',
        updatedAt: 'SERVER_TS',
      });
      const audit = mocks.capturedTx.sets[0].data;
      expect(audit.action).toBe('deactivate');
      expect(audit.before.isActive).toBe(true);
      expect(audit.after.isActive).toBe(false);
      expect(audit.after.terminatedAt).toBeNull();
    });

    it('refuses to deactivate when activeAssignmentCount > 0', async () => {
      await expect(
        setEmployeeActive(
          'e1',
          false,
          activeBefore,
          { uid: 'u_2', role: 'super_admin' },
          { activeAssignmentCount: 3 }
        )
      ).rejects.toBeInstanceOf(EmployeeHasActiveAssignmentsError);
      // Nothing was written.
      expect(mocks.capturedTx.updates).toHaveLength(0);
      expect(mocks.capturedTx.sets).toHaveLength(0);
    });

    it('writes "reactivate" when previously terminated (terminatedAt non-null)', async () => {
      const terminated = {
        ...activeBefore,
        isActive: false,
        terminatedAt: { toMillis: () => 1700000000000 },
      };
      await setEmployeeActive('e1', true, terminated, { uid: 'u_3', role: 'super_admin' });
      expect(mocks.capturedTx.sets[0].data.action).toBe('reactivate');
      expect(mocks.capturedTx.updates[0].data).toMatchObject({
        isActive: true,
        terminatedAt: null,
      });
    });

    it('writes "activate" when never terminated (terminatedAt null) but isActive flipped true', async () => {
      const inactiveButNeverTerminated = { ...activeBefore, isActive: false, terminatedAt: null };
      await setEmployeeActive('e1', true, inactiveButNeverTerminated, {
        uid: 'u_3',
        role: 'super_admin',
      });
      expect(mocks.capturedTx.sets[0].data.action).toBe('activate');
    });

    it('rejects when before snapshot missing', async () => {
      await expect(
        setEmployeeActive('e1', false, null, { uid: 'u', role: 'super_admin' })
      ).rejects.toThrow(/before snapshot/);
    });

    it('rejects when actor.uid missing', async () => {
      await expect(
        setEmployeeActive('e1', false, activeBefore, {})
      ).rejects.toThrow(/actor.uid/);
    });
  });

  describe('subscriptions', () => {
    it('subscribeEmployees attaches an onSnapshot listener and returns unsub', () => {
      const unsub = subscribeEmployees(vi.fn());
      expect(unsub).toBe(mocks.onSnapshotUnsub);
    });

    it('subscribeEmployee attaches a single-doc listener and returns unsub', () => {
      const unsub = subscribeEmployee('e1', vi.fn());
      expect(unsub).toBe(mocks.onSnapshotUnsub);
    });
  });
});
