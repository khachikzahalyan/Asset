// src/test/firestoreUsersRepository.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ __type: 'collection' })),
  doc: vi.fn((arg, _path, id) => ({ __type: 'docref', id })),
  onSnapshot: vi.fn(() => () => {}),
  query: vi.fn((c, ...rest) => ({ __type: 'query', c, rest })),
  orderBy: vi.fn((field, dir) => ({ __type: 'orderBy', field, dir })),
  serverTimestamp: vi.fn(() => '__SERVER_TS__'),
  runTransaction: vi.fn(async (_db, fn) => {
    await fn({ get: vi.fn(), set: vi.fn(), update: vi.fn() });
  }),
}));
vi.mock('@/lib/firebase/index.js', () => ({ db: { __mock: 'db' } }));
vi.mock('@/lib/audit/auditHelper.js', () => ({
  buildAuditLog: vi.fn((args) => ({ __auditLog: true, ...args })),
  newAuditLogRef: vi.fn(() => ({ __type: 'docref', id: 'audit-1' })),
}));

import * as firestore from 'firebase/firestore';
import { buildAuditLog } from '@/lib/audit/auditHelper.js';
import { firestoreUsersRepository } from '@/infra/repositories/firestoreUsersRepository.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('firestoreUsersRepository', () => {
  it('list subscribes ordered by email ASC', () => {
    firestoreUsersRepository.list(vi.fn(), vi.fn());
    expect(firestore.orderBy).toHaveBeenCalledWith('email', 'asc');
    expect(firestore.onSnapshot).toHaveBeenCalled();
  });

  it('updateRole writes role + audit atomically', async () => {
    const before = { uid: 'u1', email: 'a@b.com', role: 'tech_admin', isActive: true };
    await firestoreUsersRepository.updateRole('u1', 'asset_admin', before, {
      uid: 'super',
      role: 'super_admin',
    });
    const txFn = firestore.runTransaction.mock.calls[0][1];
    const tx = { get: vi.fn(), set: vi.fn(), update: vi.fn() };
    await txFn(tx);
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({ __type: 'docref' }),
      expect.objectContaining({ role: 'asset_admin' })
    );
    expect(buildAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'user', action: 'roleChanged', entityId: 'u1' })
    );
  });

  it('setActive(false) writes deactivated audit', async () => {
    const before = { uid: 'u1', email: 'a@b.com', role: 'tech_admin', isActive: true };
    await firestoreUsersRepository.setActive('u1', false, before, { uid: 'super', role: 'super_admin' });
    expect(buildAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'user', action: 'deactivated', entityId: 'u1' })
    );
  });

  it('setActive(true) writes reactivated audit', async () => {
    const before = { uid: 'u1', email: 'a@b.com', role: 'tech_admin', isActive: false };
    await firestoreUsersRepository.setActive('u1', true, before, { uid: 'super', role: 'super_admin' });
    expect(buildAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'user', action: 'reactivated', entityId: 'u1' })
    );
  });
});
