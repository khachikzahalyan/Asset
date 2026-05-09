/**
 * Tests for Phase 1.5 extensions to StatusesAndCategoriesBootstrap:
 *   - ensureNotificationSettings()
 *   - ensureLicenseCategoryFlag()
 *
 * These helpers are exported from the bootstrap module and called during the
 * super_admin bootstrap effect. Both are idempotent and best-effort.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Firestore mock -------------------------------------------------------

const getDocMock = vi.fn();
const setDocMock = vi.fn();
const updateDocMock = vi.fn();
const serverTimestampMock = vi.fn(() => ({ __sentinel: 'serverTimestamp' }));
const docMock = vi.fn((_db, col, id) => ({ __col: col, __id: id }));

vi.mock('firebase/firestore', () => ({
  doc: (...args) => docMock(...args),
  getDoc: (...args) => getDocMock(...args),
  setDoc: (...args) => setDocMock(...args),
  updateDoc: (...args) => updateDocMock(...args),
  serverTimestamp: () => serverTimestampMock(),
  // Stubs for symbols imported by the component but not used in these tests.
  collection: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => () => {}),
  runTransaction: vi.fn(async (_db, fn) => fn({ get: vi.fn(), set: vi.fn() })),
}));

vi.mock('@/lib/firebase/index.js', () => ({
  db: { __mock: true },
}));

vi.mock('@/lib/audit/auditHelper.js', () => ({
  buildAuditLog: vi.fn((args) => args),
  newAuditLogRef: vi.fn(() => ({})),
}));

// Repository mocks — not exercised in these tests but imported transitively.
vi.mock('@/infra/repositories/firestoreAssetStatusRepository.js', () => ({
  firestoreAssetStatusRepository: { create: vi.fn(async () => 'id') },
}));
vi.mock('@/infra/repositories/firestoreCategoryRepository.js', () => ({
  firestoreCategoryRepository: { create: vi.fn(async () => 'id') },
}));
vi.mock('@/infra/repositories/firestoreAssetSubtypeRepository.js', () => ({
  firestoreAssetSubtypeRepository: { create: vi.fn(async () => 'id') },
}));

// ---- Import after mocks ---------------------------------------------------

import {
  ensureNotificationSettings,
  ensureLicenseCategoryFlag,
  ensureLicenseCategoryAttachableTo,
  ensureCategoryCanHostLicense,
} from '@/components/system/StatusesAndCategoriesBootstrap.jsx';

// ---- Tests ----------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StatusesAndCategoriesBootstrap — Phase 1.5 extensions', () => {
  // --- ensureNotificationSettings ---

  it('creates /settings/notifications with default warning days when missing', async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => false });

    const actor = { uid: 'super-uid', role: 'super_admin' };
    await ensureNotificationSettings(actor);

    expect(setDocMock).toHaveBeenCalledTimes(1);
    const [, data] = setDocMock.mock.calls[0];
    expect(data.licenseExpiryWarningDays).toBe(30);
    expect(data.updatedBy).toBe('super-uid');
    expect(data.updatedAt).toBeDefined();
  });

  it('does not overwrite /settings/notifications when it already exists', async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => true });

    await ensureNotificationSettings({ uid: 'super-uid', role: 'super_admin' });

    expect(setDocMock).not.toHaveBeenCalled();
  });

  // --- ensureLicenseCategoryFlag ---

  it('patches /categories/license with assignsInventoryCode: false when flag is missing', async () => {
    // The category doc exists but assignsInventoryCode is undefined (truthy-absent).
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ name: { ru: 'Лицензии', en: 'Licenses', hy: 'Լիցենզիաներ' } }),
    });

    await ensureLicenseCategoryFlag();

    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const [, patch] = updateDocMock.mock.calls[0];
    expect(patch).toEqual({ assignsInventoryCode: false });
  });

  it('does not re-patch /categories/license when assignsInventoryCode is already false', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ assignsInventoryCode: false }),
    });

    await ensureLicenseCategoryFlag();

    expect(updateDocMock).not.toHaveBeenCalled();
  });

  // --- ensureLicenseCategoryAttachableTo ---

  it('patches license category attachableTo when it contains forbidden kinds', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ attachableTo: ['warehouse', 'employee'] }),
    });

    await ensureLicenseCategoryAttachableTo();

    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const [, patch] = updateDocMock.mock.calls[0];
    expect(patch).toEqual({ attachableTo: ['asset', 'employee'] });
  });

  it('does not re-patch license category when attachableTo is already exactly [\'asset\', \'employee\']', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ attachableTo: ['asset', 'employee'] }),
    });

    await ensureLicenseCategoryAttachableTo();

    expect(updateDocMock).not.toHaveBeenCalled();
  });

  // --- ensureCategoryCanHostLicense ---

  it('patches device→true and license→false for canHostLicense when fields are missing', async () => {
    // Three getDoc calls: device, furniture, license
    getDocMock
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ name: 'device' }) })   // device — missing
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ canHostLicense: false }) }) // furniture — already correct
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ name: 'license' }) }); // license — missing

    await ensureCategoryCanHostLicense();

    // device and license should be patched; furniture should not
    expect(updateDocMock).toHaveBeenCalledTimes(2);
    const calls = updateDocMock.mock.calls;
    const patches = calls.map(([, p]) => p);
    expect(patches).toContainEqual({ canHostLicense: true });
    expect(patches).toContainEqual({ canHostLicense: false });
  });
});
