import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Filter, Upload } from 'lucide-react';

import PageHeader from '@/components/common/PageHeader.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
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

import StatusBadge from '@/components/features/assets/StatusBadge.jsx';
import AssetFormDialog from '@/components/features/assets/AssetFormDialog.jsx';
import AssetExportButton from '@/components/features/assets/AssetExportButton.jsx';
import AssetImportDialog from '@/components/features/assets/AssetImportDialog.jsx';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { useAssets } from '@/hooks/useAssets.js';
import { useCategories } from '@/hooks/useCategories.js';
import { useAssetStatuses } from '@/hooks/useAssetStatuses.js';
import { useBranches } from '@/hooks/useBranches.js';
import { useEmployees } from '@/hooks/useEmployees.js';
import { firestoreAssetRepository } from '@/infra/repositories/firestoreAssetRepository.js';
import { ROLES } from '@/domain/roles.js';
import { ASSIGNMENT_KINDS, nameForDisplay } from '@/domain/assets.js';
import { formatEmployeeName } from '@/domain/employees.js';
import { localize } from '@/lib/localize.js';
import { assetDetailPath } from '@/config/routes.js';

/**
 * Asset list page — Wave-1 Step 3 (Excel import/export wired up).
 *
 * Visible to all three admin roles. Tech Admin reads only (no Add CTA,
 * no Import). Export is available to every admin who can see the page —
 * it operates on the current filtered view.
 */
export default function AssetListPage() {
  const { t, i18n } = useTranslation(['assets', 'common']);
  const { user, role } = useAuth();
  const { data: assets, loading, error } = useAssets();
  const { data: categories } = useCategories();
  const { data: statuses } = useAssetStatuses();
  const { data: branches } = useBranches();
  const { data: employees } = useEmployees();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const canWrite = role === ROLES.SUPER_ADMIN || role === ROLES.ASSET_ADMIN;
  const lng = i18n.resolvedLanguage ?? 'ru';

  const categoriesById = useMemo(() => {
    const m = new Map();
    for (const c of categories) m.set(c.categoryId, c);
    return m;
  }, [categories]);
  const statusesById = useMemo(() => {
    const m = new Map();
    for (const s of statuses) m.set(s.statusId, s);
    return m;
  }, [statuses]);
  const branchesById = useMemo(() => {
    const m = new Map();
    for (const b of branches) m.set(b.branchId, b);
    return m;
  }, [branches]);
  const employeesById = useMemo(() => {
    const m = new Map();
    for (const e of employees) m.set(e.employeeId, e);
    return m;
  }, [employees]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (categoryFilter !== 'all' && a.categoryId !== categoryFilter) return false;
      if (statusFilter !== 'all' && a.statusId !== statusFilter) return false;
      if (branchFilter !== 'all' && (a.branchId ?? '') !== branchFilter) return false;
      if (!term) return true;
      const haystack = [
        a.inventoryCode,
        nameForDisplay(a, lng),
        a.brand,
        a.model,
        a.serialNumber,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [assets, search, categoryFilter, statusFilter, branchFilter, lng]);

  async function handleCreate(input, opts) {
    if (!user) throw new Error('not-authenticated');
    await firestoreAssetRepository.create(input, { uid: user.uid, role }, opts);
  }

  function holderLabel(a) {
    const kind = a.assignedTo?.kind ?? ASSIGNMENT_KINDS.WAREHOUSE;
    if (kind === ASSIGNMENT_KINDS.WAREHOUSE) {
      const b = a.branchId ? branchesById.get(a.branchId) : null;
      return t('holderShortWarehouse', { name: b ? localize(b.name, lng) : '—' });
    }
    if (kind === ASSIGNMENT_KINDS.BRANCH) {
      const b = a.branchId ? branchesById.get(a.branchId) : null;
      return t('holderShortBranch', { name: b ? localize(b.name, lng) : '—' });
    }
    if (kind === ASSIGNMENT_KINDS.EMPLOYEE) {
      const e = a.assignedTo?.id ? employeesById.get(a.assignedTo.id) : null;
      return t('holderShortEmployee', {
        name: e ? formatEmployeeName(e, lng) : '—',
      });
    }
    if (kind === ASSIGNMENT_KINDS.DEPARTMENT) {
      // /departments collection isn't modeled yet — fall back to the raw id.
      return t('holderShortDepartment', { name: a.assignedTo?.id ?? '—' });
    }
    return '—';
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canWrite ? (
              <Button
                variant="ghost"
                size="sm"
                className="gap-2"
                onClick={() => setImportOpen(true)}
                disabled={loading}
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                {t('import')}
              </Button>
            ) : null}
            <AssetExportButton
              assets={rows}
              categoriesById={categoriesById}
              statusesById={statusesById}
              branchesById={branchesById}
              employeesById={employeesById}
              disabled={loading}
            />
            {canWrite ? (
              <Button size="sm" className="gap-2" onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t('addAsset')}
              </Button>
            ) : null}
          </div>
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
          <Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />

          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">{t('filterByCategory')}:</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-xs"
              aria-label={t('filterByCategory')}
            >
              <option value="all">{t('filterAll')}</option>
              {categories
                .filter((c) => c.isActive !== false)
                .map((c) => (
                  <option key={c.categoryId} value={c.categoryId}>
                    {localize(c.name, lng)}
                  </option>
                ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">{t('filterByStatus')}:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-xs"
              aria-label={t('filterByStatus')}
            >
              <option value="all">{t('filterAll')}</option>
              {statuses
                .filter((s) => s.isActive !== false)
                .map((s) => (
                  <option key={s.statusId} value={s.statusId}>
                    {localize(s.name, lng)}
                  </option>
                ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">{t('filterByBranch')}:</span>
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-xs"
              aria-label={t('filterByBranch')}
            >
              <option value="all">{t('filterAll')}</option>
              {branches
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
      ) : assets.length === 0 ? (
        <div className="rounded-md border bg-background p-10 text-center text-sm text-muted-foreground">
          {t('emptyState')}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border bg-background p-10 text-center text-sm text-muted-foreground">
          {t('noResults')}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inventoryCode')}</TableHead>
              <TableHead>{t('name')}</TableHead>
              <TableHead>{t('category')}</TableHead>
              <TableHead>{t('brand')}</TableHead>
              <TableHead>{t('model')}</TableHead>
              <TableHead>{t('status')}</TableHead>
              <TableHead>{t('holder')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => {
              const cat = categoriesById.get(a.categoryId);
              const status = statusesById.get(a.statusId);
              return (
                <TableRow key={a.assetId}>
                  <TableCell>
                    <Link
                      to={assetDetailPath(a.assetId)}
                      className="font-mono text-primary underline-offset-4 hover:underline"
                    >
                      {a.inventoryCode}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      to={assetDetailPath(a.assetId)}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {nameForDisplay(a, lng) || '—'}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {cat ? localize(cat.name, lng) : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{a.brand || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{a.model || '—'}</TableCell>
                  <TableCell>
                    <StatusBadge status={status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {holderLabel(a)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {canWrite ? (
        <AssetFormDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onSubmit={handleCreate}
        />
      ) : null}

      {canWrite ? (
        <AssetImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          actor={{ uid: user?.uid, role }}
        />
      ) : null}
    </>
  );
}
