import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Package, Boxes, HandHelping, Wrench, Users, Building2, Plus } from 'lucide-react';

import PageHeader from '@/components/common/PageHeader.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';
import EmployeeFormDialog from '@/components/features/employees/EmployeeFormDialog.jsx';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { useActiveCounts } from '@/hooks/useActiveCounts.js';
import { firestoreEmployeeRepository } from '@/infra/repositories/firestoreEmployeeRepository.js';
import { ROLES } from '@/domain/roles.js';

/**
 * Dashboard tile descriptors. The `live` flag distinguishes Wave 1.5 tiles
 * (employees + branches) from the Wave-2-deferred tiles still showing `—`.
 */
const TILES = [
  { key: 'totalAssets', icon: Package, tone: 'bg-sky-100 text-sky-700', live: false },
  { key: 'inStock', icon: Boxes, tone: 'bg-emerald-100 text-emerald-700', live: false },
  { key: 'issued', icon: HandHelping, tone: 'bg-violet-100 text-violet-700', live: false },
  { key: 'underRepair', icon: Wrench, tone: 'bg-amber-100 text-amber-700', live: false },
  { key: 'activeEmployees', icon: Users, tone: 'bg-rose-100 text-rose-700', live: true },
  { key: 'branches', icon: Building2, tone: 'bg-slate-100 text-slate-700', live: true },
];

export default function DashboardPage() {
  const { t } = useTranslation('dashboard');
  const { user, role } = useAuth();
  const [employeeDialogOpen, setEmployeeDialogOpen] = useState(false);
  // Bumped after a successful "Add employee" so the activeEmployees tile
  // refetches without a full page reload.
  const [refreshKey, setRefreshKey] = useState(0);

  const { activeEmployees, branches, loading, error } = useActiveCounts({ refreshKey });

  const canCreateEmployee = role === ROLES.SUPER_ADMIN || role === ROLES.ASSET_ADMIN;
  const showQuickActions =
    role === ROLES.SUPER_ADMIN || role === ROLES.ASSET_ADMIN || role === ROLES.TECH_ADMIN;

  async function handleCreateEmployee(input) {
    if (!user) throw new Error('not-authenticated');
    await firestoreEmployeeRepository.create(input, { uid: user.uid, role });
    setRefreshKey((k) => k + 1);
  }

  /**
   * Resolve the current numeric value (or null) for a live tile. On the
   * non-live, Wave-2-deferred tiles we always render the em-dash placeholder.
   */
  function valueFor(key) {
    if (key === 'activeEmployees') return activeEmployees;
    if (key === 'branches') return branches;
    return null;
  }

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map(({ key, icon: Icon, tone, live }) => {
          const value = valueFor(key);
          const showSpinner = live && loading && !error;
          const showValue = live && !loading && !error && value !== null;
          // Tooltip applies only to non-live tiles to communicate Wave-2 status.
          const tooltip = live ? undefined : t('metricNextWave');

          return (
            <Card
              key={key}
              className="overflow-hidden"
              title={tooltip}
              data-testid={`metric-${key}`}
            >
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t(key)}</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight">
                    {showSpinner ? (
                      <Spinner size={20} aria-label={t('loading', { defaultValue: '…' })} />
                    ) : showValue ? (
                      value
                    ) : (
                      '—'
                    )}
                  </p>
                </div>
                <span
                  className={`grid h-11 w-11 place-items-center rounded-lg ${tone}`}
                  aria-hidden="true"
                >
                  <Icon className="h-5 w-5" />
                </span>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('recentActivity')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t('comingSoon')}</p>
          </CardContent>
        </Card>

        {showQuickActions ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('quickActions')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled
                title={t('nextWaveTooltip')}
                aria-disabled="true"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t('addAsset')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled
                title={t('nextWaveTooltip')}
                aria-disabled="true"
              >
                <HandHelping className="h-4 w-4" aria-hidden="true" />
                {t('issueAsset')}
              </Button>
              {canCreateEmployee ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setEmployeeDialogOpen(true)}
                >
                  <Users className="h-4 w-4" aria-hidden="true" />
                  {t('addEmployee')}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </section>

      {canCreateEmployee ? (
        <EmployeeFormDialog
          open={employeeDialogOpen}
          onClose={() => setEmployeeDialogOpen(false)}
          onSubmit={handleCreateEmployee}
        />
      ) : null}
    </>
  );
}
