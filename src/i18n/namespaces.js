export const NAMESPACES = Object.freeze({
  COMMON: 'common',
  AUTH: 'auth',
  ASSETS: 'assets',
  BRANCHES: 'branches',
  EMPLOYEES: 'employees',
  DEPARTMENTS: 'departments',
  CATEGORIES: 'categories',
  STATUSES: 'statuses',
  DASHBOARD: 'dashboard',
  ERRORS: 'errors',
  VALIDATION: 'validation',
  ME: 'me',
  SETTINGS: 'settings',
  USERS: 'users',
  BRANDS: 'brands',
  MODELS: 'models',
  LICENSES: 'licenses',
});

export const NAMESPACE_LIST = Object.values(NAMESPACES);

export const SUPPORTED_LOCALES = Object.freeze(['ru', 'en', 'hy']);
export const FALLBACK_LOCALE = 'ru';
