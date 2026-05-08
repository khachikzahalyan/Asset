import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';

import { Dialog } from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';
import MultiLangInput from '@/components/common/MultiLangInput/MultiLangInput.jsx';
import BranchSelect from '@/components/features/branches/BranchSelect.jsx';
import EmployeeSelect from '@/components/features/employees/EmployeeSelect.jsx';
import DepartmentSelect from '@/components/features/assets/DepartmentSelect.jsx';
import AssetSelect from '@/components/features/assets/AssetSelect.jsx';
import SubtypeFormDialog from '@/components/features/assets/SubtypeFormDialog.jsx';

import {
  emptyAssetInput,
  sanitizeAssetInput,
  validateAssetInput,
  ASSIGNMENT_KINDS,
  ASSIGNMENT_KIND_LIST,
  AssetInventoryCodeTakenError,
  AssetCounterMissingError,
  AssetCategoryInactiveError,
} from '@/domain/assets.js';
import { DEFAULT_ASSET_STATUS_CODE } from '@/domain/assetStatuses.js';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useCategories } from '@/hooks/useCategories.js';
import { useAssetStatuses } from '@/hooks/useAssetStatuses.js';
import { useAssetSubtypes } from '@/hooks/useAssetSubtypes.js';
import { firestoreAssetSubtypeRepository } from '@/infra/repositories/firestoreAssetSubtypeRepository.js';
import { firestoreCategoryRepository } from '@/infra/repositories/firestoreCategoryRepository.js';
import { CategoryIdConflictError } from '@/domain/categories.js';
import { localize } from '@/lib/localize.js';

/**
 * Modal form for creating an asset.
 *
 * Per the user-approved field list (Wave A, 2026-05-07):
 *   1. Категория        — required, drives `name` shape (multi-lang vs plain).
 *   2. Подтип            — required, filtered by category, disabled until category picked.
 *   3. Название         — Tier 3, required.
 *   4. Бренд / Модель / S/N — Tier 4 ASCII, optional.
 *   5. Куда              — radio set; options depend on category + subtype:
 *      • license category:
 *          - warehouse always enabled.
 *          - employee enabled iff subtype.attachableTo === 'device-or-employee'.
 *            Disabled with `licenseDeviceOnlyHint` when 'device-only'.
 *          - asset always enabled — renders <AssetSelect>.
 *          - branch / department NOT shown.
 *      • non-license: warehouse / employee / branch / department (existing behavior).
 *   6. Статус            — required, filtered by Куда rule. Default: 'warehouse'.
 *   7. Состояние        — radio: New / Used. Default: New.
 *   8. Гарантийный период (only when condition === 'new'):
 *      • warrantyStart, warrantyEnd (date inputs).
 *   9. Дополнительно     — collapsed <details>: notes, purchaseDate, purchasePrice.
 *
 * Submit: sanitizeAssetInput → validateAssetInput → onSubmit. Catches the
 * three repository-side errors (`AssetInventoryCodeTakenError`,
 * `AssetCounterMissingError`, `AssetCategoryInactiveError`) and surfaces
 * them inline.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('@/domain/assets.js').Asset | null} [props.asset]
 *   When present the dialog opens in edit mode.
 * @param {(input: import('@/domain/assets.js').AssetInput, opts: { category: any | null, subtype: any | null }) => Promise<void>} props.onSubmit
 */
export default function AssetFormDialog({ open, onClose, asset, onSubmit }) {
  const { t, i18n } = useTranslation(['assets', 'common']);
  const lng = i18n.resolvedLanguage ?? 'ru';
  const { user, role } = useAuth();
  const isSuperAdmin = role === 'super_admin';
  const { data: categories } = useCategories();
  const { data: statuses } = useAssetStatuses();

  const isEdit = Boolean(asset);

  const initial = useMemo(() => {
    if (!asset) return emptyAssetInput();
    return {
      categoryId: asset.categoryId ?? '',
      subtypeId: asset.subtypeId ?? '',
      name: asset.name ?? '',
      brand: asset.brand ?? null,
      model: asset.model ?? null,
      serialNumber: asset.serialNumber ?? null,
      statusId: asset.statusId ?? DEFAULT_ASSET_STATUS_CODE,
      assignedTo: asset.assignedTo ?? { kind: ASSIGNMENT_KINDS.WAREHOUSE, id: null },
      branchId: asset.branchId ?? null,
      notes: asset.notes ?? null,
      purchaseDate: asset.purchaseDate?.toDate?.() ?? null,
      purchasePrice: asset.purchasePrice ?? null,
      condition: asset.condition === 'used' ? 'used' : 'new',
      warrantyStart: asset.warrantyStart?.toDate?.() ?? null,
      warrantyEnd: asset.warrantyEnd?.toDate?.() ?? null,
      isActive: asset.isActive ?? true,
    };
  }, [asset]);

  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Inline-create-subtype dialog state. Wave A.6 — only super_admin sees
  // the trigger button, but the dialog itself is also gated server-side
  // by Firestore rules on /asset_subtypes/* (write = super_admin only).
  const [subtypeDialogOpen, setSubtypeDialogOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initial);
      setErrors({});
      setSubmitError(null);
    }
  }, [open, initial]);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.categoryId === form.categoryId) ?? null,
    [categories, form.categoryId]
  );
  const requiresMultilang = Boolean(selectedCategory?.requiresMultilang);

  // Subtypes filtered to the current category (active only).
  const { data: subtypes } = useAssetSubtypes({ categoryId: form.categoryId || null });
  const selectedSubtype = useMemo(
    () => subtypes.find((s) => s.subtypeId === form.subtypeId) ?? null,
    [subtypes, form.subtypeId]
  );

  // Allowed holder kinds for the current category + subtype combination.
  // Priority: subtype.attachableTo > category.attachableTo > all kinds.
  // Empty/missing arrays fall through so the form still works against
  // legacy un-migrated docs without locking the operator out.
  const allowedHolderKinds = useMemo(() => {
    const fromSubtype = Array.isArray(selectedSubtype?.attachableTo)
      ? selectedSubtype.attachableTo
      : null;
    if (fromSubtype && fromSubtype.length > 0) {
      return ASSIGNMENT_KIND_LIST.filter((k) => fromSubtype.includes(k));
    }
    const fromCategory = Array.isArray(selectedCategory?.attachableTo)
      ? selectedCategory.attachableTo
      : null;
    if (fromCategory && fromCategory.length > 0) {
      return ASSIGNMENT_KIND_LIST.filter((k) => fromCategory.includes(k));
    }
    return ASSIGNMENT_KIND_LIST;
  }, [selectedSubtype, selectedCategory]);

  // When the user picks a different category that demands a different `name`
  // shape, re-shape the in-flight value so the fields render correctly.
  useEffect(() => {
    if (!form.categoryId) return;
    if (requiresMultilang && typeof form.name !== 'object') {
      const seed = typeof form.name === 'string' && form.name ? form.name : '';
      setForm((f) => ({ ...f, name: { ru: seed, en: seed, hy: seed } }));
    } else if (!requiresMultilang && typeof form.name === 'object') {
      const m = form.name ?? {};
      const v = m.ru || m.en || m.hy || '';
      setForm((f) => ({ ...f, name: v }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requiresMultilang, form.categoryId]);

  // When category changes, clear subtypeId (it's category-scoped).
  useEffect(() => {
    setForm((f) =>
      f.subtypeId &&
      subtypes.length > 0 &&
      !subtypes.some((s) => s.subtypeId === f.subtypeId)
        ? { ...f, subtypeId: '' }
        : f
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.categoryId, subtypes.length]);

  // Keep `assignedTo.kind` in sync with the allowed kinds. When the
  // operator picks a category/subtype that disallows the current kind,
  // fall back to the first allowed kind. When exactly one kind is
  // allowed, auto-select it so the operator doesn't have to click.
  useEffect(() => {
    if (allowedHolderKinds.length === 0) return;
    const currentKind = form.assignedTo?.kind;
    if (currentKind && allowedHolderKinds.includes(currentKind)) return;
    const next = allowedHolderKinds[0];
    setForm((f) => ({
      ...f,
      assignedTo: { kind: next, id: null },
      branchId:
        next === ASSIGNMENT_KINDS.WAREHOUSE || next === ASSIGNMENT_KINDS.BRANCH
          ? f.branchId
          : null,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedHolderKinds]);

  function setField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function setCondition(nextCondition) {
    setForm((f) => {
      if (nextCondition === 'used') {
        // Clear warranty fields when switching to used.
        return { ...f, condition: 'used', warrantyStart: null, warrantyEnd: null };
      }
      return { ...f, condition: 'new' };
    });
  }

  function setKind(nextKind) {
    setForm((f) => {
      const at = { kind: nextKind, id: null };
      // Clear branchId when switching to a holder mode that doesn't carry a
      // location — employee, department, asset.
      let branchId = f.branchId;
      if (
        nextKind === ASSIGNMENT_KINDS.EMPLOYEE ||
        nextKind === ASSIGNMENT_KINDS.DEPARTMENT ||
        nextKind === ASSIGNMENT_KINDS.ASSET
      ) {
        branchId = null;
      }
      // Reset status to a default appropriate for the new kind so the
      // dropdown always has something selected.
      let statusId = f.statusId;
      const wantAssignable = nextKind !== ASSIGNMENT_KINDS.WAREHOUSE;
      const currentlyOk = statuses.some(
        (s) =>
          s.statusId === statusId &&
          s.isActive !== false &&
          Boolean(s.isAssignable) === wantAssignable
      );
      if (!currentlyOk) {
        const fallback = statuses.find(
          (s) => s.isActive !== false && Boolean(s.isAssignable) === wantAssignable
        );
        statusId = fallback?.statusId ?? DEFAULT_ASSET_STATUS_CODE;
      }
      return { ...f, assignedTo: at, branchId, statusId };
    });
  }

  function setAssigneeId(nextId) {
    setForm((f) => ({
      ...f,
      assignedTo: { ...f.assignedTo, id: nextId },
    }));
  }

  // Status options filtered by the current `Куда` mode.
  const statusOptions = useMemo(() => {
    const wantAssignable = form.assignedTo?.kind !== ASSIGNMENT_KINDS.WAREHOUSE;
    return statuses
      .filter((s) => s.isActive !== false)
      .filter((s) => Boolean(s.isAssignable) === wantAssignable);
  }, [statuses, form.assignedTo?.kind]);

  // Holder kinds shown for the current category + subtype, driven by the
  // configurable `attachableTo` arrays. Order follows ASSIGNMENT_KIND_LIST
  // so the operator sees a stable layout regardless of how the array was
  // typed in /settings/categories.
  const HOLDER_LABELS = useMemo(
    () => ({
      [ASSIGNMENT_KINDS.WAREHOUSE]: t('holderWarehouse'),
      [ASSIGNMENT_KINDS.EMPLOYEE]: t('holderEmployee'),
      [ASSIGNMENT_KINDS.BRANCH]: t('holderBranch'),
      [ASSIGNMENT_KINDS.DEPARTMENT]: t('holderDepartment'),
      [ASSIGNMENT_KINDS.ASSET]: t('holderAsset'),
    }),
    [t]
  );
  const holderKinds = useMemo(
    () =>
      allowedHolderKinds.map((kind) => ({
        kind,
        label: HOLDER_LABELS[kind] ?? kind,
      })),
    [allowedHolderKinds, HOLDER_LABELS]
  );

  /**
   * Inline-create-subtype submit handler. Mirrors the
   * `SubtypeManagementPage` create flow.
   *
   * Wave A.7: when the dialog returns `opts.newCategory`, the operator
   * typed a brand-new category in the typeahead. We must create the
   * category FIRST, then the subtype. Two writes intentionally — a
   * cross-collection Firestore transaction would be heavy here, and the
   * downside (orphan category if the second call fails) is recoverable
   * because the operator can re-run with the now-existing category.
   *
   * Race handling: another concurrent operator may have just created
   * the same category id. Catch `CategoryIdConflictError` once, treat
   * it as "category already exists," and proceed to the subtype create.
   */
  async function handleCreateSubtype(input, opts) {
    if (!user) throw new Error('not-authenticated');
    const actor = { uid: user.uid, role };
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
        // Race: someone created the same category id concurrently.
        // Fall through and just create the subtype — same effect.
      }
      try {
        await firestoreAssetSubtypeRepository.create(input, actor, {
          id: opts.id,
        });
      } catch (err) {
        // Category was created (above) but subtype creation failed.
        // Surface the orphan signal so the dialog renders the right hint.
        const e = new Error('subtype/orphan-category');
        e.code = 'subtype/orphan-category';
        e.cause = err;
        throw e;
      }
    } else {
      await firestoreAssetSubtypeRepository.create(input, actor, {
        id: opts.id,
      });
    }
    // Auto-select the just-created subtype. The id format is
    // `${categoryId}_${slug}` and is the same id we asked the repository
    // to use, so we can wire it in without waiting for the snapshot to
    // round-trip — `useAssetSubtypes` will deliver the full row a moment
    // later and the <option> will materialize. When a new category was
    // also created, switch the form to that category at the same time.
    setForm((f) => ({
      ...f,
      categoryId: opts?.newCategory?.id ?? f.categoryId,
      subtypeId: opts.id,
    }));
    setSubtypeDialogOpen(false);
  }

  async function handleSubmit(e) {
    if (e?.preventDefault) e.preventDefault();
    const opts = {
      category: selectedCategory,
      subtype: selectedSubtype
        ? { attachableTo: selectedSubtype.attachableTo ?? null }
        : null,
    };
    const sanitized = sanitizeAssetInput(form, opts);
    const fieldErrors = validateAssetInput(sanitized, opts);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(sanitized, {
        category: selectedCategory,
        subtype: selectedSubtype,
      });
      onClose();
    } catch (err) {
      if (err instanceof AssetInventoryCodeTakenError || err?.code === 'asset/inventory-code-taken') {
        setErrors({ categoryId: 'errorInventoryCodeTaken' });
      } else if (err instanceof AssetCounterMissingError || err?.code === 'asset/counter-missing') {
        setErrors({ categoryId: 'errorCounterMissing' });
      } else if (err instanceof AssetCategoryInactiveError || err?.code === 'asset/category-inactive') {
        setErrors({ categoryId: 'errorRequired' });
      } else {
        setSubmitError(err?.message ?? String(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={isEdit ? t('editAsset') : t('addAsset')}
      closeLabel={t('common:cancel')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting} className="gap-2">
            {submitting ? <Spinner size={14} /> : null}
            {t('common:save')}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 1. Категория */}
        <div className="space-y-1.5">
          <Label htmlFor="asset-category">{t('category')}</Label>
          <select
            id="asset-category"
            name="categoryId"
            value={form.categoryId}
            onChange={(e) => setField('categoryId', e.target.value)}
            disabled={submitting || isEdit}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            aria-invalid={Boolean(errors.categoryId)}
          >
            <option value="">{t('categoryPlaceholder')}</option>
            {categories
              .filter((c) => c.isActive !== false)
              .map((c) => (
                <option key={c.categoryId} value={c.categoryId}>
                  {localize(c.name, lng)} ({c.inventoryCodePrefix})
                </option>
              ))}
          </select>
          {errors.categoryId ? (
            <p className="text-xs text-destructive">{t(errors.categoryId)}</p>
          ) : null}
        </div>

        {/* 2. Подтип */}
        <div className="space-y-1.5">
          <Label htmlFor="asset-subtype">{t('subtype')}</Label>
          <div className="flex items-center gap-2">
            <select
              id="asset-subtype"
              name="subtypeId"
              value={form.subtypeId ?? ''}
              onChange={(e) => setField('subtypeId', e.target.value)}
              disabled={submitting || !form.categoryId}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              aria-invalid={Boolean(errors.subtypeId)}
            >
              <option value="">{t('subtypePlaceholder')}</option>
              {subtypes.map((s) => (
                <option key={s.subtypeId} value={s.subtypeId}>
                  {typeof s.name === 'object' ? localize(s.name, lng) : s.name}
                </option>
              ))}
            </select>
            {/* Inline create — Super Admin only. Disabled until a category
                is picked because the new subtype's stable id is derived
                from `${categoryId}_${slug}`. tech_admin / asset_admin
                consume the catalog only and never see this button. The
                Firestore rules on /asset_subtypes/* still enforce
                write=super_admin, so this gate is purely UX. */}
            {isSuperAdmin ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0 gap-1"
                disabled={submitting || !form.categoryId}
                onClick={() => setSubtypeDialogOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {t('addCategory')}
              </Button>
            ) : null}
          </div>
          {errors.subtypeId ? (
            <p className="text-xs text-destructive">{t(errors.subtypeId)}</p>
          ) : null}
        </div>

        {/* 3. Название */}
        <div className="space-y-1.5">
          <Label htmlFor="asset-name">{t('name')}</Label>
          {requiresMultilang ? (
            <MultiLangInput
              name="name"
              value={typeof form.name === 'object' ? form.name : { ru: '', en: '', hy: '' }}
              onChange={(next) => setField('name', next)}
              disabled={submitting}
              invalid={Boolean(errors.name)}
            />
          ) : (
            <Input
              id="asset-name"
              name="name"
              value={typeof form.name === 'string' ? form.name : ''}
              onChange={(e) => setField('name', e.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(errors.name)}
            />
          )}
          {errors.name ? (
            <p className="text-xs text-destructive">{t(errors.name)}</p>
          ) : null}
        </div>

        {/* 4. Бренд / Модель / S/N */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="asset-brand">{t('brand')}</Label>
            <Input
              id="asset-brand"
              name="brand"
              value={form.brand ?? ''}
              onChange={(e) => setField('brand', e.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(errors.brand)}
            />
            {errors.brand ? (
              <p className="text-xs text-destructive">{t(errors.brand)}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-model">{t('model')}</Label>
            <Input
              id="asset-model"
              name="model"
              value={form.model ?? ''}
              onChange={(e) => setField('model', e.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(errors.model)}
            />
            {errors.model ? (
              <p className="text-xs text-destructive">{t(errors.model)}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-sn">{t('serialNumber')}</Label>
            <Input
              id="asset-sn"
              name="serialNumber"
              value={form.serialNumber ?? ''}
              onChange={(e) => setField('serialNumber', e.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(errors.serialNumber)}
            />
            {errors.serialNumber ? (
              <p className="text-xs text-destructive">{t(errors.serialNumber)}</p>
            ) : null}
          </div>
        </div>

        {/* 5. Куда */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('holder')}</legend>
          <div className="flex flex-wrap gap-3 text-sm" role="radiogroup" aria-label={t('holder')}>
            {holderKinds.map((opt) => (
              <label key={opt.kind} className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="assignedTo.kind"
                  value={opt.kind}
                  checked={form.assignedTo?.kind === opt.kind}
                  onChange={() => setKind(opt.kind)}
                  disabled={submitting}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>

          {/* Conditional holder selectors */}
          {form.assignedTo?.kind === ASSIGNMENT_KINDS.WAREHOUSE ? (
            <div className="space-y-1.5">
              <Label htmlFor="asset-branch">{t('branch')}</Label>
              <BranchSelect
                id="asset-branch"
                name="branchId"
                value={form.branchId}
                onChange={(next) => setField('branchId', next)}
                disabled={submitting}
                includeNone={false}
              />
              {errors.branchId ? (
                <p className="text-xs text-destructive">{t(errors.branchId)}</p>
              ) : null}
            </div>
          ) : null}

          {form.assignedTo?.kind === ASSIGNMENT_KINDS.EMPLOYEE ? (
            <div className="space-y-1.5">
              <Label htmlFor="asset-employee">{t('holderEmployee')}</Label>
              <EmployeeSelect
                id="asset-employee"
                name="assignedTo.id"
                value={form.assignedTo?.id ?? null}
                onChange={(next) => setAssigneeId(next)}
                disabled={submitting}
                includeNone={false}
              />
              {errors.assignedTo ? (
                <p className="text-xs text-destructive">{t(errors.assignedTo)}</p>
              ) : null}
            </div>
          ) : null}

          {form.assignedTo?.kind === ASSIGNMENT_KINDS.BRANCH ? (
            <div className="space-y-1.5">
              <Label htmlFor="asset-branch-target">{t('holderBranch')}</Label>
              <BranchSelect
                id="asset-branch-target"
                name="branchId"
                value={form.branchId}
                onChange={(next) => setField('branchId', next)}
                disabled={submitting}
                includeNone={false}
              />
              {errors.branchId ? (
                <p className="text-xs text-destructive">{t(errors.branchId)}</p>
              ) : null}
            </div>
          ) : null}

          {form.assignedTo?.kind === ASSIGNMENT_KINDS.DEPARTMENT ? (
            <div className="space-y-1.5">
              <Label htmlFor="asset-department">{t('holderDepartment')}</Label>
              <DepartmentSelect
                id="asset-department"
                name="assignedTo.id"
                value={form.assignedTo?.id ?? null}
                onChange={(next) => setAssigneeId(next)}
                disabled={submitting}
              />
              {errors.assignedTo ? (
                <p className="text-xs text-destructive">{t(errors.assignedTo)}</p>
              ) : null}
            </div>
          ) : null}

          {form.assignedTo?.kind === ASSIGNMENT_KINDS.ASSET ? (
            <div className="space-y-1.5">
              <Label htmlFor="asset-target">{t('holderAsset')}</Label>
              <AssetSelect
                id="asset-target"
                value={form.assignedTo?.id ?? ''}
                onChange={(next) => setAssigneeId(next)}
                excludeAssetId={asset?.assetId ?? ''}
                placeholder={t('assetTargetPlaceholder')}
                disabled={submitting}
              />
              {errors.assignedTo ? (
                <p className="text-xs text-destructive">{t(errors.assignedTo)}</p>
              ) : null}
            </div>
          ) : null}
        </fieldset>

        {/* 6. Статус */}
        <div className="space-y-1.5">
          <Label htmlFor="asset-status">{t('status')}</Label>
          <select
            id="asset-status"
            name="statusId"
            value={form.statusId}
            onChange={(e) => setField('statusId', e.target.value)}
            disabled={submitting || isEdit}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            aria-invalid={Boolean(errors.statusId)}
          >
            {statusOptions.map((s) => (
              <option key={s.statusId} value={s.statusId}>
                {localize(s.name, lng)}
              </option>
            ))}
          </select>
          {errors.statusId ? (
            <p className="text-xs text-destructive">{t(errors.statusId)}</p>
          ) : null}
        </div>

        {/* 7. Состояние */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('condition')}</legend>
          <div className="flex flex-wrap gap-3 text-sm" role="radiogroup" aria-label={t('condition')}>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="condition"
                value="new"
                checked={form.condition !== 'used'}
                onChange={() => setCondition('new')}
                disabled={submitting}
              />
              <span>{t('conditionNew')}</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="condition"
                value="used"
                checked={form.condition === 'used'}
                onChange={() => setCondition('used')}
                disabled={submitting}
              />
              <span>{t('conditionUsed')}</span>
            </label>
          </div>
        </fieldset>

        {/* 8. Гарантийный период (only when condition === 'new') */}
        {form.condition !== 'used' ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('warrantyPeriod')}</legend>
            <p className="text-xs text-muted-foreground">{t('warrantyHint')}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="asset-warranty-start">{t('warrantyStart')}</Label>
                <Input
                  id="asset-warranty-start"
                  name="warrantyStart"
                  type="date"
                  value={
                    form.warrantyStart instanceof Date
                      ? form.warrantyStart.toISOString().slice(0, 10)
                      : ''
                  }
                  onChange={(e) =>
                    setField(
                      'warrantyStart',
                      e.target.value ? new Date(e.target.value) : null
                    )
                  }
                  disabled={submitting}
                  aria-invalid={Boolean(errors.warrantyStart)}
                />
                {errors.warrantyStart ? (
                  <p className="text-xs text-destructive">{t(errors.warrantyStart)}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="asset-warranty-end">{t('warrantyEnd')}</Label>
                <Input
                  id="asset-warranty-end"
                  name="warrantyEnd"
                  type="date"
                  value={
                    form.warrantyEnd instanceof Date
                      ? form.warrantyEnd.toISOString().slice(0, 10)
                      : ''
                  }
                  onChange={(e) =>
                    setField(
                      'warrantyEnd',
                      e.target.value ? new Date(e.target.value) : null
                    )
                  }
                  disabled={submitting}
                  aria-invalid={Boolean(errors.warrantyEnd)}
                />
                {errors.warrantyEnd ? (
                  <p className="text-xs text-destructive">{t(errors.warrantyEnd)}</p>
                ) : null}
              </div>
            </div>
          </fieldset>
        ) : null}

        {/* 9. Дополнительно (collapsed) */}
        <details className="rounded-md border bg-muted/20 p-3">
          <summary className="cursor-pointer text-sm font-medium">{t('more')}</summary>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="asset-notes">{t('notes')}</Label>
              <textarea
                id="asset-notes"
                name="notes"
                value={form.notes ?? ''}
                onChange={(e) => setField('notes', e.target.value)}
                disabled={submitting}
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="asset-purchase-date">{t('purchaseDate')}</Label>
              <Input
                id="asset-purchase-date"
                name="purchaseDate"
                type="date"
                value={
                  form.purchaseDate instanceof Date
                    ? form.purchaseDate.toISOString().slice(0, 10)
                    : ''
                }
                onChange={(e) =>
                  setField(
                    'purchaseDate',
                    e.target.value ? new Date(e.target.value) : null
                  )
                }
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="asset-purchase-price">{t('purchasePrice')}</Label>
              <Input
                id="asset-purchase-price"
                name="purchasePrice"
                type="number"
                inputMode="decimal"
                value={form.purchasePrice ?? ''}
                onChange={(e) =>
                  setField(
                    'purchasePrice',
                    e.target.value === '' ? null : Number.parseFloat(e.target.value)
                  )
                }
                disabled={submitting}
              />
            </div>
          </div>
        </details>

        {submitError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
      {/* Inline subtype creator. Reuses the existing dialog as-is — no
          fork. defaultCategoryId pre-fills the parent's chosen category
          so the user doesn't re-pick it inside the nested dialog. */}
      {isSuperAdmin ? (
        <SubtypeFormDialog
          open={subtypeDialogOpen}
          onClose={() => setSubtypeDialogOpen(false)}
          subtype={null}
          categories={categories || []}
          defaultCategoryId={form.categoryId || ''}
          onSubmit={handleCreateSubtype}
        />
      ) : null}
    </Dialog>
  );
}
