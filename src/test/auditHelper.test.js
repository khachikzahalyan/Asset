import { describe, it, expect, vi } from 'vitest';

// Mock firebase/firestore so buildAuditLog can call serverTimestamp() and
// newAuditLogRef() without a live Firebase project.
vi.mock('firebase/firestore', () => ({
  serverTimestamp: vi.fn(() => '__SERVER_TS__'),
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((_col) => ({ id: '__audit_ref__' })),
}));

vi.mock('@/lib/firebase/index.js', () => ({
  db: { __mock: true },
}));

import { buildAuditLog } from '@/lib/audit/auditHelper.js';

describe('auditHelper — brand / model entities', () => {
  it('accepts entity="brand"', () => {
    expect(() =>
      buildAuditLog({
        entity: 'brand',
        entityId: 'hp',
        action: 'created',
        actorUid: 'u1',
        actorRole: 'super_admin',
        before: null,
        after: { name: 'HP', isActive: true },
      })
    ).not.toThrow();
  });

  it('accepts entity="model"', () => {
    expect(() =>
      buildAuditLog({
        entity: 'model',
        entityId: 'elitebook',
        action: 'created',
        actorUid: 'u1',
        actorRole: 'super_admin',
        before: null,
        after: { brandId: 'hp', name: 'EliteBook', isActive: true },
      })
    ).not.toThrow();
  });
});

describe('auditHelper — license-key diff sanitisation', () => {
  it('strips licenseKey from the after snapshot', () => {
    const log = buildAuditLog({
      entity: 'asset',
      entityId: 'a1',
      action: 'license_key_changed',
      actorUid: 'u1',
      actorRole: 'tech_admin',
      before: null,
      after: { licenseKey: 'TOP-SECRET', licenseKeySet: true },
    });
    expect(log.after).toEqual({ licenseKeySet: true });
    expect(JSON.stringify(log)).not.toContain('TOP-SECRET');
  });

  it('strips secrets.key from before/after', () => {
    const log = buildAuditLog({
      entity: 'asset',
      entityId: 'a1',
      action: 'updated',
      actorUid: 'u1',
      actorRole: 'tech_admin',
      before: { secrets: { key: 'OLD' } },
      after: { secrets: { key: 'NEW' } },
    });
    expect(JSON.stringify(log)).not.toContain('OLD');
    expect(JSON.stringify(log)).not.toContain('NEW');
  });
});
