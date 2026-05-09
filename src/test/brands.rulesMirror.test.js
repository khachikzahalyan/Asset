import { describe, it, expect } from 'vitest';

function isAdmin(role) {
  return ['super_admin', 'asset_admin', 'tech_admin'].includes(role);
}
function isSuperAdmin(role) {
  return role === 'super_admin';
}

function canReadBrand({ role }) {
  return isAdmin(role);
}

function canCreateBrand({ role, data, uid, now }) {
  return (
    isSuperAdmin(role) &&
    typeof data.name === 'string' &&
    data.name.length > 0 &&
    typeof data.isActive === 'boolean' &&
    data.createdBy === uid &&
    data.createdAt === now
  );
}

function canUpdateBrand({ role, before, after }) {
  if (!isSuperAdmin(role)) return false;
  const allowed = new Set(['name', 'isActive', 'updatedAt', 'updatedBy']);
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

function canDeleteBrand() {
  return false;
}

describe('brands rules mirror — read', () => {
  it.each([
    ['super_admin', true],
    ['asset_admin', true],
    ['tech_admin', true],
    ['employee', false],
    [null, false],
  ])('role=%s → canRead=%s', (role, expected) => {
    expect(canReadBrand({ role })).toBe(expected);
  });
});

describe('brands rules mirror — create', () => {
  const baseData = {
    name: 'HP',
    isActive: true,
    createdBy: 'u1',
    createdAt: 'now',
  };

  it('only super_admin can create', () => {
    expect(
      canCreateBrand({ role: 'super_admin', data: baseData, uid: 'u1', now: 'now' })
    ).toBe(true);
    expect(
      canCreateBrand({ role: 'asset_admin', data: baseData, uid: 'u1', now: 'now' })
    ).toBe(false);
  });

  it('rejects empty name', () => {
    expect(
      canCreateBrand({
        role: 'super_admin',
        data: { ...baseData, name: '' },
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
  });

  it('rejects mismatched createdBy/auth.uid', () => {
    expect(
      canCreateBrand({
        role: 'super_admin',
        data: baseData,
        uid: 'u2',
        now: 'now',
      })
    ).toBe(false);
  });
});

describe('brands rules mirror — update', () => {
  it('super_admin can update name and isActive', () => {
    expect(
      canUpdateBrand({
        role: 'super_admin',
        before: { name: 'HP', isActive: true },
        after: { name: 'HP Inc.', isActive: true, updatedAt: 'now', updatedBy: 'u1' },
      })
    ).toBe(true);
  });

  it('non-super_admin cannot update', () => {
    expect(
      canUpdateBrand({
        role: 'asset_admin',
        before: { name: 'HP' },
        after: { name: 'HP Inc.' },
      })
    ).toBe(false);
  });

  it('rejects updates that touch unsupported keys', () => {
    expect(
      canUpdateBrand({
        role: 'super_admin',
        before: { name: 'HP', createdBy: 'u1' },
        after: { name: 'HP', createdBy: 'u2' },
      })
    ).toBe(false);
  });
});

describe('brands rules mirror — delete is forbidden', () => {
  it('always returns false', () => {
    expect(canDeleteBrand()).toBe(false);
  });
});
