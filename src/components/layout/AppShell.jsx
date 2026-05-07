import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Boxes,
  LayoutDashboard,
  Package,
  HandHelping,
  Users,
  Building2,
  Network,
  Tags,
  CircleDot,
  ScrollText,
  User,
  Settings,
  LogOut,
  Menu,
  X,
  UserCog,
} from 'lucide-react';

import LanguageSwitcher from '@/components/common/LanguageSwitcher.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Separator } from '@/components/ui/separator.jsx';
import { cn } from '@/lib/utils.js';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { ROLES, ADMIN_ROLES } from '@/domain/roles.js';

const ADMIN_NAV = [
  { to: '/dashboard', icon: LayoutDashboard, key: 'navDashboard', roles: ADMIN_ROLES },
  { to: '/assets', icon: Package, key: 'navAssets', roles: ADMIN_ROLES },
  { to: '/assignments', icon: HandHelping, key: 'navAssignments', roles: ADMIN_ROLES },
  { to: '/employees', icon: Users, key: 'navEmployees', roles: ADMIN_ROLES },
  { to: '/branches', icon: Building2, key: 'navBranches', roles: [ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN] },
  { to: '/departments', icon: Network, key: 'navDepartments', roles: [ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN] },
  { to: '/categories', icon: Tags, key: 'navCategories', roles: [ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN] },
  { to: '/statuses', icon: CircleDot, key: 'navStatuses', roles: [ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN] },
  { to: '/users', icon: UserCog, key: 'navUsers', roles: [ROLES.SUPER_ADMIN] },
  { to: '/audit', icon: ScrollText, key: 'navAuditLog', roles: [ROLES.SUPER_ADMIN] },
  { to: '/settings', icon: Settings, key: 'navSettings', roles: [ROLES.SUPER_ADMIN] },
];

const EMPLOYEE_NAV = [{ to: '/me', icon: User, key: 'navMe', roles: [ROLES.EMPLOYEE] }];

const ROLE_LABEL = {
  super_admin: { ru: 'Супер-админ', en: 'Super admin', hy: 'Գերադմին' },
  asset_admin: { ru: 'Админ активов', en: 'Asset admin', hy: 'Ակտիվների ադմին' },
  tech_admin: { ru: 'Тех. админ', en: 'Tech admin', hy: 'Տեխ. ադմին' },
  employee: { ru: 'Сотрудник', en: 'Employee', hy: 'Աշխատակից' },
};

function getInitials(nameOrEmail) {
  if (!nameOrEmail) return '?';
  const trimmed = String(nameOrEmail).trim();
  if (trimmed.includes(' ')) {
    return trimmed
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export default function AppShell() {
  const { t, i18n } = useTranslation('common');
  const { user, role, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, []);

  const items = role === ROLES.EMPLOYEE ? EMPLOYEE_NAV : ADMIN_NAV;
  const visible = items.filter((item) => item.roles.includes(role));
  const lng = i18n.resolvedLanguage ?? 'ru';
  const roleLabel = role ? ROLE_LABEL[role]?.[lng] ?? role : '';
  const display = user?.displayName || user?.email || '';

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-64 -translate-x-full border-r bg-background transition-transform duration-200 md:static md:translate-x-0',
          mobileOpen && 'translate-x-0'
        )}
        aria-label={t('navSidebar')}
      >
        <div className="flex h-16 items-center justify-between border-b px-5">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
              <Boxes className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-base font-semibold tracking-tight">{t('appName')}</span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent md:hidden"
            aria-label={t('closeMenu')}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex flex-col gap-1 p-3">
          {visible.map(({ to, icon: Icon, key }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/dashboard' || to === '/me'}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t(key)}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {mobileOpen ? (
        <button
          type="button"
          aria-label={t('closeMenu')}
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm md:hidden"
        />
      ) : null}

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent md:hidden"
            aria-label={t('openMenu')}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>

          <div className="flex flex-1 items-center justify-end gap-3">
            <LanguageSwitcher />
            <Separator orientation="vertical" className="h-6" />
            <UserBlock display={display} role={roleLabel} />
            <Button variant="outline" size="sm" onClick={signOut} className="gap-2">
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t('signOut')}</span>
            </Button>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function UserBlock({ display, role }) {
  return (
    <div className="hidden items-center gap-3 sm:flex">
      <div className="grid h-9 w-9 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {getInitials(display)}
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-medium text-foreground">{display}</span>
        {role ? <span className="text-xs text-muted-foreground">{role}</span> : null}
      </div>
    </div>
  );
}
