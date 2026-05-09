import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/firebase/index.js', () => ({ db: { __mock: true } }));

const txMock = { get: vi.fn(), set: vi.fn() };

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((parent, ...segments) => ({ __doc: segments })),
  getDoc: vi.fn(),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __sentinel: 'serverTimestamp' })),
  runTransaction: vi.fn(async (_db, fn) => fn(txMock)),
}));

import * as firestore from 'firebase/firestore';
import {
  getNotificationSettings,
  setNotificationSettings,
  subscribeToNotificationSettings,
  firestoreNotificationSettingsRepository,
} from '@/infra/repositories/firestoreNotificationSettingsRepository.js';

beforeEach(() => {
  vi.clearAllMocks();
  txMock.get.mockReset();
  txMock.set.mockReset();
});

describe('firestoreNotificationSettingsRepository — get', () => {
  it('returns the doc data when present', async () => {
    firestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ licenseExpiryWarningDays: 45 }),
    });
    expect(await getNotificationSettings()).toEqual({
      licenseExpiryWarningDays: 45,
    });
  });

  it('returns null when the doc is missing', async () => {
    firestore.getDoc.mockResolvedValueOnce({ exists: () => false });
    expect(await getNotificationSettings()).toBeNull();
  });
});

describe('firestoreNotificationSettingsRepository — set', () => {
  it('writes the doc and an audit row inside one transaction', async () => {
    txMock.get.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ licenseExpiryWarningDays: 30 }),
    });
    await setNotificationSettings(
      { licenseExpiryWarningDays: 45 },
      { uid: 'u1', role: 'super_admin' }
    );
    expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
    expect(txMock.set).toHaveBeenCalledTimes(2);
  });

  it('rejects out-of-range values', async () => {
    await expect(
      setNotificationSettings(
        { licenseExpiryWarningDays: 999 },
        { uid: 'u1', role: 'super_admin' }
      )
    ).rejects.toThrow();
  });
});

describe('firestoreNotificationSettingsRepository — frozen API', () => {
  it('exposes the named helpers and is frozen', () => {
    expect(firestoreNotificationSettingsRepository.getNotificationSettings).toBe(
      getNotificationSettings
    );
    expect(firestoreNotificationSettingsRepository.setNotificationSettings).toBe(
      setNotificationSettings
    );
    expect(firestoreNotificationSettingsRepository.subscribeToNotificationSettings).toBe(
      subscribeToNotificationSettings
    );
    expect(Object.isFrozen(firestoreNotificationSettingsRepository)).toBe(true);
  });
});
