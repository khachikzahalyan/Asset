import { describe, it, expect, vi, beforeEach } from 'vitest';

// Local mock for `firebase/firestore` so we can capture the query modifiers
// the adapter passes in and shape the returned docs.
const mocks = vi.hoisted(() => ({
  // The most recent call to `query()` records its modifiers here so each
  // test can introspect what the adapter built.
  lastQuery: null,
  /** Docs that getDocs() will hand back next. */
  nextDocs: [],
  // Knob to make getDocs throw — exercises the `useAuditLogs` error path.
  nextError: null,
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  query: vi.fn((coll, ...modifiers) => {
    const built = { __collection: coll.__collection, modifiers };
    mocks.lastQuery = built;
    return built;
  }),
  where: vi.fn((field, op, value) => ({ __kind: 'where', field, op, value })),
  orderBy: vi.fn((field, dir) => ({ __kind: 'orderBy', field, dir })),
  limit: vi.fn((n) => ({ __kind: 'limit', n })),
  getDocs: vi.fn(async () => {
    if (mocks.nextError) throw mocks.nextError;
    return {
      docs: mocks.nextDocs.map((d) => ({
        id: d.id,
        data: () => {
          const { id: _ignore, ...rest } = d;
          return rest;
        },
      })),
    };
  }),
  getFirestore: vi.fn(() => ({})),
}));

vi.mock('@/lib/firebase/index.js', () => ({
  db: { __db: true },
}));

import {
  listForEntity,
  firestoreAuditRepository,
} from '@/infra/repositories/firestoreAuditRepository.js';

beforeEach(() => {
  mocks.lastQuery = null;
  mocks.nextDocs = [];
  mocks.nextError = null;
});

describe('firestoreAuditRepository', () => {
  it('exports a frozen adapter object matching the port shape', () => {
    expect(firestoreAuditRepository).toMatchObject({
      listForEntity: expect.any(Function),
    });
    expect(Object.isFrozen(firestoreAuditRepository)).toBe(true);
  });

  it('returns an empty array when entity or entityId is missing', async () => {
    expect(await listForEntity(null, 'e1')).toEqual([]);
    expect(await listForEntity('employee', '')).toEqual([]);
    // No query was even constructed.
    expect(mocks.lastQuery).toBeNull();
  });

  it('builds a query with where(entity), where(entityId), orderBy(at desc), limit', async () => {
    mocks.nextDocs = [];
    await listForEntity('employee', 'emp_42', { limit: 10 });

    expect(mocks.lastQuery).not.toBeNull();
    expect(mocks.lastQuery.__collection).toBe('audit_logs');
    const { modifiers } = mocks.lastQuery;
    expect(modifiers).toEqual([
      { __kind: 'where', field: 'entity', op: '==', value: 'employee' },
      { __kind: 'where', field: 'entityId', op: '==', value: 'emp_42' },
      { __kind: 'orderBy', field: 'at', dir: 'desc' },
      { __kind: 'limit', n: 10 },
    ]);
  });

  it('defaults the limit to 50 when not provided', async () => {
    await listForEntity('asset', 'a_1');
    const limitMod = mocks.lastQuery.modifiers.find((m) => m.__kind === 'limit');
    expect(limitMod.n).toBe(50);
  });

  it('maps Firestore docs into AuditLog shape with auditId from doc id', async () => {
    mocks.nextDocs = [
      {
        id: 'audit_a',
        entity: 'employee',
        entityId: 'emp_1',
        action: 'create',
        actorUid: 'u_1',
        actorRole: 'super_admin',
        before: null,
        after: { firstName: 'A' },
        at: { __ts: 1 },
      },
      {
        id: 'audit_b',
        entity: 'employee',
        entityId: 'emp_1',
        action: 'update',
        actorUid: 'u_2',
        actorRole: 'asset_admin',
        before: { firstName: 'A' },
        after: { firstName: 'B' },
        changedKeys: ['firstName'],
        at: { __ts: 2 },
      },
    ];
    const out = await listForEntity('employee', 'emp_1');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      auditId: 'audit_a',
      entity: 'employee',
      entityId: 'emp_1',
      action: 'create',
    });
    expect(out[1]).toMatchObject({
      auditId: 'audit_b',
      action: 'update',
      changedKeys: ['firstName'],
    });
  });

  it('propagates errors from getDocs to the caller', async () => {
    mocks.nextError = new Error('permission-denied');
    await expect(listForEntity('employee', 'emp_x')).rejects.toThrow(
      'permission-denied'
    );
  });
});
