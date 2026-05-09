import { useEffect, useRef, useState } from 'react';
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
  ChevronUp,
} from 'lucide-react';

import LanguageSwitcher from '@/components/common/LanguageSwitcher.jsx';
import HeadOfficeBootstrap from '@/components/system/HeadOfficeBootstrap.jsx';
import StatusesAndCategoriesBootstrap from '@/components/system/StatusesAndCategoriesBootstrap.jsx';
import CatalogShapeMigration from '@/components/system/CatalogShapeMigration.jsx';
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
  { to: '/settings/categories', icon: Tags, key: 'navCategories', roles: [ROLES.SUPER_ADMIN] },
  { to: '/statuses', icon: CircleDot, key: 'navStatuses', roles: [ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN] },
  { to: '/users', icon: UserCog, key: 'navUsers', roles: [ROLES.SUPER_ADMIN] },
  { to: '/audit', icon: ScrollText, key: 'navAuditLog', roles: [ROLES.SUPER_ADMIN] },
  { to: '/settings/asset-subtypes', icon: Settings, key: 'navAssetSubtypes', roles: [ROLES.SUPER_ADMIN] },
  { to: '/settings/brands', icon: Tags, key: 'navBrands', roles: [ROLES.SUPER_ADMIN] },
  { to: '/settings/models', icon: Boxes, key: 'navModels', roles: [ROLES.SUPER_ADMIN] },
  { to: '/settings/notifications', icon: CircleDot, key: 'navNotificationSettings', roles: [ROLES.SUPER_ADMIN] },
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
      {/* Sidebar.
          - Mobile (<md): off-canvas, slides in from the left when mobileOpen.
          - Desktop (md+): sticky to viewport top, full-screen height, never
            scrolls with the page. The vertical layout is logo / nav (scrolls
            internally if it overflows) / user block pinned to the bottom. */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex h-screen w-64 -translate-x-full flex-col border-r bg-background transition-transform duration-200',
          'md:sticky md:top-0 md:translate-x-0 md:self-start',
          mobileOpen && 'translate-x-0'
        )}
        aria-label={t('navSidebar')}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b px-5">
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

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
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

        {/* Bottom-pinned account menu. The user card is a click-to-open
            trigger; the actual controls (LanguageSwitcher + Sign-out) live
            in a popover that opens upward. Click-outside and Escape both
            close it. Replaces the old top-right header trio. */}
        <div className="shrink-0 border-t bg-background p-3">
          <SidebarAccountMenu
            display={display}
            role={roleLabel}
            onSignOut={signOut}
            signOutLabel={t('signOut')}
            menuLabel={t('accountMenu')}
          />
        </div>
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
        {/* Top bar shrinks to a mobile-only menu trigger on small screens
            and disappears entirely on desktop — all account controls now
            live in the sidebar's bottom panel. */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur sm:px-6 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent"
            aria-label={t('openMenu')}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <Boxes className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="text-sm font-semibold tracking-tight">{t('appName')}</span>
          </Link>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">
            <HeadOfficeBootstrap />
            <StatusesAndCategoriesBootstrap />
            <CatalogShapeMigration />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function SidebarAccountMenu({ display, role, onSignOut, signOutLabel, menuLabel }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  // Click-outside + Escape to close. Mounted only while the menu is open
  // so we don't pay for global listeners when there's nothing to dismiss.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      {/* Popover panel — opens upward from above the trigger. Pinned to the
          sidebar's left/right edges with a 12px slot above the trigger. */}
      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 right-0 mb-2 rounded-lg border bg-popover p-2 shadow-lg"
        >
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium text-foreground">{display}</p>
            {role ? (
              <p className="truncate text-xs text-muted-foreground">{role}</p>
            ) : null}
          </div>
          <div className="my-1 h-px bg-border" />
          <div className="px-1 py-1">
            <LanguageSwitcher />
          </div>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut?.();
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium',
              'text-red-600 transition-colors hover:bg-red-50 focus:bg-red-50 focus:outline-none'
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 text-left">{signOutLabel}</span>
          </button>
        </div>
      ) : null}

      {/* Trigger card. Hover lifts the bg, open state locks it darker so the
          operator can see the panel is anchored to this row. The chevron
          rotates 180° when open. */}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={menuLabel}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors',
          open ? 'bg-accent' : 'bg-muted/40 hover:bg-accent'
        )}
      >
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {getInitials(display)}
        </div>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-sm font-medium text-foreground">{display}</span>
          {role ? (
            <span className="truncate text-xs text-muted-foreground">{role}</span>
          ) : null}
        </div>
        <ChevronUp
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            open ? 'rotate-0' : 'rotate-180'
          )}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
