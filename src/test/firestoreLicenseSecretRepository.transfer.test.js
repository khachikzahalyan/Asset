/**
 * Wave-A Fix 3 — transferLicenseKey tests.
 *
 * Tests:
 *   - happy path: key moves from source to target.
 *   - source written-off → still allowed (only secret subcollection touched).
 *   - target has existing key → LicenseKeyTargetOccupiedError.
 *   - non-license target → LicenseKeyOnNonLicenseError.
 *   - non-license source → LicenseKeyOnNonLicenseError.
 *   - source has no key → LicenseKeyMissingError.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/firebase/index.js', () => ({ db: { __mock: true } }));

const txMock = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };

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

import {
  transferLicenseKey,
  firestoreLicenseSecretRepository,
} from '@/infra/repositories/firestoreLicenseSecretRepository.js';
import {
  LicenseKeyOnNonLicenseError,
  LicenseKeyMissingError,
  LicenseKeyTargetOccupiedError,
} from '@/domain/assets.js';

const ACTOR = { uid: 'actor-uid', role: 'tech_admin' };
const KEY_VALUE = 'AAAA-BBBB-CCCC-DDDD';

function makeLicenseAsset(statusId = 'assigned') {
  return { exists: () => true, data: () => ({ categoryId: 'license', statusId }) };
}

function makeNonLicenseAsset(categoryId = 'device') {
  return { exists: () => true, data: () => ({ categoryId, statusId: 'warehouse' }) };
}

function makeSecret(hasKey = true) {
  return hasKey
    ? { exists: () => true, data: () => ({ value: KEY_VALUE }) }
    : { exists: () => false };
}

beforeEach(() => {
  vi.clearAllMocks();
  txMock.get.mockReset();
  txMock.set.mockReset();
  txMock.delete.mockReset();
  auditMocks.newAuditLogRef.mockImplementation(() => ({ __auditRef: true }));
  auditMocks.buildAuditLog.mockImplementation((args) => ({ __audit: true, ...args }));
});

// Helper to set up a standard 4-get sequence:
//   [fromAsset, toAsset, fromSecret, toSecret]
function setupGetSequence(fromAsset, toAsset, fromSecret, toSecret) {
  txMock.get
    .mockResolvedValueOnce(fromAsset)
    .mockResolvedValueOnce(toAsset)
    .mockResolvedValueOnce(fromSecret)
    .mockResolvedValueOnce(toSecret);
}

describe('transferLicenseKey — happy path', () => {
  it('moves the key from source to target in one transaction', async () => {
    setupGetSequence(
      makeLicenseAsset('assigned'),
      makeLicenseAsset('warehouse'),
      makeSecret(true),
      makeSecret(false),
    );

    await transferLicenseKey({ fromAssetId: 'from-1', toAssetId: 'to-1', actor: ACTOR });

    // Secret written on target, deleted on source.
    const setCall = txMock.set.mock.calls.find(
      ([ref]) => JSON.stringify(ref).includes('to-1') && JSON.stringify(ref).includes('key')
    );
    expect(setCall).toBeDefined();
    expect(setCall[1].value).toBe(KEY_VALUE);

    const deleteCalled = txMock.delete.mock.calls.some(
      ([ref]) => JSON.stringify(ref).includes('from-1')
    );
    expect(deleteCalled).toBe(true);
  });

  it('writes exactly two audit rows (transferred_out + transferred_in)', async () => {
    setupGetSequence(
      makeLicenseAsset('assigned'),
      makeLicenseAsset('warehouse'),
      makeSecret(true),
      makeSecret(false),
    );

    await transferLicenseKey({ fromAssetId: 'from-1', toAssetId: 'to-1', actor: ACTOR });

    const auditCalls = txMock.set.mock.calls.filter(
      ([, data]) => data?.__audit === true
    );
    expect(auditCalls).toHaveLength(2);

    const actions = auditCalls.map(([, data]) => data.action);
    expect(actions).toContain('license_key_transferred_out');
    expect(actions).toContain('license_key_transferred_in');
  });

  it('audit rows contain only licenseKeySet bool — never the key value', async () => {
    setupGetSequence(
      makeLicenseAsset('assigned'),
      makeLicenseAsset('warehouse'),
      makeSecret(true),
      makeSecret(false),
    );

    await transferLicenseKey({ fromAssetId: 'from-1', toAssetId: 'to-1', actor: ACTOR });

    const auditSerialized = JSON.stringify(txMock.set.mock.calls.filter(
      ([, data]) => data?.__audit === true
    ));
    expect(auditSerialized).not.toContain(KEY_VALUE);
    expect(auditSerialized).toContain('licenseKeySet');
  });
});

describe('transferLicenseKey — source written-off is still allowed', () => {
  it('succeeds even when source asset is in written_off (final) status', async () => {
    // The key point: transferLicenseKey only touches secrets, not the asset doc.
    // A final status DOES NOT block this operation.
    setupGetSequence(
      makeLicenseAsset('written_off'), // final status
      makeLicenseAsset('warehouse'),
      makeSecret(true),
      makeSecret(false),
    );

    await expect(
      transferLicenseKey({ fromAssetId: 'from-1', toAssetId: 'to-1', actor: ACTOR })
    ).resolves.toBeUndefined();
  });
});

describe('transferLicenseKey — target has existing key → rejected', () => {
  it('throws LicenseKeyTargetOccupiedError', async () => {
    setupGetSequence(
      makeLicenseAsset('assigned'),
      makeLicenseAsset('warehouse'),
      makeSecret(true),
      makeSecret(true), // target already has a key
    );

    await expect(
      transferLicenseKey({ fromAssetId: 'from-1', toAssetId: 'to-1', actor: ACTOR })
    ).rejects.toBeInstanceOf(LicenseKeyTargetOccupiedError);
  });
});

describe('transferLicenseKey — non-license target → rejected', () => {
  it('throws LicenseKeyOnNonLicenseError for device target', async () => {
    setupGetSequence(
      makeLicenseAsset('assigned'),
      makeNonLicenseAsset('device'), // non-license target
      makeSecret(true),
      makeSecret(false),
    );

    await expect(
      transferLicenseKey({ fromAssetId: 'from-1', toAssetId: 'to-1', actor: ACTOR })
    ).rejects.toBeInstanceOf(LicenseKeyOnNonLicenseError);
  });
});

describe('transferLicenseKey — non-license source → rejected', () => {
  it('throws LicenseKeyOnNonLicenseError for device source', async () => {
    setupGetSequence(
      makeNonLicenseAsset('device'), // non-license source
      makeLicenseAsset('warehouse'),
      makeSecret(true),
      makeSecret(false),
    );

    await expect(
      transferLicenseKey({ fromAssetId: 'from-1', toAssetId: 'to-1', actor: ACTOR })
    ).rejects.toBeInstanceOf(LicenseKeyOnNonLicenseError);
  });
});

describe('transferLicenseKey — source has no key → rejected', () => {
  it('throws LicenseKeyMissingError', async () => {
    setupGetSequence(
      makeLicenseAsset('assigned'),
      makeLicenseAsset('warehouse'),
      makeSecret(false), // no key on source
      makeSecret(false),
    );

    await expect(
      transferLicenseKey({ fromAssetId: 'from-1', toAssetId: 'to-1', actor: ACTOR })
    ).rejects.toBeInstanceOf(LicenseKeyMissingError);
  });
});

describe('transferLicenseKey — frozen adapter API', () => {
  it('exposes transferLicenseKey on the frozen repo object', () => {
    expect(typeof firestoreLicenseSecretRepository.transferLicenseKey).toBe('function');
    expect(Object.isFrozen(firestoreLicenseSecretRepository)).toBe(true);
  });
});
