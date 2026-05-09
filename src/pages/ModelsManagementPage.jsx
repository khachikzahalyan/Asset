import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Power, PowerOff } from 'lucide-react';

import PageHeader from '@/components/common/PageHeader.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import ModelFormDialog from '@/components/features/models/ModelFormDialog.jsx';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { useBrands } from '@/hooks/useBrands.js';
import { useModels } from '@/hooks/useModels.js';
import {
  createModel,
  updateModel,
  setModelActive,
} from '@/infra/repositories/firestoreModelRepository.js';
import { ModelIdConflictError } from '@/domain/models.js';

/**
 * Models management page (Super Admin only) at /settings/models.
 *
 * Lists all models with brand name, model name, status, and action buttons.
 * Supports filtering by brand. Create and edit through ModelFormDialog.
 * Soft-delete only — no hard delete for models.
 */
export default function ModelsManagementPage() {
  const { t } = useTranslation('models');
  const { user, role } = useAuth();
  const { data: brands } = useBrands();
  const [filterBrandId, setFilterBrandId] = useState('');
  const { data: models, loading, error } = useModels({
    brandId: filterBrandId || null,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  /** @type {[null | import('@/domain/models.js').Model, Function]} */
  const [editing, setEditing] = useState(null);
  const [actingId, setActingId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const brandMap = useMemo(() => {
    const m = new Map();
    for (const b of brands || []) m.set(b.brandId, b.name);
    return m;
  }, [brands]);

  const sorted = useMemo(() => {
    return [...(models || [])].sort((a, b) => {
      const brandA = brandMap.get(a.brandId) ?? a.brandId;
      const brandB = brandMap.get(b.brandId) ?? b.brandId;
      const cmp = brandA.localeCompare(brandB);
      return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
    });
  }, [models, brandMap]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
    setActionError(null);
  }

  function openEdit(model) {
    setEditing(model);
    setDialogOpen(true);
    setActionError(null);
  }

  async function handleSubmit(input) {
    if (!user) throw new Error('not-authenticated');
    const actor = { uid: user.uid, role };
    if (editing) {
      await updateModel(editing.modelId, input, actor);
    } else {
      await createModel(input, actor);
    }
    setDialogOpen(false);
    setEditing(null);
  }

  async function toggleActive(model) {
    if (!user) return;
    setActingId(model.modelId);
    setActionError(null);
    try {
      await setModelActive(model.modelId, !model.isActive, {
        uid: user.uid,
        role,
      });
    } catch (err) {
      if (err instanceof ModelIdConflictError) {
        setActionError(t('errorNameNotUniqueWithinBrand'));
      } else {
        setActionError(err?.message ?? String(err));
      }
    } finally {
      setActingId(null);
    }
  }

  const activeBrands = useMemo(
    () => (brands || []).filter((b) => b.isActive !== false),
    [brands]
  );

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button size="sm" className="gap-2" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('addModel')}
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error.message ?? String(error)}</AlertDescription>
        </Alert>
      ) : null}

      {actionError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="filter-brand" className="text-sm font-medium">
          {t('filterByBrand')}
        </label>
        <select
          id="filter-brand"
          value={filterBrandId}
          onChange={(e) => setFilterBrandId(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">{t('filterAllBrands')}</option>
          {activeBrands.map((b) => (
            <option key={b.brandId} value={b.brandId}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 p-6 text-muted-foreground">
          <Spinner size={18} />
          <span className="text-sm">{t('loading', { ns: 'common' })}</span>
        </div>
      ) : null}

      {!loading ? (
        <Card>
          <CardContent className="pt-6">
            {sorted.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('emptyState')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">{t('brandColumn')}</th>
                      <th className="px-3 py-2">{t('columnName')}</th>
                      <th className="px-3 py-2">{t('columnStatus')}</th>
                      <th className="px-3 py-2 text-right">{t('columnActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((m) => (
                      <tr
                        key={m.modelId}
                        className="border-t border-border/60 hover:bg-muted/30"
                      >
                        <td className="px-3 py-2 text-muted-foreground">
                          {brandMap.get(m.brandId) ?? m.brandId}
                        </td>
                        <td className="px-3 py-2 font-medium">{m.name}</td>
                        <td className="px-3 py-2">
                          <ActiveBadge isActive={m.isActive !== false} t={t} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                              onClick={() => openEdit(m)}
                              aria-label={t('editModel')}
                              title={t('editModel')}
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            {m.isActive !== false ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                                onClick={() => toggleActive(m)}
                                disabled={actingId === m.modelId}
                                aria-label={t('deactivate')}
                                title={t('deactivate')}
                              >
                                <PowerOff className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            ) : (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                                onClick={() => toggleActive(m)}
                                disabled={actingId === m.modelId}
                                aria-label={t('activate')}
                                title={t('activate')}
                              >
                                <Power className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <ModelFormDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        model={editing}
        brands={brands || []}
        onSubmit={handleSubmit}
      />
    </>
  );
}

function ActiveBadge({ isActive, t }) {
  const cls = isActive
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
    : 'bg-red-50 text-red-700 ring-red-600/20';
  const label = isActive ? t('statusActive') : t('statusInactive');
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      {label}
    </span>
  );
}
