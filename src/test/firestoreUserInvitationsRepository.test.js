// src/test/firestoreUserInvitationsRepository.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the modular Firestore SDK BEFORE importing the SUT
vi.mock('firebase/firestore', () => {
  const collection = vi.fn(() => ({ __type: 'collection' }));
  const doc = vi.fn((arg, _path, id) => ({ __type: 'docref', id: id ?? `auto-${Math.random()}` }));
  const onSnapshot = vi.fn(() => () => {});
  const query = vi.fn((c, ...rest) => ({ __type: 'query', c, rest }));
  const where = vi.fn((field, op, value) => ({ __type: 'where', field, op, value }));
  const orderBy = vi.fn((field, dir) => ({ __type: 'orderBy', field, dir }));
  const serverTimestamp = vi.fn(() => '__SERVER_TS__');
  const runTransaction = vi.fn(async (_db, fn) => {
    const tx = {
      get: vi.fn(async () => ({ exists: () => false })),
      set: vi.fn(),
      update: vi.fn(),
    };
    await fn(tx);
    return tx;
  });
  return {
    collection,
    doc,
    onSnapshot,
    query,
    where,
    orderBy,
    serverTimestamp,
    runTransaction,
  };
});

vi.mock('@/lib/firebase/index.js', () => ({ db: { __mock: 'db' } }));

vi.mock('@/lib/audit/auditHelper.js', () => ({
  buildAuditLog: vi.fn((args) => ({ __auditLog: true, ...args })),
  newAuditLogRef: vi.fn(() => ({ __type: 'docref', id: 'audit-1' })),
}));

import * as firestore from 'firebase/firestore';
import { buildAuditLog } from '@/lib/audit/auditHelper.js';
import {
  firestoreUserInvitationsRepository,
} from '@/infra/repositories/firestoreUserInvitationsRepository.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('firestoreUserInvitationsRepository', () => {
  it('listPending subscribes with status=pending and orderBy invitedAt DESC', () => {
    const onData = vi.fn();
    const onError = vi.fn();
    firestoreUserInvitationsRepository.listPending(onData, onError);

    expect(firestore.collection).toHaveBeenCalledWith({ __mock: 'db' }, 'userInvitations');
    expect(firestore.where).toHaveBeenCalledWith('status', '==', 'pending');
    expect(firestore.orderBy).toHaveBeenCalledWith('invitedAt', 'desc');
    expect(firestore.onSnapshot).toHaveBeenCalled();
  });

  it('create runs a transaction, writes the invitation and an audit log', async () => {
    await firestoreUserInvitationsRepository.create(
      { email: '  Foo@Bar.COM ', role: 'tech_admin' },
      { uid: 'super-uid', role: 'super_admin' }
    );

    expect(firestore.doc).toHaveBeenCalledWith({ __mock: 'db' }, 'userInvitations', 'foo@bar.com');
    expect(firestore.runTransaction).toHaveBeenCalledTimes(1);

    const txFn = firestore.runTransaction.mock.calls[0][1];
    const tx = {
      get: vi.fn(async () => ({ exists: () => false })),
      set: vi.fn(),
      update: vi.fn(),
    };
    await txFn(tx);

    expect(tx.set).toHaveBeenCalledTimes(2); // invitation doc + audit log
    const [, payload] = tx.set.mock.calls[0];
    expect(payload).toMatchObject({
      email: 'foo@bar.com',
      role: 'tech_admin',
      status: 'pending',
      invitedBy: 'super-uid',
    });
    expect(buildAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'invitation',
        entityId: 'foo@bar.com',
        action: 'create',
        actorUid: 'super-uid',
        actorRole: 'super_admin',
      })
    );
  });

  it('create throws if invitation already exists', async () => {
    firestore.runTransaction.mockImplementationOnce(async (_db, fn) => {
      await fn({
        get: async () => ({ exists: () => true }),
        set: vi.fn(),
        update: vi.fn(),
      });
    });

    await expect(
      firestoreUserInvitationsRepository.create(
        { email: 'a@b.com', role: 'tech_admin' },
        { uid: 'u', role: 'super_admin' }
      )
    ).rejects.toThrow(/already exists/);
  });

  it('revoke updates status and writes an audit log atomically', async () => {
    const before = {
      email: 'a@b.com',
      role: 'tech_admin',
      status: 'pending',
      invitedBy: 'u',
      invitedAt: 't',
    };

    await firestoreUserInvitationsRepository.revoke('a@b.com', before, {
      uid: 'super-uid',
      role: 'super_admin',
    });

    const txFn = firestore.runTransaction.mock.calls[0][1];
    const tx = { get: vi.fn(), set: vi.fn(), update: vi.fn() };
    await txFn(tx);
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({ __type: 'docref' }),
      expect.objectContaining({ status: 'revoked', revokedBy: 'super-uid' })
    );
    expect(buildAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'invitation', action: 'revoke', entityId: 'a@b.com' })
    );
  });
});
