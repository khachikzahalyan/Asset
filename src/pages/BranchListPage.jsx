import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Building2, Warehouse, Filter } from 'lucide-react';

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
import BranchFormDialog from '@/components/features/branches/BranchFormDialog.jsx';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { useBranches } from '@/hooks/useBranches.js';
import { firestoreBranchRepository } from '@/infra/repositories/firestoreBranchRepository.js';
import { localize } from '@/lib/localize.js';
import { ROLES } from '@/domain/roles.js';
import { BRANCH_TYPES } from '@/domain/branches.js';

const ACTIVE_FILTERS = ['all', 'active', 'closed'];

export default function BranchListPage() {
  const { t, i18n } = useTranslation(['branches', 'common']);
  const { user, role } = useAuth();
  const { data, loading, error } = useBranches();

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);

  const canWrite = role === ROLES.SUPER_ADMIN;
  const lng = i18n.resolvedLanguage ?? 'ru';

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.filter((b) => {
      if (activeFilter === 'active' && !b.isActive) return false;
      if (activeFilter === 'closed' && b.isActive) return false;
      if (!term) return true;
      const haystack = [b.name?.ru, b.name?.en, b.name?.hy, b.address]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [data, search, activeFilter]);

  async function handleCreate(input) {
    if (!user) throw new Error('not-authenticated');
    // The dialog catches and surfaces this — let it bubble.
    await firestoreBranchRepository.create(input, { uid: user.uid, role });
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
              {t('addBranch')}
            </Button>
          ) : null
        }
      />

      <section className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
          />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">{t('filterByStatus')}:</span>
          <div className="inline-flex rounded-md border bg-background">
            {ACTIVE_FILTERS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveFilter(key)}
                className={
                  activeFilter === key
                    ? 'rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground'
                    : 'px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground'
                }
                aria-pressed={activeFilter === key}
              >
                {t(`filter_${key}`)}
              </button>
            ))}
          </div>
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
              <TableHead>{t('name')}</TableHead>
              <TableHead>{t('type')}</TableHead>
              <TableHead>{t('address')}</TableHead>
              <TableHead className="text-right">{t('status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b) => (
              <TableRow key={b.branchId}>
                <TableCell>
                  <Link
                    to={`/branches/${b.branchId}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {localize(b.name, lng)}
                  </Link>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 text-sm">
                    {b.type === BRANCH_TYPES.WAREHOUSE ? (
                      <Warehouse className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {b.type === BRANCH_TYPES.WAREHOUSE
                      ? t('warehouseType')
                      : t('branchType')}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {b.address || '—'}
                </TableCell>
                <TableCell className="text-right">
                  {b.isActive ? (
                    <Badge variant="success">{t('active')}</Badge>
                  ) : (
                    <Badge variant="muted">{t('closed')}</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {canWrite ? (
        <BranchFormDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onSubmit={handleCreate}
        />
      ) : null}
    </>
  );
}
