import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Power, PowerOff, Trash2 } from 'lucide-react';

import PageHeader from '@/components/common/PageHeader.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import ConfirmDialog from '@/components/common/ConfirmDialog.jsx';

import CategoryFormDialog, {
  deriveCategoryId,
} from '@/components/features/categories/CategoryFormDialog.jsx';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useCategories } from '@/hooks/useCategories.js';
import { useAssetSubtypes } from '@/hooks/useAssetSubtypes.js';
import { firestoreCategoryRepository } from '@/infra/repositories/firestoreCategoryRepository.js';
import {
  CategoryIdConflictError,
  CategoryReferencedError,
} from '@/domain/categories.js';
import { localize } from '@/lib/localize.js';
import { isoDateUTC } from '@/lib/format/dateUtc.js';

/**
 * Categories management page (Super Admin only) at /settings/categories.
 *
 * Lists every category with name (localized), inventory-code prefix,
 * multi-language flag, status (active/inactive), and createdAt.
 * Supports create / edit and activate / deactivate (no hard delete —
 * Firestore rules enforce that). Reads run through `useCategories`
 * and writes through the repository's transactional helpers.
 *
 * Stable doc id: derived from the first ASCII-friendly locale of the
 * supplied name. On collision with an existing category id, a numeric
 * suffix is appended client-side (`server_rack_2`, `server_rack_3`, ...)
 * before calling repository.create. The repository ALSO performs a
 * server-side collision check inside the transaction and throws
 * CategoryIdConflictError on race — that error is surfaced to the
 * operator via the dialog's submitError alert.
 *
 * Counter init: handled atomically by the repository; this page does
 * NOT touch `category_counters/{id}` directly.
 *
 * The page presumes route-level RoleGate has already restricted access
 * to SUPER_ADMIN; the repository layer + Firestore rules also enforce
 * this server-side, so this page never relies on its own client gate.
 */
export default function CategoriesManagementPage() {
  const { t, i18n } = useTranslation(['categories', 'common']);
  const { user, role } = useAuth();
  const { data: categories, loading, error } = useCategories();
  // Subscribed only so the delete dialog can compute the cascade count
  // ("вместе с категорией удалятся N подтипов"). The data is otherwise
  // unused on this page — categories don't need a per-row subtype list
  // here. Inactive sub-types are included so the cascade count matches
  // exactly what the repository will delete.
  const { all: subtypesAll } = useAssetSubtypes({ includeInactive: true });

  const [dialogOpen, setDialogOpen] = useState(false);
  /** @type {[null | import('@/domain/categories.js').Category, any]} */
  const [editing, setEditing] = useState(null);
  const [actingId, setActingId] = useState(null);
  const [actionError, setActionError] = useState(null);
  /** @type {[null | import('@/domain/categories.js').Category, any]} */
  const [pendingDelete, setPendingDelete] = useState(null);
  // Two-stage delete UX: stage 'first' is the standard confirm, stage
  // 'cascade' is shown only when the category has at least one sub-type
  // and loudly states that the sub-types will be removed too. See
  // SubtypeManagementPage for the matching pattern.
  const [deleteStage, setDeleteStage] = useState('first');

  const lng = i18n.resolvedLanguage ?? 'ru';

  const sorted = useMemo(() => {
    return [...(categories || [])].sort((a, b) => {
      const an = localize(a.name, lng);
      const bn = localize(b.name, lng);
      return an.localeCompare(bn);
    });
  }, [categories, lng]);

  const existingIds = useMemo(() => {
    const set = new Set();
    for (const c of categories || []) set.add(c.categoryId);
    return set;
  }, [categories]);

  // categoryId → number of sub-types that would be removed by a cascade
  // delete. Used by the second-stage confirm body.
  const subtypeCountByCategory = useMemo(() => {
    const map = new Map();
    for (const s of subtypesAll || []) {
      map.set(s.categoryId, (map.get(s.categoryId) ?? 0) + 1);
    }
    return map;
  }, [subtypesAll]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
    setActionError(null);
  }

  function openEdit(category) {
    setEditing(category);
    setDialogOpen(true);
    setActionError(null);
  }

  /**
   * Compute a unique id for a brand-new category. If the slug-derived id
   * already exists in the in-memory list, append the smallest integer
   * suffix that produces a free id (`server_rack` taken → `server_rack_2`,
   * also taken → `server_rack_3`, ...).
   *
   * Note: this is best-effort; the repository transaction performs the
   * authoritative collision check. If two operators race at the same
   * moment, one will see CategoryIdConflictError and the dialog will
   * surface it.
   */
  function uniqueIdForName(name) {
    const base = deriveCategoryId(name);
    if (!base) return '';
    if (!existingIds.has(base)) return base;
    let i = 2;
    while (existingIds.has(`${base}_${i}`)) i += 1;
    return `${base}_${i}`;
  }

  async function handleSubmit(input) {
    if (!user) throw new Error('not-authenticated');
    const actor = { uid: user.uid, role };
    if (editing) {
      // Edit path: id is fixed, never re-derived.
      await firestoreCategoryRepository.update(
        editing.categoryId,
        input,
        editing,
        actor
      );
    } else {
      const id = uniqueIdForName(input.name);
      // Repository will throw CategoryIdConflictError if the in-memory
      // freshness check above lost a race; the dialog displays it.
      await firestoreCategoryRepository.create(input, actor, { id });
    }
    setDialogOpen(false);
    setEditing(null);
  }

  async function toggleActive(category) {
    if (!user) return;
    setActingId(category.categoryId);
    setActionError(null);
    try {
      await firestoreCategoryRepository.setActive(
        category.categoryId,
        !category.isActive,
        category,
        { uid: user.uid, role }
      );
    } catch (err) {
      if (err instanceof CategoryIdConflictError) {
        setActionError(t('categories:errorIdConflict'));
      } else {
        setActionError(err?.message ?? String(err));
      }
    } finally {
      setActingId(null);
    }
  }

  function openDelete(category) {
    setPendingDelete(category);
    setActionError(null);
  }

  function closeDelete() {
    setPendingDelete(null);
    setDeleteStage('first');
  }

  /**
   * Stage-1 confirm handler. If the category has at least one sub-type
   * we transition the same dialog into stage 'cascade' which loudly
   * states that all sub-types will be removed. With zero sub-types we
   * call the repository straight through.
   */
  async function handleDeleteFirstStage() {
    if (!pendingDelete) return;
    const cascadeCount =
      subtypeCountByCategory.get(pendingDelete.categoryId) ?? 0;
    if (cascadeCount > 0) {
      setDeleteStage('cascade');
      return;
    }
    await handleDelete();
  }

  /**
   * Wired into ConfirmDialog.onConfirm at stage 'cascade' (or directly
   * at stage 'first' when there are no sub-types). Repository.delete
   * pre-flights a referential-integrity check on assets and cascades
   * sub-types in the same transaction; assets are the only blocker.
   */
  async function handleDelete() {
    if (!user || !pendingDelete) return;
    const target = pendingDelete;
    setActionError(null);
    try {
      await firestoreCategoryRepository.delete(
        target.categoryId,
        target,
        { uid: user.uid, role }
      );
      // Success: close the modal. The onSnapshot subscription will drop
      // the row from the table on the next tick.
      setPendingDelete(null);
      setDeleteStage('first');
    } catch (err) {
      if (err instanceof CategoryReferencedError) {
        setActionError(
          t('categories:errorCategoryReferenced', {
            assetCount: err.assetCount,
          })
        );
      } else {
        setActionError(err?.message ?? String(err));
      }
      // Re-throw so ConfirmDialog stays open and shows the error path.
      // (ConfirmDialog itself swallows the throw — the page-level alert
      // is what surfaces the message to the operator.)
      throw err;
    }
  }

  return (
    <>
      <PageHeader
        title={t('categories:title')}
        description={t('categories:subtitle')}
        actions={
          <Button size="sm" className="gap-2" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('categories:addCategory')}
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
          <span className="text-sm">{t('common:loading')}</span>
        </div>
      ) : null}

      {!loading ? (
        <Card>
          <CardContent className="pt-6">
            {sorted.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('categories:emptyState')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">{t('categories:colName')}</th>
                      <th className="px-3 py-2">{t('categories:colPrefix')}</th>
                      <th className="px-3 py-2">{t('categories:colMultilang')}</th>
                      <th className="px-3 py-2">{t('categories:colStatus')}</th>
                      <th className="px-3 py-2">{t('categories:colCreatedAt')}</th>
                      <th className="px-3 py-2 text-right">
                        {t('categories:colActions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((c) => (
                      <tr
                        key={c.categoryId}
                        className="border-t border-border/60 hover:bg-muted/30"
                      >
                        <td className="px-3 py-2">
                          <span className="font-medium">
                            {localize(c.name, lng)}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-muted-foreground">
                          {c.inventoryCodePrefix}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {c.requiresMultilang
                            ? t('categories:multilangYes')
                            : t('categories:multilangNo')}
                        </td>
                        <td className="px-3 py-2">
                          <ActiveBadge isActive={c.isActive !== false} t={t} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {isoDateUTC(c.createdAt)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                              onClick={() => openEdit(c)}
                              aria-label={t('categories:edit')}
                              title={t('categories:edit')}
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            {c.isActive !== false ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                                onClick={() => toggleActive(c)}
                                disabled={actingId === c.categoryId}
                                aria-label={t('categories:deactivate')}
                                title={t('categories:deactivate')}
                              >
                                <PowerOff
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                />
                              </Button>
                            ) : (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                                onClick={() => toggleActive(c)}
                                disabled={actingId === c.categoryId}
                                aria-label={t('categories:activate')}
                                title={t('categories:activate')}
                              >
                                <Power
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                />
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-red-600 hover:bg-red-50 hover:text-red-700"
                              onClick={() => openDelete(c)}
                              aria-label={t('categories:actionDelete')}
                              title={t('categories:actionDelete')}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
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

      <CategoryFormDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        category={editing}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={closeDelete}
        onConfirm={
          deleteStage === 'first' ? handleDeleteFirstStage : handleDelete
        }
        title={
          deleteStage === 'first'
            ? t('categories:confirmDeleteTitleCategory')
            : t('categories:confirmDeleteCascadeTitle')
        }
        description={
          pendingDelete
            ? deleteStage === 'first'
              ? t('categories:confirmDeleteBody', {
                  name: localize(pendingDelete.name, lng),
                })
              : t('categories:confirmDeleteCascadeBody', {
                  name: localize(pendingDelete.name, lng),
                  count:
                    subtypeCountByCategory.get(pendingDelete.categoryId) ?? 0,
                })
            : ''
        }
        confirmLabel={
          deleteStage === 'first'
            ? t('categories:confirmDelete')
            : t('categories:confirmDeleteCascadeConfirm')
        }
        cancelLabel={
          deleteStage === 'first'
            ? t('categories:cancel')
            : t('categories:confirmDeleteCascadeCancel')
        }
        destructive
        errorMessage={pendingDelete !== null ? actionError : null}
      />
    </>
  );
}

function ActiveBadge({ isActive, t }) {
  // Inactive badge is rendered in red so the operator immediately sees
  // that a row is *not* in service — the previous neutral-gray styling
  // blended in with the rest of the muted-text columns and was easy to
  // miss in scrollable tables.
  const cls = isActive
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
    : 'bg-red-50 text-red-700 ring-red-600/20';
  const label = isActive
    ? t('categories:statusActive')
    : t('categories:statusInactive');
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      {label}
    </span>
  );
}
