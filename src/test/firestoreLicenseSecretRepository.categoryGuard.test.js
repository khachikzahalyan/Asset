/**
 * Wave-A Fix 6 — setLicenseKey category guard tests.
 *
 * Verifies that setLicenseKey rejects writes to non-license-category assets.
 * Also mirrors the firestore.rules change for the secrets subcollection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/firebase/index.js', () => ({ db: { __mock: true } }));

const txMock = { get: vi.fn(), set: vi.fn() };

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((_parent, ...segments) => ({ __doc: segments })),
  getDoc: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __sentinel: 'serverTimestamp' })),
  runTransaction: vi.fn(async (_db, fn) => fn(txMock)),
  Timestamp: { now: () => ({ __ts: 'now' }) },
}));

const auditMocks = vi.hoisted(() => ({
  newAuditLogRef: vi.fn(() => ({ __auditRef: true })),
  buildAuditLog: vi.fn((args) => ({ __audit: true, ...args })),
}));
vi.mock('@/lib/audit/auditHelper.js', () => auditMocks);

import { setLicenseKey } from '@/infra/repositories/firestoreLicenseSecretRepository.js';
import { LicenseKeyOnNonLicenseError } from '@/domain/assets.js';

beforeEach(() => {
  vi.clearAllMocks();
  txMock.get.mockReset();
  txMock.set.mockReset();
  auditMocks.newAuditLogRef.mockImplementation(() => ({ __auditRef: true }));
  auditMocks.buildAuditLog.mockImplementation((args) => ({ __audit: true, ...args }));
});

// ---------------------------------------------------------------------------
// Fix 6: category guard
// ---------------------------------------------------------------------------

describe('setLicenseKey — Fix 6: category guard', () => {
  it('proceeds when asset categoryId === "license"', async () => {
    // First get = asset doc, second get = secret doc.
    txMock.get
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ categoryId: 'license' }) })
      .mockResolvedValueOnce({ exists: () => false }); // no existing secret

    await expect(
      setLicenseKey('a-license', 'AAAA-BBBB-CCCC-DDDD', { uid: 'u1', role: 'tech_admin' })
    ).resolves.toBeUndefined();

    // Both the secret doc and the audit log should be written.
    expect(txMock.set).toHaveBeenCalledTimes(2);
  });

  it('throws LicenseKeyOnNonLicenseError when categoryId is "device"', async () => {
    txMock.get
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ categoryId: 'device' }) });

    await expect(
      setLicenseKey('a-device', 'AAAA-BBBB-CCCC-DDDD', { uid: 'u1', role: 'tech_admin' })
    ).rejects.toBeInstanceOf(LicenseKeyOnNonLicenseError);
  });

  it('throws LicenseKeyOnNonLicenseError when categoryId is "furniture"', async () => {
    txMock.get
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ categoryId: 'furniture' }) });

    await expect(
      setLicenseKey('a-furniture', 'KEY-VALUE', { uid: 'u1', role: 'tech_admin' })
    ).rejects.toBeInstanceOf(LicenseKeyOnNonLicenseError);
  });

  it('error message does NOT contain the key value (no key leakage)', async () => {
    txMock.get
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ categoryId: 'device' }) });

    const SECRET = 'SUPER-SECRET-KEY-XYZ';
    try {
      await setLicenseKey('a-device', SECRET, { uid: 'u1', role: 'tech_admin' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.message).not.toContain(SECRET);
    }
  });

  it('allows when asset doc does not exist (no categoryId constraint applies)', async () => {
    // When the asset doc doesn't exist, we cannot enforce the category.
    // The repo skips the check (no categoryId to compare against).
    txMock.get
      .mockResolvedValueOnce({ exists: () => false }) // asset not found
      .mockResolvedValueOnce({ exists: () => false }); // no existing secret

    await expect(
      setLicenseKey('a-missing', 'AAAA-BBBB-CCCC-DDDD', { uid: 'u1', role: 'tech_admin' })
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fix 6: rules-mirror predicate
// ---------------------------------------------------------------------------

describe('rules mirror — Fix 6: secrets create requires license categoryId', () => {
  // Mirror: get(assets/assetId).data.categoryId == 'license'
  function canWriteSecret(assetCategoryId) {
    return assetCategoryId === 'license';
  }

  it('allows license category', () => {
    expect(canWriteSecret('license')).toBe(true);
  });

  it('rejects device category', () => {
    expect(canWriteSecret('device')).toBe(false);
  });

  it('rejects furniture category', () => {
    expect(canWriteSecret('furniture')).toBe(false);
  });

  it('rejects null/undefined category', () => {
    expect(canWriteSecret(null)).toBe(false);
    expect(canWriteSecret(undefined)).toBe(false);
  });
});
