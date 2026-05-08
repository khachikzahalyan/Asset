import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Power, PowerOff, Trash2 } from 'lucide-react';

import PageHeader from '@/components/common/PageHeader.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import ConfirmDialog from '@/components/common/ConfirmDialog.jsx';

import SubtypeFormDialog from '@/components/features/assets/SubtypeFormDialog.jsx';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useCategories } from '@/hooks/useCategories.js';
import { useAssetSubtypes } from '@/hooks/useAssetSubtypes.js';
import { firestoreAssetSubtypeRepository } from '@/infra/repositories/firestoreAssetSubtypeRepository.js';
import { firestoreCategoryRepository } from '@/infra/repositories/firestoreCategoryRepository.js';
import {
  CategoryIdConflictError,
  CategoryReferencedError,
} from '@/domain/categories.js';
import {
  AssetSubtypeIdConflictError,
  AssetSubtypeReferencedError,
} from '@/domain/assetSubtypes.js';
import { localize } from '@/lib/localize.js';
import { isoDateUTC } from '@/lib/format/dateUtc.js';

/**
 * Subtype management page (Super Admin only) at /settings/asset-subtypes.
 *
 * Lists every subtype grouped by category; supports create / edit and
 * activate / deactivate (no hard delete — rules enforce that). Reads run
 * through `useAssetSubtypes` (subscription) and writes through the
 * repository's transactional helpers.
 *
 * The page presumes route-level RoleGate has already restricted access to
 * SUPER_ADMIN; the repository layer + Firestore rules also enforce this
 * server-side, so this page never relies on its own client-side gate.
 */
export default function SubtypeManagementPage() {
  const { t, i18n } = useTranslation(['assets', 'categories', 'common']);
  const { user, role } = useAuth();
  const { data: categories, loading: categoriesLoading } = useCategories();
  const { all: subtypes, loading: subtypesLoading, error } = useAssetSubtypes({
    includeInactive: true,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  /** @type {[null | import('@/domain/assetSubtypes.js').AssetSubtype, any]} */
  const [editing, setEditing] = useState(null);
  // When the operator clicks "+ Добавить подтип" on a specific category card
  // we store its id here and forward it as `defaultCategoryId` to the dialog
  // so the typeahead is pre-filled with that category. The global
  // "+ Добавить категорию" button at the top leaves this null so the operator
  // can type a brand-new category name in the typeahead.
  const [pendingCategoryId, setPendingCategoryId] = useState(null);
  const [actingId, setActingId] = useState(null);
  const [actionError, setActionError] = useState(null);
  /** @type {[null | import('@/domain/assetSubtypes.js').AssetSubtype, any]} */
  const [pendingDelete, setPendingDelete] = useState(null);
  // Same UX as the per-row Delete on /settings/categories, surfaced inline
  // here so the operator doesn't have to bounce pages. Cascade-delete is
  // enforced by `firestoreCategoryRepository.delete` (sub-types go down
  // with the parent category in one transaction).
  /** @type {[null | import('@/domain/categories.js').Category, any]} */
  const [pendingCategoryDelete, setPendingCategoryDelete] = useState(null);
  // Two-stage delete UX (operator request 2026-05-08): the first popup is
  // the standard confirm. If the category has at least one sub-type the
  // confirm transitions the SAME dialog into stage 'cascade' which loudly
  // warns that all sub-types will be removed too. Stage 'first' with
  // zero sub-types proceeds straight to the repository call. The stage
  // is reset to 'first' whenever a fresh delete intent opens.
  const [categoryDeleteStage, setCategoryDeleteStage] = useState('first');

  const lng = i18n.resolvedLanguage ?? 'ru';

  const grouped = useMemo(() => {
    const byCategory = new Map();
    for (const cat of categories || []) byCategory.set(cat.categoryId, []);
    for (const s of subtypes || []) {
      if (!byCategory.has(s.categoryId)) byCategory.set(s.categoryId, []);
      byCategory.get(s.categoryId).push(s);
    }
    for (const list of byCategory.values()) {
      list.sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        const an = localize(a.name, lng);
        const bn = localize(b.name, lng);
        return an.localeCompare(bn);
      });
    }
    return byCategory;
  }, [categories, subtypes, lng]);

  function openCreate(categoryId = null) {
    setEditing(null);
    setPendingCategoryId(categoryId);
    setDialogOpen(true);
    setActionError(null);
  }

  function openEdit(subtype) {
    setEditing(subtype);
    setPendingCategoryId(null);
    setDialogOpen(true);
    setActionError(null);
  }

  async function handleSubmit(input, opts) {
    if (!user) throw new Error('not-authenticated');
    const actor = { uid: user.uid, role };
    if (editing) {
      await firestoreAssetSubtypeRepository.update(
        editing.subtypeId,
        input,
        editing,
        actor
      );
    } else {
      // Wave A.7: when the operator typed a brand-new category name in the
      // typeahead, create the category FIRST, then the subtype. The two
      // writes are intentionally not wrapped in a single Firestore
      // transaction (cross-collection txn is heavy and rarely worth it
      // here — orphan-category recovery is cheap because re-running with
      // the now-existing category just succeeds).
      if (opts?.newCategory) {
        try {
          await firestoreCategoryRepository.create(
            opts.newCategory.input,
            actor,
            { id: opts.newCategory.id }
          );
        } catch (err) {
          if (!(err instanceof CategoryIdConflictError)) {
            throw err;
          }
          // Race: another operator created the same category id moments
          // before us. Treat the conflict as "category already exists" and
          // proceed to the subtype create.
        }
        try {
          await firestoreAssetSubtypeRepository.create(input, actor, {
            id: opts.id,
          });
        } catch (err) {
          // Category was created (or already existed) but the subtype
          // create failed. Surface the orphan signal so the dialog renders
          // the dedicated message.
          const e = new Error('subtype/orphan-category');
          e.code = 'subtype/orphan-category';
          e.cause = err;
          throw e;
        }
      } else {
        // Existing-category path. opts.id is the slug-derived stable id.
        await firestoreAssetSubtypeRepository.create(input, actor, {
          id: opts.id,
        });
      }
    }
    setDialogOpen(false);
    setEditing(null);
  }

  async function toggleActive(subtype) {
    if (!user) return;
    setActingId(subtype.subtypeId);
    setActionError(null);
    try {
      await firestoreAssetSubtypeRepository.setActive(
        subtype.subtypeId,
        !subtype.isActive,
        subtype,
        { uid: user.uid, role }
      );
    } catch (err) {
      setActionError(err?.message ?? String(err));
    } finally {
      setActingId(null);
    }
  }

  function openDelete(subtype) {
    setPendingDelete(subtype);
    setActionError(null);
  }

  function closeDelete() {
    setPendingDelete(null);
  }

  function openCategoryDelete(category) {
    setPendingCategoryDelete(category);
    setCategoryDeleteStage('first');
    setActionError(null);
  }

  function closeCategoryDelete() {
    setPendingCategoryDelete(null);
    setCategoryDeleteStage('first');
  }

  /**
   * Stage-1 confirm handler. If the category has at least one sub-type
   * we DO NOT delete yet — we transition the dialog to stage 'cascade'
   * which loudly states the consequence and asks again. If there are
   * zero sub-types, nothing cascades and we just call the repository
   * straight through.
   */
  async function handleCategoryDeleteFirstStage() {
    if (!pendingCategoryDelete) return;
    const cascadeCount =
      grouped.get(pendingCategoryDelete.categoryId)?.length ?? 0;
    if (cascadeCount > 0) {
      setCategoryDeleteStage('cascade');
      return;
    }
    await handleCategoryDelete();
  }

  /**
   * Cascade-aware delete. Wired into ConfirmDialog.onConfirm at stage
   * 'cascade' (or directly at stage 'first' when there are no
   * sub-types). The repository pre-flights an `assets where
   * categoryId == id` count and cascades all sub-types in the same
   * transaction; assets are the only blocker.
   */
  async function handleCategoryDelete() {
    if (!user || !pendingCategoryDelete) return;
    const target = pendingCategoryDelete;
    setActionError(null);
    try {
      await firestoreCategoryRepository.delete(
        target.categoryId,
        target,
        { uid: user.uid, role }
      );
      setPendingCategoryDelete(null);
      setCategoryDeleteStage('first');
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
      throw err;
    }
  }

  /**
   * Wired into ConfirmDialog.onConfirm. Repository.delete pre-flights a
   * referential-integrity check (assets where subtypeId === id) and throws
   * AssetSubtypeReferencedError on collision; we surface the localized
   * message via the page-level actionError alert.
   */
  async function handleDelete() {
    if (!user || !pendingDelete) return;
    const target = pendingDelete;
    setActionError(null);
    try {
      await firestoreAssetSubtypeRepository.delete(
        target.subtypeId,
        target,
        { uid: user.uid, role }
      );
      setPendingDelete(null);
    } catch (err) {
      if (err instanceof AssetSubtypeReferencedError) {
        setActionError(
          t('assets:subtypeAdminErrorReferenced', {
            assetCount: err.assetCount,
          })
        );
      } else {
        setActionError(err?.message ?? String(err));
      }
      throw err;
    }
  }

  const loading = categoriesLoading || subtypesLoading;

  return (
    <>
      <PageHeader
        title={t('assets:subtypeAdminTitle')}
        description={t('assets:subtypeAdminSubtitle')}
        actions={
          <Button size="sm" className="gap-2" onClick={() => openCreate(null)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('assets:addCategory')}
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
        <div className="space-y-4">
          {(categories || []).map((cat) => {
            const list = grouped.get(cat.categoryId) ?? [];
            return (
              <Card key={cat.categoryId}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                  <CardTitle className="text-base">
                    {t('assets:subtypeAdminGroupHeader', {
                      name: localize(cat.name, lng),
                    })}
                  </CardTitle>
                  <div className="inline-flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => openCreate(cat.categoryId)}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      {t('assets:subtypeAdminAddToGroup')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700"
                      onClick={() => openCategoryDelete(cat)}
                      aria-label={t('categories:actionDelete')}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      {t('categories:actionDelete')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {list.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('assets:subtypeAdminEmptyGroup')}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2">{t('assets:subtypeAdminColumnName')}</th>
                            <th className="px-3 py-2">{t('assets:subtypeAdminColumnAttachableTo')}</th>
                            <th className="px-3 py-2">{t('assets:subtypeAdminColumnCreatedAt')}</th>
                            <th className="px-3 py-2">{t('assets:subtypeAdminColumnStatus')}</th>
                            <th className="px-3 py-2 text-right">{t('assets:subtypeAdminColumnActions')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((s) => (
                            <tr
                              key={s.subtypeId}
                              className="border-t border-border/60 hover:bg-muted/30"
                            >
                              <td className="px-3 py-2">
                                <span className="font-medium">{localize(s.name, lng)}</span>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {renderAttachableTo(s.attachableTo, t)}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">{isoDateUTC(s.createdAt)}</td>
                              <td className="px-3 py-2">
                                <ActiveBadge isActive={s.isActive} t={t} />
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="inline-flex gap-1">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                                    onClick={() => openEdit(s)}
                                    aria-label={t('assets:subtypeAdminEdit')}
                                    title={t('assets:subtypeAdminEdit')}
                                  >
                                    <Pencil
                                      className="h-4 w-4"
                                      aria-hidden="true"
                                    />
                                  </Button>
                                  {s.isActive ? (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                                      onClick={() => toggleActive(s)}
                                      disabled={actingId === s.subtypeId}
                                      aria-label={t(
                                        'assets:subtypeAdminDeactivate'
                                      )}
                                      title={t('assets:subtypeAdminDeactivate')}
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
                                      onClick={() => toggleActive(s)}
                                      disabled={actingId === s.subtypeId}
                                      aria-label={t(
                                        'assets:subtypeAdminActivate'
                                      )}
                                      title={t('assets:subtypeAdminActivate')}
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
                                    onClick={() => openDelete(s)}
                                    aria-label={t('assets:subtypeAdminDelete')}
                                    title={t('assets:subtypeAdminDelete')}
                                  >
                                    <Trash2
                                      className="h-4 w-4"
                                      aria-hidden="true"
                                    />
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
            );
          })}
        </div>
      ) : null}

      <SubtypeFormDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
          setPendingCategoryId(null);
        }}
        subtype={editing}
        categories={categories || []}
        defaultCategoryId={pendingCategoryId}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={closeDelete}
        onConfirm={handleDelete}
        title={t('assets:subtypeAdminConfirmDeleteTitle')}
        description={
          pendingDelete
            ? t('assets:subtypeAdminConfirmDeleteBody', {
                name: localize(pendingDelete.name, lng),
              })
            : ''
        }
        confirmLabel={t('assets:subtypeAdminConfirmDelete')}
        cancelLabel={t('assets:subtypeAdminCancel')}
        destructive
        errorMessage={pendingDelete !== null ? actionError : null}
      />

      <ConfirmDialog
        open={pendingCategoryDelete !== null}
        onClose={closeCategoryDelete}
        onConfirm={
          categoryDeleteStage === 'first'
            ? handleCategoryDeleteFirstStage
            : handleCategoryDelete
        }
        title={
          categoryDeleteStage === 'first'
            ? t('categories:confirmDeleteTitleCategory')
            : t('categories:confirmDeleteCascadeTitle')
        }
        description={
          pendingCategoryDelete
            ? categoryDeleteStage === 'first'
              ? t('categories:confirmDeleteBody', {
                  name: localize(pendingCategoryDelete.name, lng),
                })
              : t('categories:confirmDeleteCascadeBody', {
                  name: localize(pendingCategoryDelete.name, lng),
                  count:
                    grouped.get(pendingCategoryDelete.categoryId)?.length ?? 0,
                })
            : ''
        }
        confirmLabel={
          categoryDeleteStage === 'first'
            ? t('categories:confirmDelete')
            : t('categories:confirmDeleteCascadeConfirm')
        }
        cancelLabel={
          categoryDeleteStage === 'first'
            ? t('assets:subtypeAdminCancel')
            : t('categories:confirmDeleteCascadeCancel')
        }
        destructive
        errorMessage={pendingCategoryDelete !== null ? actionError : null}
      />
    </>
  );
}

function renderAttachableTo(value, t) {
  if (!Array.isArray(value) || value.length === 0) {
    return t('assets:subtypeAdminAttachableNone');
  }
  return value
    .map((k) => t(`assets:assignmentKind${k.charAt(0).toUpperCase() + k.slice(1)}`))
    .join(', ');
}

function ActiveBadge({ isActive, t }) {
  // Inactive badge is rendered in red so the operator immediately sees
  // that a row is *not* in service — see CategoriesManagementPage for the
  // matching styling rationale.
  const cls = isActive
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
    : 'bg-red-50 text-red-700 ring-red-600/20';
  const label = isActive
    ? t('assets:subtypeAdminStatusActive')
    : t('assets:subtypeAdminStatusInactive');
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      {label}
    </span>
  );
}

// Re-export so callers can detect id conflicts via instanceof if needed.
export { AssetSubtypeIdConflictError };
