import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, ChevronLeft, LogOut, Pencil, Send } from 'lucide-react';

import PageHeader from '@/components/common/PageHeader.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import HistoryTab from '@/components/features/audit/HistoryTab.jsx';

import StatusBadge from '@/components/features/assets/StatusBadge.jsx';
import AssetFormDialog from '@/components/features/assets/AssetFormDialog.jsx';
import AssignDialog from '@/components/features/assignments/AssignDialog.jsx';
import AssignmentHistoryList from '@/components/features/assignments/AssignmentHistoryList.jsx';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { useAsset } from '@/hooks/useAsset.js';
import { useAssets } from '@/hooks/useAssets.js';
import { useCategories } from '@/hooks/useCategories.js';
import { useAssetStatuses } from '@/hooks/useAssetStatuses.js';
import { useAssetSubtypes } from '@/hooks/useAssetSubtypes.js';
import { useBranches } from '@/hooks/useBranches.js';
import { useEmployees } from '@/hooks/useEmployees.js';
import { useBrands } from '@/hooks/useBrands.js';
import { useModels } from '@/hooks/useModels.js';
import { firestoreAssetRepository } from '@/infra/repositories/firestoreAssetRepository.js';
import { firestoreAssignmentEventRepository } from '@/infra/repositories/firestoreAssignmentEventRepository.js';
import { ROLES } from '@/domain/roles.js';
import { ASSIGNMENT_KINDS, nameForDisplay } from '@/domain/assets.js';
import { formatEmployeeName } from '@/domain/employees.js';
import { localize } from '@/lib/localize.js';
import { formatAssetTitle } from '@/lib/asset/formatAssetTitle.js';
import { LicenseExpiryBadge } from '@/components/features/assets/LicenseExpiryBadge.jsx';
import { LicenseKeyDialog } from '@/components/features/assets/LicenseKeyDialog.jsx';
import { ROUTES } from '@/config/routes.js';

/**
 * Asset detail page — Wave-1 Step 2.
 *
 * - Visible to all three admin roles. Tech Admin sees no write affordances.
 * - Edit button: super_admin + asset_admin (calls firestoreAssetRepository.update;
 *   inventoryCode/categoryId/statusId stay immutable here).
 * - Status dropdown (separate card): super_admin + asset_admin → calls
 *   firestoreAssetRepository.setStatus → audit `action: 'status_change'`.
 * - History card consumes the existing audit-tab.
 */
export default function AssetDetailPage() {
  const { assetId } = useParams();
  const { t, i18n } = useTranslation(['assets', 'common']);
  const { t: tLicenses } = useTranslation('licenses');
  const { user, role } = useAuth();
  const { data: asset, loading, error } = useAsset(assetId);
  const { data: categories } = useCategories();
  const { data: statuses } = useAssetStatuses();
  const { data: branches } = useBranches();
  const { data: employees } = useEmployees();
  const { data: allAssets } = useAssets();
  const { all: allSubtypes } = useAssetSubtypes();
  const { data: brands } = useBrands();
  const { data: models } = useModels();

  const [editOpen, setEditOpen] = useState(false);
  const [statusActing, setStatusActing] = useState(false);
  const [statusError, setStatusError] = useState(null);
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  /** @type {[null|'issue'|'return'|'transfer', any]} */
  const [assignMode, setAssignMode] = useState(null);

  const canEdit = role === ROLES.SUPER_ADMIN || role === ROLES.ASSET_ADMIN;
  const canManageKey = role === ROLES.SUPER_ADMIN || role === ROLES.TECH_ADMIN;
  const lng = i18n.resolvedLanguage ?? 'ru';

  const category = useMemo(
    () =>
      asset ? categories.find((c) => c.categoryId === asset.categoryId) ?? null : null,
    [asset, categories]
  );
  const status = useMemo(
    () => (asset ? statuses.find((s) => s.statusId === asset.statusId) ?? null : null),
    [asset, statuses]
  );
  const branch = useMemo(
    () =>
      asset?.branchId ? branches.find((b) => b.branchId === asset.branchId) ?? null : null,
    [asset, branches]
  );
  const employee = useMemo(() => {
    if (!asset || asset.assignedTo?.kind !== ASSIGNMENT_KINDS.EMPLOYEE) return null;
    const id = asset.assignedTo?.id;
    return id ? employees.find((e) => e.employeeId === id) ?? null : null;
  }, [asset, employees]);
  const subtype = useMemo(() => {
    if (!asset?.subtypeId) return null;
    return allSubtypes.find((s) => s.subtypeId === asset.subtypeId) ?? null;
  }, [asset, allSubtypes]);
  const assetsById = useMemo(() => {
    const m = new Map();
    for (const a of allAssets || []) m.set(a.assetId, a);
    return m;
  }, [allAssets]);
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

  // Status options visible in the inline switcher: filter by `isActive`,
  // and constrain by Куда (assignable vs warehouse-side) so the dropdown
  // never offers an inconsistent transition.
  const statusOptions = useMemo(() => {
    if (!asset) return [];
    const wantAssignable =
      asset.assignedTo?.kind && asset.assignedTo.kind !== ASSIGNMENT_KINDS.WAREHOUSE;
    return statuses
      .filter((s) => s.isActive !== false)
      .filter((s) => Boolean(s.isAssignable) === Boolean(wantAssignable));
  }, [asset, statuses]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Spinner size={18} />
        <span className="text-sm">{t('common:loading')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{error.message ?? String(error)}</AlertDescription>
      </Alert>
    );
  }

  if (!asset) {
    return (
      <div className="rounded-md border bg-background p-10 text-center text-sm text-muted-foreground">
        {t('notFound')}
        <div className="mt-3">
          <Link
            to={ROUTES.ASSETS}
            className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /> {t('backToList')}
          </Link>
        </div>
      </div>
    );
  }

  async function handleUpdate(input, opts) {
    if (!user) throw new Error('not-authenticated');
    await firestoreAssetRepository.update(asset.assetId, input, asset, {
      uid: user.uid,
      role,
    }, opts);
  }

  async function handleAssignmentSubmit(input, actor) {
    return firestoreAssignmentEventRepository.create(input, actor);
  }

  async function handleStatusChange(nextStatusId) {
    if (!user) return;
    if (!nextStatusId || nextStatusId === asset.statusId) return;
    setStatusActing(true);
    setStatusError(null);
    try {
      await firestoreAssetRepository.setStatus(
        asset.assetId,
        nextStatusId,
        asset,
        { uid: user.uid, role }
      );
    } catch (err) {
      setStatusError(err?.message ?? String(err));
    } finally {
      setStatusActing(false);
    }
  }

  function holderRow() {
    const kind = asset.assignedTo?.kind ?? ASSIGNMENT_KINDS.WAREHOUSE;
    if (kind === ASSIGNMENT_KINDS.WAREHOUSE) {
      return t('holderShortWarehouse', {
        name: branch ? localize(branch.name, lng) : '—',
      });
    }
    if (kind === ASSIGNMENT_KINDS.BRANCH) {
      return t('holderShortBranch', {
        name: branch ? localize(branch.name, lng) : '—',
      });
    }
    if (kind === ASSIGNMENT_KINDS.EMPLOYEE) {
      return t('holderShortEmployee', {
        name: employee ? formatEmployeeName(employee, lng) : '—',
      });
    }
    if (kind === ASSIGNMENT_KINDS.DEPARTMENT) {
      return t('holderShortDepartment', { name: asset.assignedTo?.id ?? '—' });
    }
    if (kind === ASSIGNMENT_KINDS.ASSET) {
      const targetId = asset.assignedTo?.id;
      const target = targetId ? assetsById.get(targetId) ?? null : null;
      const code = target?.inventoryCode ?? targetId ?? '—';
      if (!targetId) {
        return t('holderShortAsset', { name: '—' });
      }
      return (
        <Link className="underline" to={`/assets/${targetId}`}>
          {t('holderShortAsset', { name: code })}
        </Link>
      );
    }
    return '—';
  }

  return (
    <>
      <PageHeader
        title={
          formatAssetTitle(
            asset,
            {
              brand: brandsById.get(asset.brandId),
              model: modelsById.get(asset.modelId),
              subtype: subtypesById.get(asset.subtypeId),
            },
            lng
          ) || nameForDisplay(asset, lng) || asset.inventoryCode
        }
        description={asset.inventoryCode}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={ROUTES.ASSETS}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              {t('backToList')}
            </Link>
            {canEdit ? (
              <>
                {asset.assignedTo?.kind === ASSIGNMENT_KINDS.WAREHOUSE ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    onClick={() => setAssignMode('issue')}
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                    {t('issueButton')}
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => setAssignMode('transfer')}
                    >
                      <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
                      {t('transferButton')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => setAssignMode('return')}
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                      {t('returnButton')}
                    </Button>
                  </>
                )}
                <Button size="sm" className="gap-2" onClick={() => setEditOpen(true)}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  {t('common:edit')}
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t('details')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <WarrantyBanner asset={asset} t={t} locale={lng} />
            {asset.categoryId === 'license' ? (
              <div className="flex flex-wrap items-center gap-3">
                <LicenseExpiryBadge expiresAt={asset.expiresAt} />
                {canManageKey ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setKeyDialogOpen(true)}
                  >
                    {tLicenses('manageKey')}
                  </Button>
                ) : null}
              </div>
            ) : null}
            <Field label={t('inventoryCode')}>
              <span className="font-mono">{asset.inventoryCode}</span>
            </Field>
            <Field label={t('name')}>
              <span>{nameForDisplay(asset, lng) || '—'}</span>
            </Field>
            <Field label={t('category')}>
              <span className="text-muted-foreground">
                {category ? localize(category.name, lng) : '—'}
              </span>
            </Field>
            <Field label={t('subtype')}>
              <span className="text-muted-foreground">
                {subtype ? localize(subtype.name, lng) : '—'}
              </span>
            </Field>
            <Field label={t('condition')}>
              <ConditionBadge condition={asset.condition} t={t} />
            </Field>
            <Field label={t('status')}>
              <StatusBadge status={status} />
            </Field>
            <Field label={t('brand')}>
              <span className="text-muted-foreground">{asset.brand || '—'}</span>
            </Field>
            <Field label={t('model')}>
              <span className="text-muted-foreground">{asset.model || '—'}</span>
            </Field>
            <Field label={t('serialNumber')}>
              <span className="text-muted-foreground">{asset.serialNumber || '—'}</span>
            </Field>
            <Field label={t('holder')}>
              <span className="text-muted-foreground">{holderRow()}</span>
            </Field>
            <Field label={t('purchaseDate')}>
              <span className="text-muted-foreground">
                {formatTimestamp(asset.purchaseDate)}
              </span>
            </Field>
            <Field label={t('purchasePrice')}>
              <span className="text-muted-foreground">
                {asset.purchasePrice == null ? '—' : asset.purchasePrice}
              </span>
            </Field>
            <Field label={t('notes')}>
              <span className="text-muted-foreground">{asset.notes || '—'}</span>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('status')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusBadge status={status} />
            {canEdit ? (
              <div className="space-y-2">
                <select
                  value={asset.statusId}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  disabled={statusActing}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={t('status')}
                >
                  {statusOptions.map((s) => (
                    <option key={s.statusId} value={s.statusId}>
                      {localize(s.name, lng)}
                    </option>
                  ))}
                  {/* Make sure the current status remains selectable even if
                      it has been deactivated or doesn't match the current
                      Куда mode (defensive). */}
                  {status &&
                  !statusOptions.some((s) => s.statusId === status.statusId) ? (
                    <option value={status.statusId}>{localize(status.name, lng)}</option>
                  ) : null}
                </select>
                {statusError ? (
                  <Alert variant="destructive" role="alert">
                    <AlertDescription>{statusError}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">{t('assignmentHistoryHeading')}</CardTitle>
          </CardHeader>
          <CardContent>
            <AssignmentHistoryList assetId={asset.assetId} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">{t('historyTab')}</CardTitle>
          </CardHeader>
          <CardContent>
            <HistoryTab entityType="asset" entityId={asset.assetId} />
          </CardContent>
        </Card>
      </div>

      {canEdit ? (
        <AssetFormDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          asset={asset}
          onSubmit={handleUpdate}
        />
      ) : null}

      {canEdit && assignMode ? (
        <AssignDialog
          open={Boolean(assignMode)}
          onClose={() => setAssignMode(null)}
          asset={asset}
          mode={assignMode}
          onSubmit={handleAssignmentSubmit}
          actor={{ uid: user?.uid ?? '', role }}
        />
      ) : null}

      {asset.categoryId === 'license' && canManageKey ? (
        <LicenseKeyDialog
          assetId={asset.assetId}
          open={keyDialogOpen}
          onOpenChange={setKeyDialogOpen}
        />
      ) : null}
    </>
  );
}

/**
 * Small green/gray pill summarizing the asset's condition.
 * Falls back to "new" when the field is missing (legacy rows).
 */
function ConditionBadge({ condition, t }) {
  const isNew = condition !== 'used';
  const label = isNew ? t('conditionNew') : t('conditionUsed');
  const cls = isNew
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
    : 'bg-gray-100 text-gray-700 ring-gray-500/20';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      {label}
    </span>
  );
}

/**
 * Banner with the warranty period and a "X days remaining" suffix.
 * Hidden when the condition is "used" or both warranty dates are missing.
 */
function WarrantyBanner({ asset, t, locale }) {
  if (asset?.condition === 'used') return null;
  const start = asset?.warrantyStart?.toDate
    ? asset.warrantyStart.toDate()
    : asset?.warrantyStart instanceof Date
      ? asset.warrantyStart
      : null;
  const end = asset?.warrantyEnd?.toDate
    ? asset.warrantyEnd.toDate()
    : asset?.warrantyEnd instanceof Date
      ? asset.warrantyEnd
      : null;
  if (!start && !end) return null;

  const fmt = (d) =>
    d
      ? d.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' })
      : '—';
  const today = new Date();
  let suffix = '';
  if (end) {
    const msPerDay = 86400000;
    const days = Math.ceil((end.valueOf() - today.valueOf()) / msPerDay);
    if (days < 0) {
      suffix = ` ${t('warrantyExpired')}`;
    } else {
      suffix = ` ${t('warrantyRemainingDays', { days })}`;
    }
  }

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
      {t('warrantyBanner', { start: fmt(start), end: fmt(end) })}
      {suffix}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[160px,1fr] sm:items-start">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}

/**
 * Format a Firestore Timestamp (or null) as `YYYY-MM-DD`. Returns "—" when
 * the timestamp is missing.
 */
function formatTimestamp(value) {
  if (!value) return '—';
  const d = typeof value.toDate === 'function' ? value.toDate() : value;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
