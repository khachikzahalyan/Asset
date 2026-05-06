export const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  ASSET_ADMIN: 'asset_admin',
  TECH_ADMIN: 'tech_admin',
  EMPLOYEE: 'employee',
});

export const ALL_ROLES = Object.values(ROLES);
export const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN, ROLES.TECH_ADMIN];

export function isAdminRole(role) {
  return ADMIN_ROLES.includes(role);
}
