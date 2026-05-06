import { describe, it, expect } from 'vitest';
import { ROLES, ALL_ROLES, ADMIN_ROLES, isAdminRole } from '@/domain/roles.js';

describe('roles', () => {
  it('exports four roles', () => {
    expect(ALL_ROLES).toHaveLength(4);
    expect(ALL_ROLES).toEqual(
      expect.arrayContaining(['super_admin', 'asset_admin', 'tech_admin', 'employee'])
    );
  });

  it('admin roles include the three admin variants but not employee', () => {
    expect(ADMIN_ROLES).toEqual([ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN, ROLES.TECH_ADMIN]);
    expect(ADMIN_ROLES).not.toContain(ROLES.EMPLOYEE);
  });

  it('isAdminRole identifies admin variants', () => {
    expect(isAdminRole(ROLES.SUPER_ADMIN)).toBe(true);
    expect(isAdminRole(ROLES.ASSET_ADMIN)).toBe(true);
    expect(isAdminRole(ROLES.TECH_ADMIN)).toBe(true);
    expect(isAdminRole(ROLES.EMPLOYEE)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });

  it('roles object is frozen', () => {
    expect(Object.isFrozen(ROLES)).toBe(true);
  });
});
