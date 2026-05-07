/**
 * Tests for `firestoreAssignmentEventRepository`. Mirrors the hoisted-mock
 * pattern used by `firestoreAssetRepository.test.js` — Firestore SDK is
 * fully mocked, the captured tx.gets/sets/updates are asserted on.
 *
 * Covers:
 *   1. Optimistic concurrency: when the live asset's `assignedTo` has
 *      drifted from the input's `fromAssignment`, throws
 *      AssignmentConflictError.
 *   2. Issue transition: warehouse → employee sets statusId='assigned'.
 *   3. Return transition: employee → warehouse sets statusId='warehouse'.
 *   4. Transfer transition: employee → branch keeps statusId.
 *   5. Employee/department targets clear branchId on the asset patch.
 *   6. Audit row written with action == eventType, entity='assignment',
 *      meta.eventType / meta.notes / meta.actUploadPath populated.
 *   7. No update or delete adapter methods exist (events are immutable).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  docCounter: 0,
  newDoc: () => ({ id: `doc_${++mocks.docCounter}` }),
  capturedTx: { sets: [], updates: [], gets: [] },
  onSnapshotUnsub: vi.fn(),
  // Configurable asset state used by the runTransaction mock's tx.get.
  asset: {
    exists: true,
    data: {
      assetId: 'a_1',
      assignedTo: { kind: 'warehouse', id: null },
      statusId: 'warehouse',
      branchId: 'b_main',
    },
  },
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((_dbOrCol, ...args) => {
    if (args.length === 0) {
      // doc(collection) → ref for a new doc (the event ref).
      return mocks.newDoc();
    }
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
        if (path === 'assets') {
          return Promise.resolve({
            exists: () => mocks.asset.exists,
            data: () => (mocks.asset.exists ? mocks.asset.data : undefined),
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
  createAssignmentEvent,
  subscribeAssignmentEventsByAsset,
  firestoreAssignmentEventRepository,
} from '@/infra/repositories/firestoreAssignmentEventRepository.js';
import { AssignmentConflictError } from '@/domain/assignmentEvents.js';
import { ASSIGNMENT_KINDS } from '@/domain/assets.js';

const WH = { kind: ASSIGNMENT_KINDS.WAREHOUSE, id: null };
const EMP = (id = 'e_1') => ({ kind: ASSIGNMENT_KINDS.EMPLOYEE, id });
const BR = (id = 'b_1') => ({ kind: ASSIGNMENT_KINDS.BRANCH, id });
const DEP = (id = 'd_1') => ({ kind: ASSIGNMENT_KINDS.DEPARTMENT, id });

const ACTOR = { uid: 'u_admin', role: 'asset_admin' };

beforeEach(() => {
  mocks.docCounter = 0;
  mocks.asset = {
    exists: true,
    data: {
      assetId: 'a_1',
      assignedTo: { kind: 'warehouse', id: null },
      statusId: 'warehouse',
      branchId: 'b_main',
    },
  };
  auditMocks.newAuditLogRef.mockClear();
  auditMocks.buildAuditLog.mockClear();
  auditMocks.newAuditLogRef.mockImplementation(() => ({ id: 'audit_1' }));
  auditMocks.buildAuditLog.mockImplementation((args) => ({ __audit: true, ...args }));
});

describe('firestoreAssignmentEventRepository', () => {
  describe('adapter shape', () => {
    it('exposes only listByAsset and create (no update / delete)', () => {
      expect(firestoreAssignmentEventRepository).toMatchObject({
        listByAsset: expect.any(Function),
        create: expect.any(Function),
      });
      expect(Object.isFrozen(firestoreAssignmentEventRepository)).toBe(true);

      // Hard-confirm immutability: no write methods beyond create exist.
      const keys = Object.keys(firestoreAssignmentEventRepository);
      expect(keys).not.toContain('update');
      expect(keys).not.toContain('delete');
      expect(keys).not.toContain('remove');
      expect(keys.sort()).toEqual(['create', 'listByAsset']);
    });
  });

  describe('createAssignmentEvent — optimistic concurrency', () => {
    it('throws AssignmentConflictError when live assignedTo has drifted', async () => {
      // Live asset is already assigned to e_99 — the dialog had stale WH state.
      mocks.asset.data = {
        assetId: 'a_1',
        assignedTo: EMP('e_99'),
        statusId: 'assigned',
        branchId: 'b_main',
      };

      await expect(
        createAssignmentEvent(
          {
            assetId: 'a_1',
            fromAssignment: WH,
            toAssignment: EMP('e_5'),
            occurredAt: new Date('2026-05-07T10:00:00Z'),
          },
          ACTOR
        )
      ).rejects.toBeInstanceOf(AssignmentConflictError);

      // Conflict means NO writes happened.
      expect(mocks.capturedTx.sets).toHaveLength(0);
      expect(mocks.capturedTx.updates).toHaveLength(0);
    });

    it('attaches expected/actual snapshots to the conflict error', async () => {
      mocks.asset.data = {
        assetId: 'a_1',
        assignedTo: EMP('e_99'),
        statusId: 'assigned',
        branchId: 'b_main',
      };

      try {
        await createAssignmentEvent(
          {
            assetId: 'a_1',
            fromAssignment: WH,
            toAssignment: EMP('e_5'),
            occurredAt: new Date('2026-05-07T10:00:00Z'),
          },
          ACTOR
        );
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(AssignmentConflictError);
        expect(err.code).toBe('assignment/conflict');
        expect(err.expected).toEqual(WH);
        expect(err.actual).toEqual(EMP('e_99'));
      }
    });

    it('passes when warehouse expected and warehouse live (id normalized to null)', async () => {
      // Live data carries id:'' (some legacy shape) — comparableAssigned
      // normalizes both sides so this still matches.
      mocks.asset.data = {
        assetId: 'a_1',
        assignedTo: { kind: 'warehouse', id: '' },
        statusId: 'warehouse',
        branchId: 'b_main',
      };

      await expect(
        createAssignmentEvent(
          {
            assetId: 'a_1',
            fromAssignment: WH,
            toAssignment: EMP('e_5'),
            occurredAt: new Date('2026-05-07T10:00:00Z'),
          },
          ACTOR
        )
      ).resolves.toBeTruthy();
    });

    it('throws asset-not-found when the asset doc does not exist', async () => {
      mocks.asset = { exists: false };

      await expect(
        createAssignmentEvent(
          {
            assetId: 'a_missing',
            fromAssignment: WH,
            toAssignment: EMP('e_5'),
            occurredAt: new Date(),
          },
          ACTOR
        )
      ).rejects.toThrow(/asset not found/);
    });
  });

  describe('createAssignmentEvent — issue (warehouse → employee)', () => {
    it('updates statusId to "assigned" and clears branchId', async () => {
      const eventId = await createAssignmentEvent(
        {
          assetId: 'a_1',
          fromAssignment: WH,
          toAssignment: EMP('e_5'),
          occurredAt: new Date('2026-05-07T10:00:00Z'),
        },
        ACTOR
      );

      expect(typeof eventId).toBe('string');

      // 1 update (asset patch) + 2 sets (event + audit).
      expect(mocks.capturedTx.updates).toHaveLength(1);
      expect(mocks.capturedTx.sets).toHaveLength(2);

      const patch = mocks.capturedTx.updates[0].data;
      expect(patch).toMatchObject({
        assignedTo: EMP('e_5'),
        statusId: 'assigned',
        branchId: null,
        updatedBy: 'u_admin',
        updatedAt: 'SERVER_TS',
      });
    });

    it('writes the event doc with eventType="issue" and the input fields', async () => {
      const eventId = await createAssignmentEvent(
        {
          assetId: 'a_1',
          fromAssignment: WH,
          toAssignment: EMP('e_5'),
          occurredAt: new Date('2026-05-07T10:00:00Z'),
          notes: 'first issue',
        },
        ACTOR
      );

      const eventSet = mocks.capturedTx.sets[0];
      expect(eventSet.data).toMatchObject({
        eventId,
        assetId: 'a_1',
        fromAssignment: WH,
        toAssignment: EMP('e_5'),
        eventType: 'issue',
        notes: 'first issue',
        actUploadPath: null,
        actorUid: 'u_admin',
        actorRole: 'asset_admin',
        createdAt: 'SERVER_TS',
      });
      expect(eventSet.data.occurredAt).toEqual({
        __ts: new Date('2026-05-07T10:00:00Z').valueOf(),
      });
    });

    it('writes an audit row with action="issue" and entity="assignment"', async () => {
      const eventId = await createAssignmentEvent(
        {
          assetId: 'a_1',
          fromAssignment: WH,
          toAssignment: EMP('e_5'),
          occurredAt: new Date('2026-05-07T10:00:00Z'),
          notes: 'first issue',
        },
        ACTOR
      );

      const auditSet = mocks.capturedTx.sets[1];
      expect(auditSet.data).toMatchObject({
        __audit: true,
        entity: 'assignment',
        entityId: eventId,
        action: 'issue',
        actorUid: 'u_admin',
        actorRole: 'asset_admin',
        relatedAssetId: 'a_1',
        relatedEmployeeId: 'e_5',
      });
      expect(auditSet.data.before).toEqual({
        assignedTo: WH,
        statusId: 'warehouse',
      });
      expect(auditSet.data.after).toEqual({
        assignedTo: EMP('e_5'),
        statusId: 'assigned',
      });
      expect(auditSet.data.meta).toMatchObject({
        eventType: 'issue',
        notes: 'first issue',
        actUploadPath: null,
      });
    });
  });

  describe('createAssignmentEvent — return (employee → warehouse)', () => {
    beforeEach(() => {
      mocks.asset.data = {
        assetId: 'a_1',
        assignedTo: EMP('e_5'),
        statusId: 'assigned',
        branchId: null,
      };
    });

    it('updates statusId to "warehouse" and writes assignedTo=warehouse', async () => {
      await createAssignmentEvent(
        {
          assetId: 'a_1',
          fromAssignment: EMP('e_5'),
          toAssignment: WH,
          occurredAt: new Date('2026-05-07T10:00:00Z'),
        },
        ACTOR
      );

      const patch = mocks.capturedTx.updates[0].data;
      expect(patch).toMatchObject({
        assignedTo: WH,
        statusId: 'warehouse',
      });
      // Returns to warehouse must NOT clear branchId — only employee/dept moves do.
      expect(patch.branchId).toBeUndefined();
    });

    it('writes event with eventType="return"', async () => {
      await createAssignmentEvent(
        {
          assetId: 'a_1',
          fromAssignment: EMP('e_5'),
          toAssignment: WH,
          occurredAt: new Date('2026-05-07T10:00:00Z'),
          notes: 'returned to central',
        },
        ACTOR
      );

      expect(mocks.capturedTx.sets[0].data.eventType).toBe('return');
      expect(mocks.capturedTx.sets[1].data.action).toBe('return');
    });

    it('audit relatedEmployeeId picks up the FROM side when target is warehouse', async () => {
      await createAssignmentEvent(
        {
          assetId: 'a_1',
          fromAssignment: EMP('e_5'),
          toAssignment: WH,
          occurredAt: new Date('2026-05-07T10:00:00Z'),
        },
        ACTOR
      );

      expect(mocks.capturedTx.sets[1].data.relatedEmployeeId).toBe('e_5');
    });
  });

  describe('createAssignmentEvent — transfer (employee → branch)', () => {
    beforeEach(() => {
      mocks.asset.data = {
        assetId: 'a_1',
        assignedTo: EMP('e_5'),
        statusId: 'assigned',
        branchId: null,
      };
    });

    it('keeps the existing statusId (transfer never bumps status)', async () => {
      await createAssignmentEvent(
        {
          assetId: 'a_1',
          fromAssignment: EMP('e_5'),
          toAssignment: BR('b_2'),
          occurredAt: new Date('2026-05-07T10:00:00Z'),
        },
        ACTOR
      );

      const patch = mocks.capturedTx.updates[0].data;
      expect(patch.assignedTo).toEqual(BR('b_2'));
      // statusId is omitted from the patch when it doesn't change.
      expect(patch.statusId).toBeUndefined();
    });

    it('writes event with eventType="transfer" and action="transfer"', async () => {
      await createAssignmentEvent(
        {
          assetId: 'a_1',
          fromAssignment: EMP('e_5'),
          toAssignment: BR('b_2'),
          occurredAt: new Date('2026-05-07T10:00:00Z'),
        },
        ACTOR
      );

      expect(mocks.capturedTx.sets[0].data.eventType).toBe('transfer');
      expect(mocks.capturedTx.sets[1].data.action).toBe('transfer');
    });

    it('does NOT clear branchId on transfer to a branch holder', async () => {
      await createAssignmentEvent(
        {
          assetId: 'a_1',
          fromAssignment: EMP('e_5'),
          toAssignment: BR('b_2'),
          occurredAt: new Date('2026-05-07T10:00:00Z'),
        },
        ACTOR
      );

      // Only employee/department targets clear branchId in this Wave.
      expect(mocks.capturedTx.updates[0].data.branchId).toBeUndefined();
    });

    it('clears branchId when transferring TO a department', async () => {
      await createAssignmentEvent(
        {
          assetId: 'a_1',
          fromAssignment: EMP('e_5'),
          toAssignment: DEP('d_3'),
          occurredAt: new Date('2026-05-07T10:00:00Z'),
        },
        ACTOR
      );

      expect(mocks.capturedTx.updates[0].data.branchId).toBe(null);
    });

    it('clears branchId when transferring TO another employee', async () => {
      await createAssignmentEvent(
        {
          assetId: 'a_1',
          fromAssignment: EMP('e_5'),
          toAssignment: EMP('e_9'),
          occurredAt: new Date('2026-05-07T10:00:00Z'),
        },
        ACTOR
      );

      expect(mocks.capturedTx.updates[0].data.branchId).toBe(null);
    });
  });

  describe('createAssignmentEvent — guards', () => {
    it('rejects a missing actor.uid', async () => {
      await expect(
        createAssignmentEvent(
          {
            assetId: 'a_1',
            fromAssignment: WH,
            toAssignment: EMP('e_5'),
            occurredAt: new Date(),
          },
          {}
        )
      ).rejects.toThrow(/actor\.uid/);
    });

    it('rejects no-op moves before the transaction even runs', async () => {
      mocks.asset.data = {
        assetId: 'a_1',
        assignedTo: EMP('e_5'),
        statusId: 'assigned',
        branchId: null,
      };
      // Pre-clear: validation throws BEFORE runTransaction, so the
      // mock's auto-reset (which fires inside runTransaction) never
      // runs. Anything captured from a prior `it` would otherwise leak.
      mocks.capturedTx = { sets: [], updates: [], gets: [] };

      await expect(
        createAssignmentEvent(
          {
            assetId: 'a_1',
            fromAssignment: EMP('e_5'),
            toAssignment: EMP('e_5'),
            occurredAt: new Date(),
          },
          ACTOR
        )
      ).rejects.toThrow(/invalid input/);

      // No writes happened — guard is pre-transaction.
      expect(mocks.capturedTx.sets).toHaveLength(0);
      expect(mocks.capturedTx.updates).toHaveLength(0);
    });
  });

  describe('subscribeAssignmentEventsByAsset', () => {
    it('attaches an onSnapshot listener and returns the unsubscribe', () => {
      const unsub = subscribeAssignmentEventsByAsset('a_1', vi.fn());
      expect(unsub).toBe(mocks.onSnapshotUnsub);
    });
  });
});
