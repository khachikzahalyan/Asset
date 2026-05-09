import { describe, it, expect } from 'vitest';

function isAdmin(role) {
  return ['super_admin', 'asset_admin', 'tech_admin'].includes(role);
}
function isSuperAdmin(role) {
  return role === 'super_admin';
}

function canReadNotificationSettings({ role }) {
  return isAdmin(role);
}

function canWriteNotificationSettings({ role, data, uid, now }) {
  return (
    isSuperAdmin(role) &&
    Number.isInteger(data.licenseExpiryWarningDays) &&
    data.licenseExpiryWarningDays >= 1 &&
    data.licenseExpiryWarningDays <= 365 &&
    data.updatedBy === uid &&
    data.updatedAt === now
  );
}

describe('notificationSettings rules mirror — read', () => {
  it.each([
    ['super_admin', true],
    ['asset_admin', true],
    ['tech_admin', true],
    ['employee', false],
    [null, false],
  ])('role=%s → canRead=%s', (role, expected) => {
    expect(canReadNotificationSettings({ role })).toBe(expected);
  });
});

describe('notificationSettings rules mirror — write', () => {
  const data = {
    licenseExpiryWarningDays: 30,
    updatedBy: 'u1',
    updatedAt: 'now',
  };

  it('super_admin can write valid values', () => {
    expect(
      canWriteNotificationSettings({
        role: 'super_admin',
        data,
        uid: 'u1',
        now: 'now',
      })
    ).toBe(true);
  });

  it('non-super_admin cannot write', () => {
    expect(
      canWriteNotificationSettings({
        role: 'asset_admin',
        data,
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
  });

  it('rejects out-of-range values', () => {
    expect(
      canWriteNotificationSettings({
        role: 'super_admin',
        data: { ...data, licenseExpiryWarningDays: 0 },
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
    expect(
      canWriteNotificationSettings({
        role: 'super_admin',
        data: { ...data, licenseExpiryWarningDays: 366 },
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
  });

  it('rejects non-integer values', () => {
    expect(
      canWriteNotificationSettings({
        role: 'super_admin',
        data: { ...data, licenseExpiryWarningDays: 30.5 },
        uid: 'u1',
        now: 'now',
      })
    ).toBe(false);
  });
});
