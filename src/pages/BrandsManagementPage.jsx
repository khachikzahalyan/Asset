import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Power, PowerOff } from 'lucide-react';

import PageHeader from '@/components/common/PageHeader.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import BrandFormDialog from '@/components/features/brands/BrandFormDialog.jsx';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { useBrands } from '@/hooks/useBrands.js';
import {
  createBrand,
  updateBrand,
  setBrandActive,
} from '@/infra/repositories/firestoreBrandRepository.js';
import { BrandIdConflictError } from '@/domain/brands.js';

/**
 * Brands management page (Super Admin only) at /settings/brands.
 *
 * Lists all brands with name, status, and actions (edit, activate/deactivate).
 * Create and edit are handled through BrandFormDialog.
 * Soft-delete only — no hard delete for brands.
 */
export default function BrandsManagementPage() {
  const { t } = useTranslation('brands');
  const { user, role } = useAuth();
  const { data: brands, loading, error } = useBrands();

  const [dialogOpen, setDialogOpen] = useState(false);
  /** @type {[null | import('@/domain/brands.js').Brand, Function]} */
  const [editing, setEditing] = useState(null);
  const [actingId, setActingId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const sorted = useMemo(() => {
    return [...(brands || [])].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [brands]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
    setActionError(null);
  }

  function openEdit(brand) {
    setEditing(brand);
    setDialogOpen(true);
    setActionError(null);
  }

  async function handleSubmit(input) {
    if (!user) throw new Error('not-authenticated');
    const actor = { uid: user.uid, role };
    if (editing) {
      await updateBrand(editing.brandId, input, actor);
    } else {
      await createBrand(input, actor);
    }
    setDialogOpen(false);
    setEditing(null);
  }

  async function toggleActive(brand) {
    if (!user) return;
    setActingId(brand.brandId);
    setActionError(null);
    try {
      await setBrandActive(brand.brandId, !brand.isActive, {
        uid: user.uid,
        role,
      });
    } catch (err) {
      if (err instanceof BrandIdConflictError) {
        setActionError(t('errorNameNotUnique'));
      } else {
        setActionError(err?.message ?? String(err));
      }
    } finally {
      setActingId(null);
    }
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button size="sm" className="gap-2" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('addBrand')}
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
                      <th className="px-3 py-2">{t('columnName')}</th>
                      <th className="px-3 py-2">{t('columnStatus')}</th>
                      <th className="px-3 py-2 text-right">{t('columnActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((b) => (
                      <tr
                        key={b.brandId}
                        className="border-t border-border/60 hover:bg-muted/30"
                      >
                        <td className="px-3 py-2 font-medium">{b.name}</td>
                        <td className="px-3 py-2">
                          <ActiveBadge isActive={b.isActive !== false} t={t} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                              onClick={() => openEdit(b)}
                              aria-label={t('editBrand')}
                              title={t('editBrand')}
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            {b.isActive !== false ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                                onClick={() => toggleActive(b)}
                                disabled={actingId === b.brandId}
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
                                onClick={() => toggleActive(b)}
                                disabled={actingId === b.brandId}
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

      <BrandFormDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        brand={editing}
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
