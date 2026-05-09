import { describe, it, expect } from 'vitest';

function isAdmin(role) {
  return ['super_admin', 'asset_admin', 'tech_admin'].includes(role);
}
function isSuperAdmin(role) {
  return role === 'super_admin';
}

function canReadModel({ role }) {
  return isAdmin(role);
}

function canCreateModel({ role, data, brandsExist, uid, now }) {
  return (
    isSuperAdmin(role) &&
    typeof data.brandId === 'string' &&
    data.brandId.length > 0 &&
    typeof data.name === 'string' &&
    data.name.length > 0 &&
    typeof data.isActive === 'boolean' &&
    data.createdBy === uid &&
    data.createdAt === now &&
    brandsExist.includes(data.brandId)
  );
}

function canUpdateModel({ role, before, after }) {
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

function canDeleteModel() {
  return false;
}

describe('models rules mirror — read', () => {
  it.each([
    ['super_admin', true],
    ['asset_admin', true],
    ['tech_admin', true],
    ['employee', false],
    [null, false],
  ])('role=%s → canRead=%s', (role, expected) => {
    expect(canReadModel({ role })).toBe(expected);
  });
});

describe('models rules mirror — create', () => {
  const data = {
    brandId: 'hp',
    name: 'EliteBook',
    isActive: true,
    createdBy: 'u1',
    createdAt: 'now',
  };

  it('super_admin can create when the brand exists', () => {
    expect(
      canCreateModel({
        role: 'super_admin',
        data,
        brandsExist: ['hp'],
        uid: 'u1',
        now: 'now',
      })
    ).toBe(true);
  });

  it('rejects when the referenced brand does not exist', () => {
    expect(
      canCreateModel({
        role: 'super_admin',
        data,
        brandsExist: [],
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
  });

  it('rejects empty brandId or name', () => {
    expect(
      canCreateModel({
        role: 'super_admin',
        data: { ...data, brandId: '' },
        brandsExist: ['hp'],
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
    expect(
      canCreateModel({
        role: 'super_admin',
        data: { ...data, name: '' },
        brandsExist: ['hp'],
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
  });
});

describe('models rules mirror — update', () => {
  it('rejects brandId mutations', () => {
    expect(
      canUpdateModel({
        role: 'super_admin',
        before: { brandId: 'hp', name: 'X' },
        after: { brandId: 'lenovo', name: 'X' },
      })
    ).toBe(false);
  });
});

describe('models rules mirror — delete is forbidden', () => {
  it('always returns false', () => {
    expect(canDeleteModel()).toBe(false);
  });
});
