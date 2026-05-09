import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/firebase/index.js', () => ({
  db: { __mock: true },
}));

const txMock = {
  get: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((parent, id) => ({ __doc: id, __parent: parent })),
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((field, op, value) => ({ __where: { field, op, value } })),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __sentinel: 'serverTimestamp' })),
  runTransaction: vi.fn(async (_db, fn) => fn(txMock)),
  Timestamp: {
    now: () => ({ __ts: 'now' }),
    fromDate: (d) => ({ __ts: d.toISOString() }),
  },
}));

import * as firestore from 'firebase/firestore';
import {
  firestoreBrandRepository,
  createBrand,
  updateBrand,
  setBrandActive,
} from '@/infra/repositories/firestoreBrandRepository.js';
import { BrandIdConflictError, BrandInUseError as _BrandInUseError } from '@/domain/brands.js';

beforeEach(() => {
  vi.clearAllMocks();
  txMock.get.mockReset();
  txMock.set.mockReset();
  txMock.update.mockReset();
});

describe('firestoreBrandRepository — createBrand', () => {
  it('writes the brand and an audit log inside one transaction', async () => {
    txMock.get.mockResolvedValueOnce({ exists: () => false });
    await createBrand({ name: 'HP' }, { uid: 'u1', role: 'super_admin' });
    expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
    expect(txMock.set).toHaveBeenCalledTimes(2); // brand + audit
  });

  it('throws BrandIdConflictError when doc already exists', async () => {
    txMock.get.mockResolvedValueOnce({ exists: () => true });
    await expect(
      createBrand({ name: 'HP' }, { uid: 'u1', role: 'super_admin' })
    ).rejects.toBeInstanceOf(BrandIdConflictError);
  });
});

describe('firestoreBrandRepository — updateBrand', () => {
  it('writes the diff and an audit log', async () => {
    txMock.get.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ name: 'HP', isActive: true }),
    });
    await updateBrand('hp', { name: 'HP Inc.' }, { uid: 'u1', role: 'super_admin' });
    expect(txMock.set).toHaveBeenCalledTimes(1); // audit
    expect(txMock.update).toHaveBeenCalledTimes(1); // brand
  });
});

describe('firestoreBrandRepository — setBrandActive', () => {
  it('flips isActive and audits', async () => {
    txMock.get.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ name: 'HP', isActive: true }),
    });
    await setBrandActive('hp', false, { uid: 'u1', role: 'super_admin' });
    expect(txMock.set).toHaveBeenCalledTimes(1); // audit
    expect(txMock.update).toHaveBeenCalledTimes(1);
  });
});

describe('firestoreBrandRepository — frozen API', () => {
  it('exposes the named helpers and a frozen object', () => {
    expect(firestoreBrandRepository.createBrand).toBe(createBrand);
    expect(firestoreBrandRepository.updateBrand).toBe(updateBrand);
    expect(firestoreBrandRepository.setBrandActive).toBe(setBrandActive);
    expect(Object.isFrozen(firestoreBrandRepository)).toBe(true);
  });
});
