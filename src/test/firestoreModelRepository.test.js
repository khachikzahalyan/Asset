import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/firebase/index.js', () => ({ db: { __mock: true } }));

const txMock = { get: vi.fn(), set: vi.fn(), update: vi.fn() };

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((parent, id) => ({ __doc: id, __parent: parent })),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((field, op, value) => ({ __where: { field, op, value } })),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __sentinel: 'serverTimestamp' })),
  runTransaction: vi.fn(async (_db, fn) => fn(txMock)),
  Timestamp: { now: () => ({ __ts: 'now' }) },
}));

import * as firestore from 'firebase/firestore';
import {
  firestoreModelRepository,
  createModel,
  updateModel,
  setModelActive,
  subscribeToModels,
} from '@/infra/repositories/firestoreModelRepository.js';
import { ModelIdConflictError } from '@/domain/models.js';

beforeEach(() => {
  vi.clearAllMocks();
  txMock.get.mockReset();
  txMock.set.mockReset();
  txMock.update.mockReset();
});

describe('firestoreModelRepository — createModel', () => {
  it('writes the model and an audit log inside one transaction', async () => {
    txMock.get.mockResolvedValueOnce({ exists: () => false });
    await createModel(
      { brandId: 'hp', name: 'EliteBook 840 G6' },
      { uid: 'u1', role: 'super_admin' }
    );
    expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
    expect(txMock.set).toHaveBeenCalledTimes(2);
  });

  it('throws ModelIdConflictError when doc already exists', async () => {
    txMock.get.mockResolvedValueOnce({ exists: () => true });
    await expect(
      createModel(
        { brandId: 'hp', name: 'EliteBook 840 G6' },
        { uid: 'u1', role: 'super_admin' }
      )
    ).rejects.toBeInstanceOf(ModelIdConflictError);
  });
});

describe('firestoreModelRepository — updateModel', () => {
  it('writes the diff and an audit log', async () => {
    txMock.get.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ brandId: 'hp', name: 'EliteBook', isActive: true }),
    });
    await updateModel(
      'hp_elitebook',
      { name: 'EliteBook 840' },
      { uid: 'u1', role: 'super_admin' }
    );
    expect(txMock.set).toHaveBeenCalledTimes(1);
    expect(txMock.update).toHaveBeenCalledTimes(1);
  });
});

describe('firestoreModelRepository — subscribeToModels filters by brand', () => {
  it('builds a where(brandId == X) query when brandId is provided', () => {
    subscribeToModels({ brandId: 'hp', onData: () => {} });
    expect(firestore.where).toHaveBeenCalledWith('brandId', '==', 'hp');
  });

  it('builds an unfiltered query when brandId is omitted', () => {
    subscribeToModels({ onData: () => {} });
    expect(firestore.where).not.toHaveBeenCalled();
  });

  it('builds an unfiltered query when brandId is null', () => {
    subscribeToModels({ brandId: null, onData: () => {} });
    expect(firestore.where).not.toHaveBeenCalled();
  });
});

describe('firestoreModelRepository — frozen API', () => {
  it('exposes the named helpers and a frozen object', () => {
    expect(firestoreModelRepository.createModel).toBe(createModel);
    expect(firestoreModelRepository.updateModel).toBe(updateModel);
    expect(firestoreModelRepository.setModelActive).toBe(setModelActive);
    expect(firestoreModelRepository.subscribeToModels).toBe(subscribeToModels);
    expect(Object.isFrozen(firestoreModelRepository)).toBe(true);
  });
});
