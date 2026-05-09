import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';

import PageHeader from '@/components/common/PageHeader.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table.jsx';
import StatusBadge from '@/components/features/assets/StatusBadge.jsx';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee.js';
import { useAssetsByEmployee } from '@/hooks/useAssetsByEmployee.js';
import { useCategories } from '@/hooks/useCategories.js';
import { useAssetStatuses } from '@/hooks/useAssetStatuses.js';
import { useBrands } from '@/hooks/useBrands.js';
import { useModels } from '@/hooks/useModels.js';
import { useAssetSubtypes } from '@/hooks/useAssetSubtypes.js';

import { localize } from '@/lib/localize.js';
import { formatAssetTitle } from '@/lib/asset/formatAssetTitle.js';

/**
 * Employee self-service page — shows the authenticated employee's
 * currently-assigned assets.
 *
 * Five states handled:
 *   1. Loading  — either the employee lookup or the asset query is in flight.
 *   2. Error    — any query failed; shows an error alert.
 *   3. Not linked — user is authenticated but has no employee record.
 *   4. Empty    — employee found but has no assets assigned.
 *   5. Data     — table of assigned assets.
 */
export default function EmployeeSelfServicePage() {
  const { t, i18n } = useTranslation(['me', 'assets', 'common']);
  const lng = i18n.resolvedLanguage ?? 'ru';

  const { user } = useAuth();
  const name = user?.displayName || user?.email || '';

  // Employee lookup (step 1).
  const {
    data: employee,
    loading: empLoading,
    error: empError,
  } = useCurrentEmployee();

  // Asset query — only fires once employee.employeeId is known.
  const {
    data: assets,
    loading: assetsLoading,
    error: assetsError,
  } = useAssetsByEmployee(employee?.employeeId ?? null);

  // Reference data for column rendering.
  const { data: categories } = useCategories();
  const { data: statuses } = useAssetStatuses();
  const { data: brands } = useBrands();
  const { data: models } = useModels();
  const { all: allSubtypes } = useAssetSubtypes();

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

  const brandsById = useMemo(() => {
    const m = new Map();
    for (const b of brands) m.set(b.brandId, b);
    return m;
  }, [brands]);

  const modelsById = useMemo(() => {
    const m = new Map();
    for (const md of models) m.set(md.modelId, md);
    return m;
  }, [models]);

  const subtypesById = useMemo(() => {
    const m = new Map();
    for (const s of allSubtypes) m.set(s.subtypeId, s);
    return m;
  }, [allSubtypes]);

  // ---------------------------------------------------------------------------
  // Loading state — covers both the employee lookup and the asset query.
  // ---------------------------------------------------------------------------
  const isLoading = empLoading || (employee != null && assetsLoading);

  if (isLoading) {
    return (
      <>
        <PageHeader title={t('title')} description={t('greeting', { name })} />
        <div className="flex items-center gap-2 p-6 text-muted-foreground">
          <Spinner size={18} />
          <span className="text-sm">{t('common:loading')}</span>
        </div>
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Error state.
  // ---------------------------------------------------------------------------
  const anyError = empError ?? assetsError;
  if (anyError) {
    return (
      <>
        <PageHeader title={t('title')} description={t('greeting', { name })} />
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t('errorLoading')}</AlertDescription>
        </Alert>
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Not linked — user has no employee record in the system.
  // ---------------------------------------------------------------------------
  if (employee === null) {
    return (
      <>
        <PageHeader title={t('title')} description={t('greeting', { name })} />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
            <Package className="h-10 w-10" aria-hidden="true" />
            <p className="text-sm">{t('notLinkedToEmployee')}</p>
          </CardContent>
        </Card>
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Empty state — employee found but no assets assigned.
  // ---------------------------------------------------------------------------
  if (assets.length === 0) {
    return (
      <>
        <PageHeader title={t('myAssetsTitle')} description={t('greeting', { name })} />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
            <Package className="h-10 w-10" aria-hidden="true" />
            <p className="text-sm">{t('noAssignments')}</p>
          </CardContent>
        </Card>
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Data table.
  // ---------------------------------------------------------------------------
  return (
    <>
      <PageHeader title={t('myAssetsTitle')} description={t('greeting', { name })} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('assets:inventoryCode')}</TableHead>
            <TableHead>{t('assets:name')}</TableHead>
            <TableHead>{t('assets:category')}</TableHead>
            <TableHead>{t('assets:status')}</TableHead>
            <TableHead>{t('colSince')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assets.map((a) => {
            const cat = categoriesById.get(a.categoryId);
            const status = statusesById.get(a.statusId);
            const title =
              formatAssetTitle(
                a,
                {
                  brand: brandsById.get(a.brandId),
                  model: modelsById.get(a.modelId),
                  subtype: subtypesById.get(a.subtypeId),
                },
                lng
              ) || '—';

            // "Since" — use the last-updated timestamp as the best available
            // proxy for assignment date. Show nothing when the field is absent.
            const sinceTs = a.updatedAt;
            const sinceDate =
              sinceTs != null && typeof sinceTs.toDate === 'function'
                ? sinceTs.toDate().toLocaleDateString(lng)
                : typeof sinceTs === 'number'
                ? new Date(sinceTs).toLocaleDateString(lng)
                : null;

            return (
              <TableRow key={a.assetId}>
                <TableCell className="font-mono">{a.inventoryCode || '—'}</TableCell>
                <TableCell className="font-medium">{title}</TableCell>
                <TableCell className="text-muted-foreground">
                  {cat ? localize(cat.name, lng) : '—'}
                </TableCell>
                <TableCell>
                  <StatusBadge status={status} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {sinceDate ?? '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
