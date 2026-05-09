import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/firebase/index.js', () => ({ db: { __mock: true } }));

const txMock = { get: vi.fn(), set: vi.fn() };

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((parent, ...segments) => ({ __doc: segments, __parent: parent })),
  getDoc: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __sentinel: 'serverTimestamp' })),
  runTransaction: vi.fn(async (_db, fn) => fn(txMock)),
  Timestamp: { now: () => ({ __ts: 'now' }) },
}));

import * as firestore from 'firebase/firestore';
import {
  getLicenseKey,
  setLicenseKey,
  firestoreLicenseSecretRepository,
} from '@/infra/repositories/firestoreLicenseSecretRepository.js';

beforeEach(() => {
  vi.clearAllMocks();
  txMock.get.mockReset();
  txMock.set.mockReset();
});

describe('firestoreLicenseSecretRepository — getLicenseKey', () => {
  it('returns the key value (string) when the doc exists', async () => {
    firestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ value: 'ABC-123', updatedAt: 't', updatedBy: 'u1' }),
    });
    expect(await getLicenseKey('a1')).toBe('ABC-123');
  });

  it('returns null when the doc does not exist', async () => {
    firestore.getDoc.mockResolvedValueOnce({ exists: () => false });
    expect(await getLicenseKey('a1')).toBeNull();
  });
});

describe('firestoreLicenseSecretRepository — setLicenseKey', () => {
  it('writes the secret and a sanitised audit log inside one transaction', async () => {
    // Fix 6: first get = asset doc (category guard), second get = secret doc.
    txMock.get
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ categoryId: 'license' }) })
      .mockResolvedValueOnce({ exists: () => false });
    await setLicenseKey('a1', 'TOP-SECRET-KEY', { uid: 'u1', role: 'tech_admin' });
    expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
    expect(txMock.set).toHaveBeenCalledTimes(2);
    const auditCallArgs = txMock.set.mock.calls.find((args) =>
      JSON.stringify(args).includes('"entity":"asset"')
    );
    expect(auditCallArgs).toBeDefined();
    expect(JSON.stringify(auditCallArgs)).not.toContain('TOP-SECRET-KEY');
  });

  it('thrown errors NEVER contain the key value', async () => {
    txMock.get.mockRejectedValueOnce(new Error('boom'));
    try {
      await setLicenseKey('a1', 'SUPER-PRIVATE-KEY', {
        uid: 'u1',
        role: 'tech_admin',
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.message).not.toContain('SUPER-PRIVATE-KEY');
    }
  });

  it('rejects empty values without ever embedding them in the error', async () => {
    await expect(
      setLicenseKey('a1', '   ', { uid: 'u1', role: 'tech_admin' })
    ).rejects.toThrow();
  });
});

describe('firestoreLicenseSecretRepository — frozen API', () => {
  it('exposes the named helpers and a frozen object', () => {
    expect(firestoreLicenseSecretRepository.getLicenseKey).toBe(getLicenseKey);
    expect(firestoreLicenseSecretRepository.setLicenseKey).toBe(setLicenseKey);
    expect(Object.isFrozen(firestoreLicenseSecretRepository)).toBe(true);
  });
});
