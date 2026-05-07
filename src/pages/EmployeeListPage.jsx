import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Filter } from 'lucide-react';

import PageHeader from '@/components/common/PageHeader.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import EmployeeFormDialog from '@/components/features/employees/EmployeeFormDialog.jsx';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { useEmployees } from '@/hooks/useEmployees.js';
import { useBranches } from '@/hooks/useBranches.js';
import { firestoreEmployeeRepository } from '@/infra/repositories/firestoreEmployeeRepository.js';
import { ROLES } from '@/domain/roles.js';
import { formatEmployeeName } from '@/domain/employees.js';
import { employeeDetailPath } from '@/config/routes.js';
import { localize } from '@/lib/localize.js';

const STATUS_FILTERS = ['all', 'active', 'terminated'];

/**
 * Employee list page: table with search, status chips, and a branch filter.
 *
 * Visible to all three admin roles. The "Add employee" button is gated to
 * super_admin + asset_admin (Tech Admin sees the list but cannot create).
 *
 * Wave 1.5 (2026-05-07, user decision 3A):
 *   - Branch column and branch filter restored. The Wave-1 deferral was
 *     premature and clashed with §14 of AMS_Plan_v3.md.
 *
 * Wave-1 simplification (2026-05-07):
 *   - "Position" column replaced with "Department" (§14 lists "отдел"
 *     not "должность").
 */
export default function EmployeeListPage() {
  const { t, i18n } = useTranslation(['employees', 'common']);
  const { user, role } = useAuth();
  const { data, loading, error } = useEmployees();
  const { data: branchData } = useBranches();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [branchFilter, setBranchFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);

  const canWrite = role === ROLES.SUPER_ADMIN || role === ROLES.ASSET_ADMIN;
  const lng = i18n.resolvedLanguage ?? 'ru';

  // Look-up table for branch display names. Pre-existing employees with a
  // null branchId fall back to "—" in the column; the detail page surfaces a
  // "Дозаполнить" CTA for them (Wave 1.5 migration aid).
  const branchNameById = useMemo(() => {
    const map = new Map();
    for (const b of branchData) map.set(b.branchId, b);
    return map;
  }, [branchData]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.filter((e) => {
      if (statusFilter === 'active' && !e.isActive) return false;
      if (statusFilter === 'terminated' && e.isActive) return false;
      if (branchFilter !== 'all' && (e.branchId ?? '') !== branchFilter) return false;
      if (!term) return true;
      const haystack = [e.firstName, e.lastName, e.email]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [data, search, statusFilter, branchFilter]);

  async function handleCreate(input) {
    if (!user) throw new Error('not-authenticated');
    // The dialog catches EmployeeEmailTakenError specifically; let it bubble.
    await firestoreEmployeeRepository.create(input, { uid: user.uid, role });
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          canWrite ? (
            <Button size="sm" className="gap-2" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('addEmployee')}
            </Button>
          ) : null
        }
      />

      <section className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="pl-9"
            aria-label={t('searchPlaceholder')}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-muted-foreground">{t('filterByStatus')}:</span>
            <div className="inline-flex rounded-md border bg-background">
              {STATUS_FILTERS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={
                    statusFilter === key
                      ? 'rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground'
                      : 'px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground'
                  }
                  aria-pressed={statusFilter === key}
                >
                  {t(`filter_${key}`)}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">{t('filterByBranch')}:</span>
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-xs"
              aria-label={t('filterByBranch')}
            >
              <option value="all">{t('filter_all')}</option>
              {branchData
                .filter((b) => b.isActive)
                .map((b) => (
                  <option key={b.branchId} value={b.branchId}>
                    {localize(b.name, lng)}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </section>

      {error ? (
        <Alert variant="destructive" className="mb-4" role="alert">
          <AlertDescription>{error.message ?? String(error)}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 p-6 text-muted-foreground">
          <Spinner size={18} />
          <span className="text-sm">{t('common:loading')}</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border bg-background p-10 text-center text-sm text-muted-foreground">
          {t('emptyState')}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('fullName')}</TableHead>
              <TableHead>{t('email')}</TableHead>
              <TableHead>{t('branch')}</TableHead>
              <TableHead>{t('department')}</TableHead>
              <TableHead className="text-right">{t('status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => {
              const branch = e.branchId ? branchNameById.get(e.branchId) : null;
              const branchLabel = branch ? localize(branch.name, lng) : '—';
              return (
                <TableRow key={e.employeeId}>
                  <TableCell>
                    <Link
                      to={employeeDetailPath(e.employeeId)}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {formatEmployeeName(e, lng)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.email}</TableCell>
                  <TableCell className="text-muted-foreground">{branchLabel}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.department || '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {e.isActive ? (
                      <Badge variant="success">{t('active')}</Badge>
                    ) : (
                      <Badge variant="muted">{t('terminated')}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {canWrite ? (
        <EmployeeFormDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onSubmit={handleCreate}
        />
      ) : null}
    </>
  );
}
