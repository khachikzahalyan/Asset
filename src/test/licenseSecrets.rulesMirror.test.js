import { describe, it, expect } from 'vitest';

function isSuperAdmin(role) {
  return role === 'super_admin';
}
function isTechAdmin(role) {
  return role === 'tech_admin';
}

function canReadSecret({ role }) {
  return isSuperAdmin(role) || isTechAdmin(role);
}

function canCreateSecret({ role, secretId, data, uid, now }) {
  return (
    (isSuperAdmin(role) || isTechAdmin(role)) &&
    secretId === 'key' &&
    typeof data.value === 'string' &&
    data.value.length > 0 &&
    data.value.length <= 4096 &&
    data.updatedBy === uid &&
    data.updatedAt === now
  );
}

function canUpdateSecret({ role, before, after }) {
  if (!(isSuperAdmin(role) || isTechAdmin(role))) return false;
  const allowed = new Set(['value', 'updatedAt', 'updatedBy']);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (
      JSON.stringify(before[k]) !== JSON.stringify(after[k]) &&
      !allowed.has(k)
    )
      return false;
  }
  return true;
}

function canDeleteSecret() {
  return false;
}

describe('licenseSecrets rules mirror — read', () => {
  it.each([
    ['super_admin', true],
    ['tech_admin', true],
    ['asset_admin', false],
    ['employee', false],
    [null, false],
  ])('role=%s → canRead=%s', (role, expected) => {
    expect(canReadSecret({ role })).toBe(expected);
  });
});

describe('licenseSecrets rules mirror — create', () => {
  const baseData = { value: 'ABC-123', updatedBy: 'u1', updatedAt: 'now' };

  it('super_admin and tech_admin can create with secretId="key"', () => {
    expect(
      canCreateSecret({
        role: 'super_admin',
        secretId: 'key',
        data: baseData,
        uid: 'u1',
        now: 'now',
      })
    ).toBe(true);
    expect(
      canCreateSecret({
        role: 'tech_admin',
        secretId: 'key',
        data: baseData,
        uid: 'u1',
        now: 'now',
      })
    ).toBe(true);
  });

  it('asset_admin cannot create', () => {
    expect(
      canCreateSecret({
        role: 'asset_admin',
        secretId: 'key',
        data: baseData,
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
  });

  it('rejects secretId !== "key"', () => {
    expect(
      canCreateSecret({
        role: 'super_admin',
        secretId: 'archive',
        data: baseData,
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
  });

  it('rejects empty or oversized values', () => {
    expect(
      canCreateSecret({
        role: 'super_admin',
        secretId: 'key',
        data: { ...baseData, value: '' },
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
    expect(
      canCreateSecret({
        role: 'super_admin',
        secretId: 'key',
        data: { ...baseData, value: 'X'.repeat(4097) },
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
  });
});

describe('licenseSecrets rules mirror — update', () => {
  const base = { value: 'OLD', updatedAt: 't0', updatedBy: 'u1' };

  it('super_admin can update allowed keys only', () => {
    expect(
      canUpdateSecret({
        role: 'super_admin',
        before: base,
        after: { ...base, value: 'NEW', updatedAt: 't1', updatedBy: 'u1' },
      })
    ).toBe(true);
  });

  it('tech_admin can update allowed keys only', () => {
    expect(
      canUpdateSecret({
        role: 'tech_admin',
        before: base,
        after: { ...base, value: 'NEW', updatedAt: 't1', updatedBy: 'u1' },
      })
    ).toBe(true);
  });

  it('asset_admin cannot update', () => {
    expect(
      canUpdateSecret({
        role: 'asset_admin',
        before: base,
        after: { ...base, value: 'NEW', updatedAt: 't1', updatedBy: 'u1' },
      })
    ).toBe(false);
  });

  it('rejects mutation of a key outside the allowlist', () => {
    expect(
      canUpdateSecret({
        role: 'super_admin',
        before: { ...base, someField: 'X' },
        after: { ...base, someField: 'Y' },
      })
    ).toBe(false);
  });
});

describe('licenseSecrets rules mirror — delete is forbidden', () => {
  it('always returns false', () => {
    expect(canDeleteSecret()).toBe(false);
  });
});
