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
  EMPLOYEES: '/employees',
  EMPLOYEE_DETAIL: '/employees/:id',
  ASSETS: '/assets',
  ASSET_DETAIL: '/assets/:assetId',
  USERS: '/users',
  ASSET_SUBTYPES: '/settings/asset-subtypes',
  CATEGORIES: '/settings/categories',
  BRANDS: '/settings/brands',
  MODELS: '/settings/models',
  NOTIFICATION_SETTINGS: '/settings/notifications',
});

export function branchDetailPath(id) {
  return `/branches/${id}`;
}

export function employeeDetailPath(id) {
  return `/employees/${id}`;
}

export function assetDetailPath(id) {
  return `/assets/${id}`;
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
  {
    path: ROUTES.EMPLOYEES,
    allowedRoles: [ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN, ROLES.TECH_ADMIN],
  },
  {
    path: ROUTES.EMPLOYEE_DETAIL,
    allowedRoles: [ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN, ROLES.TECH_ADMIN],
  },
  {
    path: ROUTES.ASSETS,
    allowedRoles: [ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN, ROLES.TECH_ADMIN],
  },
  {
    path: ROUTES.ASSET_DETAIL,
    allowedRoles: [ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN, ROLES.TECH_ADMIN],
  },
  { path: ROUTES.ME, allowedRoles: [ROLES.EMPLOYEE] },
  { path: ROUTES.USERS, allowedRoles: [ROLES.SUPER_ADMIN] },
  { path: ROUTES.ASSET_SUBTYPES, allowedRoles: [ROLES.SUPER_ADMIN] },
  { path: ROUTES.CATEGORIES, allowedRoles: [ROLES.SUPER_ADMIN] },
  { path: ROUTES.BRANDS, allowedRoles: [ROLES.SUPER_ADMIN] },
  { path: ROUTES.MODELS, allowedRoles: [ROLES.SUPER_ADMIN] },
  { path: ROUTES.NOTIFICATION_SETTINGS, allowedRoles: [ROLES.SUPER_ADMIN] },
];
