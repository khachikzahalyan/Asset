import { ROLES } from '@/domain/roles.js';

export const ROUTES = Object.freeze({
  ROOT: '/',
  LOGIN: '/login',
  LOGIN_EMPLOYEE: '/login/employee',
  AUTH_EMAIL_LINK: '/auth/email-link',
  DASHBOARD: '/dashboard',
  ME: '/me',
  FORBIDDEN: '/403',
  BRANCHES: '/branches',
  BRANCH_DETAIL: '/branches/:id',
});

export function branchDetailPath(id) {
  return `/branches/${id}`;
}

export const ROUTE_TABLE = [
  { path: ROUTES.LOGIN, allowedRoles: 'public' },
  { path: ROUTES.LOGIN_EMPLOYEE, allowedRoles: 'public' },
  { path: ROUTES.AUTH_EMAIL_LINK, allowedRoles: 'public' },
  { path: ROUTES.FORBIDDEN, allowedRoles: 'public' },
  {
    path: ROUTES.DASHBOARD,
    allowedRoles: [ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN, ROLES.TECH_ADMIN],
  },
  {
    path: ROUTES.BRANCHES,
    allowedRoles: [ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN],
  },
  {
    path: ROUTES.BRANCH_DETAIL,
    allowedRoles: [ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN],
  },
  { path: ROUTES.ME, allowedRoles: [ROLES.EMPLOYEE] },
];
