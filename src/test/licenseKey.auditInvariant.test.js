/**
 * Audit-invariant test: the literal license-key value must NEVER appear in
 * any field of an audit_logs row written by setLicenseKey().
 *
 * This is the third protective layer around license secrets:
 *   1. Firestore rules deny direct reads of the secrets subcollection.
 *   2. sanitizeLicenseKeyDiff strips 'licenseKey' / 'secrets.key' from diffs.
 *   3. This test proves the audit row written during setLicenseKey() is clean.
 *
 * The test inspects every `tx.set()` call that targets audit_logs and
 * asserts that the serialised call arguments contain no trace of the key.
 */

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

import { setLicenseKey } from '@/infra/repositories/firestoreLicenseSecretRepository.js';

beforeEach(() => {
  vi.clearAllMocks();
  txMock.get.mockReset();
  txMock.set.mockReset();
});

describe('License-key audit invariant', () => {
  it('audit row written by setLicenseKey does not contain the literal key value (new key)', async () => {
    // Fix 6: setLicenseKey now reads the asset doc first (category guard),
    // then reads the secret doc. Both are tx.get calls.
    txMock.get
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ categoryId: 'license' }) }) // asset doc
      .mockResolvedValueOnce({ exists: () => false }); // secret doc (new key)

    const SECRET_VALUE = 'AAAA-BBBB-CCCC-DDDD-TOP-SECRET';
    await setLicenseKey('asset-99', SECRET_VALUE, { uid: 'actor-uid', role: 'tech_admin' });

    // Find the tx.set() call that targets audit_logs.
    const auditCall = txMock.set.mock.calls.find((args) => {
      // The second arg is the data object being set.
      return JSON.stringify(args).includes('"entity":"asset"');
    });

    expect(auditCall, 'Expected an audit row to be written').toBeDefined();

    const serialised = JSON.stringify(auditCall);
    expect(serialised).not.toContain(SECRET_VALUE);
  });

  it('audit row written by setLicenseKey does not contain the literal key value (key rotation)', async () => {
    // Fix 6: asset doc (category guard) + existing secret doc (rotation).
    txMock.get
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ categoryId: 'license' }) }) // asset doc
      .mockResolvedValueOnce({ exists: () => true }); // secret doc exists (rotation)

    const SECRET_VALUE = 'ROTATE-ME-XXXX-YYYY-ZZZZ-PRIVATE';
    await setLicenseKey('asset-42', SECRET_VALUE, { uid: 'actor-uid', role: 'tech_admin' });

    const auditCall = txMock.set.mock.calls.find((args) =>
      JSON.stringify(args).includes('"entity":"asset"')
    );

    expect(auditCall, 'Expected an audit row to be written on key rotation').toBeDefined();

    const serialised = JSON.stringify(auditCall);
    expect(serialised).not.toContain(SECRET_VALUE);
  });

  it('audit rows from transferLicenseKey do not contain the literal key value', async () => {
    // Fix 3 + audit invariant: transferLicenseKey moves a key between assets.
    // Neither audit row (transferred_out, transferred_in) may contain the key.
    const { transferLicenseKey } = await import(
      '@/infra/repositories/firestoreLicenseSecretRepository.js'
    );

    const SECRET_VALUE = 'TRANSFER-KEY-SECRET-XYZ';

    // Transfer mock: 4 gets (fromAsset, toAsset, fromSecret, toSecret).
    txMock.get
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ categoryId: 'license', statusId: 'written_off' }) })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ categoryId: 'license', statusId: 'warehouse' }) })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ value: SECRET_VALUE }) })
      .mockResolvedValueOnce({ exists: () => false });

    txMock.delete = vi.fn(); // transferLicenseKey calls tx.delete

    await transferLicenseKey({
      fromAssetId: 'from-99',
      toAssetId: 'to-99',
      actor: { uid: 'actor-uid', role: 'tech_admin' },
    });

    const auditCalls = txMock.set.mock.calls.filter((args) =>
      JSON.stringify(args).includes('"entity":"asset"')
    );
    expect(auditCalls.length).toBeGreaterThanOrEqual(2);

    const serialised = JSON.stringify(auditCalls);
    expect(serialised).not.toContain(SECRET_VALUE);
  });
});
