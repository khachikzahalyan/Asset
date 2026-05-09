import { useEffect, useMemo, useRef, useState } from 'react';
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
import { BrandSelect } from '@/components/features/assets/BrandSelect.jsx';
import { ModelSelect } from '@/components/features/assets/ModelSelect.jsx';
import { LicenseFieldsBlock } from '@/components/features/assets/LicenseFieldsBlock.jsx';
import { AssetCreatePreviewDialog } from '@/components/features/assets/AssetCreatePreviewDialog.jsx';
import { useInventoryCodePreview } from '@/hooks/useInventoryCodePreview.js';
import { useInlineSubtypeCreator } from '@/hooks/useInlineSubtypeCreator.js';

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
import { localize } from '@/lib/localize.js';

/**
 * Modal form for creating or editing an asset.
 *
 * ## Groups (new progressive-disclosure layout — T35)
 *
 *   Group 1 — What is it? (Category / Subtype / Brand / Model — always visible)
 *   Group 2 — Identifiers (Inventory code preview, Serial, Name)
 *             Visible once Category + Subtype are set.
 *   Group 6 — License only (LicenseFieldsBlock)
 *             Visible only when categoryId === 'license'.
 *   Group 3 — Where is it? (Branch / holder radios)
 *             Visible once Category is set.
 *   Group 4 — Money & warranty (collapsed <details>)
 *             Visible once Category is set. Contains condition radios,
 *             warranty fieldset, and purchase date/price.
 *   Group 5 — Notes
 *             Visible once Category is set.
 *
 * ## Props
 *
 *   open, mode, initialAsset, onSubmit, onOpenChange
 *
 *   `asset` is accepted as an alias for `initialAsset` for backward compatibility.
 *   `mode` defaults to 'create' when no asset is provided, 'edit' otherwise.
 *
 * ## onSubmit signature
 *
 *   onSubmit(sanitizedPayload, { category, subtype })
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {'create'|'edit'} [props.mode]
 * @param {Object|null} [props.initialAsset]
 * @param {Object|null} [props.asset]          alias for initialAsset
 * @param {string} [props.initialLicenseKey]   create: pre-populate license key field
 * @param {(input, opts) => Promise<void>} props.onSubmit
 * @param {(open: boolean) => void} [props.onOpenChange]
 */
export default function AssetFormDialog({
  open,
  mode: modeProp,
  initialAsset,
  asset: assetLegacy,
  initialLicenseKey,
  onSubmit,
  onOpenChange,
}) {
  const { t, i18n } = useTranslation(['assets', 'common']);
  const lng = i18n.resolvedLanguage ?? 'ru';
  const { role } = useAuth();
  const isSuperAdmin = role === 'super_admin';
  const { data: categories } = useCategories();
  const { data: statuses } = useAssetStatuses();

  // Normalize legacy vs new API.
  const assetRecord = initialAsset ?? assetLegacy ?? null;
  const isEdit = modeProp ? modeProp === 'edit' : Boolean(assetRecord);

  function handleClose() {
    onOpenChange?.(false);
  }

  // ---------------------------------------------------------------------------
  // Derive initial state from the asset record.
  // ---------------------------------------------------------------------------

  const initial = useMemo(() => {
    if (!assetRecord) return emptyAssetInput();
    return {
      categoryId: assetRecord.categoryId ?? '',
      subtypeId: assetRecord.subtypeId ?? '',
      name: assetRecord.name ?? '',
      brandId: assetRecord.brandId ?? null,
      modelId: assetRecord.modelId ?? null,
      serialNumber: assetRecord.serialNumber ?? null,
      statusId: assetRecord.statusId ?? DEFAULT_ASSET_STATUS_CODE,
      assignedTo: assetRecord.assignedTo ?? {
        kind: ASSIGNMENT_KINDS.WAREHOUSE,
        id: null,
      },
      branchId: assetRecord.branchId ?? null,
      notes: assetRecord.notes ?? null,
      purchaseDate: assetRecord.purchaseDate?.toDate?.() ?? null,
      purchasePrice: assetRecord.purchasePrice ?? null,
      condition: assetRecord.condition === 'used' ? 'used' : 'new',
      warrantyStart: assetRecord.warrantyStart?.toDate?.() ?? null,
      warrantyEnd: assetRecord.warrantyEnd?.toDate?.() ?? null,
      licenseType: assetRecord.licenseType ?? null,
      subscribedAt: assetRecord.subscribedAt ?? null,
      expiresAt: assetRecord.expiresAt ?? null,
      isActive: assetRecord.isActive ?? true,
    };
  }, [assetRecord]);

  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [subtypeDialogOpen, setSubtypeDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Sticky-defaults / "Save & add another" state (create mode only).
  const [addedCount, setAddedCount] = useState(0);
  const [lastSavedTick, setLastSavedTick] = useState(0);
  const serialInputRef = useRef(null);

  // License key — kept outside React state to avoid re-renders.
  const licenseKeyRef = useRef(initialLicenseKey ?? '');

  // ---------------------------------------------------------------------------
  // Reset on open/close.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (open) {
      setForm(initial);
      setErrors({});
      setSubmitError(null);
      licenseKeyRef.current = initialLicenseKey ?? '';
    } else {
      setAddedCount(0);
      setLastSavedTick(0);
      setPreviewOpen(false);
    }
  }, [open, initial, initialLicenseKey]);

  // After "Save & add another", focus the serial number input.
  useEffect(() => {
    if (lastSavedTick > 0 && serialInputRef.current) {
      serialInputRef.current.focus();
    }
  }, [lastSavedTick]);

  // ---------------------------------------------------------------------------
  // Derived category/subtype state.
  // ---------------------------------------------------------------------------

  const selectedCategory = useMemo(
    () =>
      categories.find(
        (c) => (c.categoryId ?? c.id) === form.categoryId
      ) ?? null,
    [categories, form.categoryId]
  );
  const requiresMultilang = Boolean(selectedCategory?.requiresMultilang);

  const { data: subtypes } = useAssetSubtypes({
    categoryId: form.categoryId || null,
  });
  const selectedSubtype = useMemo(
    () =>
      subtypes.find(
        (s) => (s.subtypeId ?? s.id) === form.subtypeId
      ) ?? null,
    [subtypes, form.subtypeId]
  );

  // Inventory code preview (shown only when category assigns codes).
  const assignsInventoryCode =
    selectedCategory === null
      ? false
      : (selectedCategory.assignsInventoryCode ?? true) !== false;

  const { value: inventoryPreview } = useInventoryCodePreview(
    assignsInventoryCode ? form.categoryId || null : null
  );

  // ---------------------------------------------------------------------------
  // Allowed holder kinds driven by category + subtype attachableTo arrays.
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Effects: reshape form when category/subtype change.
  // ---------------------------------------------------------------------------

  // Reshape `name` when multilang requirement changes.
  // Reshape only when category/multilang changes — including form.name would loop on every keystroke.
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

  // Clear subtypeId when category changes and the subtype is no longer valid.
  // Re-validate subtypeId only on category change or subtypes-list size change.
  useEffect(() => {
    setForm((f) =>
      f.subtypeId &&
      subtypes.length > 0 &&
      !subtypes.some((s) => (s.subtypeId ?? s.id) === f.subtypeId)
        ? { ...f, subtypeId: '' }
        : f
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.categoryId, subtypes.length]);

  // Keep assignedTo.kind in sync with allowed kinds.
  // allowedHolderKinds is the only relevant input; including form.assignedTo.kind would loop on every kind change.
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

  // ---------------------------------------------------------------------------
  // Setters.
  // ---------------------------------------------------------------------------

  function setField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function setCondition(nextCondition) {
    setForm((f) => {
      if (nextCondition === 'used') {
        return { ...f, condition: 'used', warrantyStart: null, warrantyEnd: null };
      }
      return { ...f, condition: 'new' };
    });
  }

  function setKind(nextKind) {
    setForm((f) => {
      const at = { kind: nextKind, id: null };
      let branchId = f.branchId;
      if (
        nextKind === ASSIGNMENT_KINDS.EMPLOYEE ||
        nextKind === ASSIGNMENT_KINDS.DEPARTMENT ||
        nextKind === ASSIGNMENT_KINDS.ASSET
      ) {
        branchId = null;
      }
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

  // ---------------------------------------------------------------------------
  // Derived view state.
  // ---------------------------------------------------------------------------

  const statusOptions = useMemo(() => {
    const wantAssignable = form.assignedTo?.kind !== ASSIGNMENT_KINDS.WAREHOUSE;
    return statuses
      .filter((s) => s.isActive !== false)
      .filter((s) => Boolean(s.isAssignable) === wantAssignable);
  }, [statuses, form.assignedTo?.kind]);

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

  // ---------------------------------------------------------------------------
  // Inline-create-subtype handler (uses hook — no infra imports in this file).
  // ---------------------------------------------------------------------------

  const createInlineSubtype = useInlineSubtypeCreator();

  async function handleCreateSubtype(input, opts) {
    await createInlineSubtype(input, opts);
    setForm((f) => ({
      ...f,
      categoryId: opts?.newCategory?.id ?? f.categoryId,
      subtypeId: opts.id,
    }));
    setSubtypeDialogOpen(false);
  }

  // ---------------------------------------------------------------------------
  // Validation helpers.
  // ---------------------------------------------------------------------------

  function buildPayload() {
    const opts = {
      category: selectedCategory,
      subtype: selectedSubtype
        ? { attachableTo: selectedSubtype.attachableTo ?? null }
        : null,
    };
    return { sanitized: sanitizeAssetInput(form, opts), opts };
  }

  function runValidation() {
    const { sanitized, opts } = buildPayload();
    const fieldErrors = validateAssetInput(sanitized, opts);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return { valid: false };
    }
    setErrors({});
    return { valid: true, sanitized, opts };
  }

  // ---------------------------------------------------------------------------
  // Submit handlers.
  // ---------------------------------------------------------------------------

  /**
   * Validates and submits the form.
   * Returns true on success, false on validation/submit failure.
   *
   * @param {Event} [e]
   * @returns {Promise<boolean>}
   */
  async function handleSubmit(e) {
    if (e?.preventDefault) e.preventDefault();
    const result = runValidation();
    if (!result.valid) return false;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(result.sanitized, {
        category: selectedCategory,
        subtype: selectedSubtype,
      });
      handleClose();
      return true;
    } catch (err) {
      if (
        err instanceof AssetInventoryCodeTakenError ||
        err?.code === 'asset/inventory-code-taken'
      ) {
        setErrors({ categoryId: 'errorInventoryCodeTaken' });
      } else if (
        err instanceof AssetCounterMissingError ||
        err?.code === 'asset/counter-missing'
      ) {
        setErrors({ categoryId: 'errorCounterMissing' });
      } else if (
        err instanceof AssetCategoryInactiveError ||
        err?.code === 'asset/category-inactive'
      ) {
        setErrors({ categoryId: 'errorRequired' });
      } else {
        setSubmitError(err?.message ?? String(err));
      }
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Validates and submits, then resets per-asset fields for the next entry.
   * Returns true on success, false on validation/submit failure.
   *
   * @returns {Promise<boolean>}
   */
  async function handleSaveAndAddAnother() {
    if (submitting) return false;
    const result = runValidation();
    if (!result.valid) return false;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(result.sanitized, {
        category: selectedCategory,
        subtype: selectedSubtype,
      });
      // Reset per-asset fields; keep sticky fields in form state.
      setForm((f) => ({
        ...f,
        serialNumber: null,
        name: requiresMultilang ? { ru: '', en: '', hy: '' } : '',
        assignedTo: { kind: f.assignedTo?.kind ?? ASSIGNMENT_KINDS.WAREHOUSE, id: null },
        licenseType: null,
        subscribedAt: null,
        expiresAt: null,
      }));
      licenseKeyRef.current = '';
      setAddedCount((n) => n + 1);
      setLastSavedTick((tick) => tick + 1);
      return true;
    } catch (err) {
      if (
        err instanceof AssetInventoryCodeTakenError ||
        err?.code === 'asset/inventory-code-taken'
      ) {
        setErrors({ categoryId: 'errorInventoryCodeTaken' });
      } else if (
        err instanceof AssetCounterMissingError ||
        err?.code === 'asset/counter-missing'
      ) {
        setErrors({ categoryId: 'errorCounterMissing' });
      } else if (
        err instanceof AssetCategoryInactiveError ||
        err?.code === 'asset/category-inactive'
      ) {
        setErrors({ categoryId: 'errorRequired' });
      } else {
        setSubmitError(err?.message ?? String(err));
      }
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render.
  // ---------------------------------------------------------------------------

  const dialogTitle = isEdit ? t('editAsset') : t('addAsset');

  const footer = (
    <>
      <Button
        variant="outline"
        onClick={handleClose}
        disabled={submitting}
      >
        {t('common:cancel')}
      </Button>
      {!isEdit ? (
        // Create mode: preview flow + save-and-add-another.
        <>
          <Button
            variant="outline"
            onClick={handleSaveAndAddAnother}
            disabled={submitting}
          >
            {submitting ? <Spinner size={14} /> : null}
            {addedCount > 0
              ? t('saveAndAddAnotherWithCount', { count: addedCount })
              : t('saveAndAddAnother')}
          </Button>
          <Button
            onClick={() => setPreviewOpen(true)}
            disabled={submitting}
          >
            {t('nextButton')}
          </Button>
        </>
      ) : (
        // Edit mode: direct save button.
        <Button onClick={handleSubmit} disabled={submitting} className="gap-2">
          {submitting ? <Spinner size={14} /> : null}
          {t('common:save')}
        </Button>
      )}
    </>
  );

  return (
    <>
      <Dialog
        open={open}
        onClose={submitting ? () => {} : handleClose}
        onOpenChange={submitting ? undefined : onOpenChange}
        title={dialogTitle}
        closeLabel={t('common:cancel')}
        footer={footer}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">

          {/* ---- Group 1: What is it? ---- */}
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-semibold">{t('groupWhatIsIt')}</legend>

            {/* Category */}
            <div className="space-y-1.5">
              <Label htmlFor="asset-category">{t('category')}</Label>
              <select
                id="asset-category"
                name="categoryId"
                value={form.categoryId}
                onChange={(e) => {
                  const next = e.target.value;
                  setForm((f) => ({
                    ...f,
                    categoryId: next,
                    subtypeId: '',
                    brandId: null,
                    modelId: null,
                  }));
                }}
                disabled={submitting || isEdit}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                aria-invalid={Boolean(errors.categoryId)}
              >
                <option value="">{t('categoryPlaceholder')}</option>
                {categories
                  .filter((c) => c.isActive !== false)
                  .map((c) => (
                    <option
                      key={c.categoryId ?? c.id}
                      value={c.categoryId ?? c.id}
                    >
                      {localize(c.name, lng)} ({c.inventoryCodePrefix})
                    </option>
                  ))}
              </select>
              {errors.categoryId ? (
                <p className="text-xs text-destructive">{t(errors.categoryId)}</p>
              ) : null}
            </div>

            {/* Empty state — shown when no category is selected yet */}
            {!form.categoryId ? (
              <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
                {t('emptyStatePickCategory')}
              </p>
            ) : null}

            {/* Subtype */}
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
                    <option
                      key={s.subtypeId ?? s.id}
                      value={s.subtypeId ?? s.id}
                    >
                      {typeof s.name === 'object'
                        ? localize(s.name, lng)
                        : s.name}
                    </option>
                  ))}
                </select>
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

            {/* Brand + Model — only for non-multilang categories */}
            {selectedCategory && selectedCategory.requiresMultilang === false ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="brand-select">{t('brandLabel')}</Label>
                  <BrandSelect
                    id="brand-select"
                    value={form.brandId}
                    onChange={(next) => {
                      setForm((f) => ({ ...f, brandId: next, modelId: null }));
                    }}
                    disabled={submitting}
                  />
                  {errors.brandId ? (
                    <p className="text-xs text-destructive">{t(errors.brandId)}</p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="model-select">{t('modelLabel')}</Label>
                  <ModelSelect
                    id="model-select"
                    brandId={form.brandId}
                    value={form.modelId}
                    onChange={(next) => setField('modelId', next)}
                    disabled={submitting}
                  />
                  {errors.modelId ? (
                    <p className="text-xs text-destructive">{t(errors.modelId)}</p>
                  ) : null}
                </div>
              </>
            ) : null}
          </fieldset>

          {/* ---- Group 2: Identifiers (visible once category + subtype set) ---- */}
          {form.categoryId && form.subtypeId ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="text-sm font-semibold">{t('groupIdentifiers')}</legend>

              {/* Inventory code preview */}
              {assignsInventoryCode ? (
                <label className="flex flex-col gap-1 text-sm">
                  <span>{t('inventoryCode')}</span>
                  <input
                    readOnly
                    value={inventoryPreview ?? ''}
                    className="rounded-md border bg-muted px-3 py-2 text-sm"
                    aria-label={t('inventoryCode')}
                  />
                </label>
              ) : null}

              {/* Serial number — uncontrolled with ref for focus-after-save */}
              <div className="space-y-1.5">
                <Label htmlFor="asset-sn">{t('serialNumber')}</Label>
                <Input
                  ref={serialInputRef}
                  id="asset-sn"
                  name="serialNumber"
                  defaultValue={assetRecord?.serialNumber ?? ''}
                  onBlur={(e) => setField('serialNumber', e.target.value)}
                  disabled={submitting}
                  key={lastSavedTick}
                  aria-invalid={Boolean(errors.serialNumber)}
                />
                {errors.serialNumber ? (
                  <p className="text-xs text-destructive">{t(errors.serialNumber)}</p>
                ) : null}
              </div>

              {/* Name — only for multilang categories */}
              {requiresMultilang ? (
                <MultiLangInput
                  name="name"
                  value={
                    typeof form.name === 'object'
                      ? form.name
                      : { ru: '', en: '', hy: '' }
                  }
                  onChange={(next) => setField('name', next)}
                  disabled={submitting}
                  invalid={Boolean(errors.name)}
                />
              ) : null}
              {errors.name ? (
                <p className="text-xs text-destructive">{t(errors.name)}</p>
              ) : null}
            </fieldset>
          ) : null}

          {/* ---- Group 6: License only ---- */}
          {form.categoryId === 'license' ? (
            <LicenseFieldsBlock
              value={{
                licenseType: form.licenseType,
                subscribedAt: form.subscribedAt,
                expiresAt: form.expiresAt,
              }}
              onChange={(patch) => {
                if ('licenseType' in patch)
                  setField('licenseType', patch.licenseType);
                if ('subscribedAt' in patch)
                  setField('subscribedAt', patch.subscribedAt);
                if ('expiresAt' in patch)
                  setField('expiresAt', patch.expiresAt);
              }}
              onLicenseKeyChange={(value) => {
                licenseKeyRef.current = value;
              }}
              licenseKeyDefault={initialLicenseKey ?? ''}
              resetTick={lastSavedTick}
            />
          ) : null}

          {/* ---- Group 3: Where is it? (visible once category set) ---- */}
          {form.categoryId ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="text-sm font-semibold">{t('groupWhereIsIt')}</legend>

              {/* Holder radio buttons */}
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t('holder')}</legend>
                <div
                  className="flex flex-wrap gap-3 text-sm"
                  role="radiogroup"
                  aria-label={t('holder')}
                >
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

                {/* Warehouse branch picker */}
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
                      <p className="text-xs text-destructive">
                        {t(errors.branchId)}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {/* Employee picker */}
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
                      <p className="text-xs text-destructive">
                        {t(errors.assignedTo)}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {/* Branch picker */}
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
                      <p className="text-xs text-destructive">
                        {t(errors.branchId)}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {/* Department picker */}
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
                      <p className="text-xs text-destructive">
                        {t(errors.assignedTo)}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {/* Asset picker */}
                {form.assignedTo?.kind === ASSIGNMENT_KINDS.ASSET ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="asset-target">{t('holderAsset')}</Label>
                    <AssetSelect
                      id="asset-target"
                      value={form.assignedTo?.id ?? ''}
                      onChange={(next) => setAssigneeId(next)}
                      excludeAssetId={assetRecord?.assetId ?? ''}
                      placeholder={t('assetTargetPlaceholder')}
                      disabled={submitting}
                      requireCanHostLicense={form.categoryId === 'license'}
                    />
                    {errors.assignedTo ? (
                      <p className="text-xs text-destructive">
                        {t(errors.assignedTo)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </fieldset>

              {/* Status */}
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
            </fieldset>
          ) : null}

          {/* ---- Group 4: Money & warranty (visible when category set) ---- */}
          {form.categoryId ? (
            <details className="rounded-md border bg-muted/20 p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {t('groupMoneyWarranty')}
              </summary>
              <div className="mt-3 flex flex-col gap-4">

                {/* Condition */}
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">{t('condition')}</legend>
                  <div
                    className="flex flex-wrap gap-3 text-sm"
                    role="radiogroup"
                    aria-label={t('condition')}
                  >
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

                {/* Warranty (only when condition === 'new') */}
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
                          min={
                            !isEdit
                              ? (() => {
                                  const d = new Date();
                                  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                                })()
                              : undefined
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
                          <p className="text-xs text-destructive">
                            {t(errors.warrantyStart)}
                          </p>
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
                          <p className="text-xs text-destructive">
                            {t(errors.warrantyEnd)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </fieldset>
                ) : null}

                {/* Purchase date + price */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                          e.target.value === ''
                            ? null
                            : Number.parseFloat(e.target.value)
                        )
                      }
                      disabled={submitting}
                    />
                  </div>
                </div>
              </div>
            </details>
          ) : null}

          {/* ---- Group 5: Notes ---- */}
          {form.categoryId ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="text-sm font-semibold">{t('groupNotes')}</legend>
              <Label htmlFor="asset-notes">{t('notes')}</Label>
              <textarea
                id="asset-notes"
                name="notes"
                defaultValue={assetRecord?.notes ?? ''}
                onBlur={(e) => setField('notes', e.target.value)}
                disabled={submitting}
                rows={3}
                key={lastSavedTick}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </fieldset>
          ) : null}

          {/* Submit error */}
          {submitError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <button
            type="submit"
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
          />
        </form>

        {/* Inline subtype creator */}
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

      {/* Preview dialog — create mode only */}
      {!isEdit ? (
        <AssetCreatePreviewDialog
          open={previewOpen}
          preview={{
            composedTitle:
              selectedCategory
                ? `${localize(selectedCategory.name, lng)} — ${form.serialNumber ?? ''}`
                : '—',
            inventoryCode: assignsInventoryCode ? inventoryPreview : null,
            subtypeName:
              selectedSubtype
                ? typeof selectedSubtype.name === 'object'
                  ? localize(selectedSubtype.name, lng)
                  : selectedSubtype.name
                : null,
            brandName: form.brandId ?? null,
            modelName: form.modelId ?? null,
            holderSummary: form.assignedTo?.kind ?? '—',
            branchName: form.branchId ?? '—',
            conditionLabel:
              form.condition === 'used' ? t('conditionUsed') : t('conditionNew'),
            warrantyWindow:
              form.warrantyStart && form.warrantyEnd
                ? `${form.warrantyStart} → ${form.warrantyEnd}`
                : '—',
            purchasePriceFormatted:
              form.purchasePrice != null ? String(form.purchasePrice) : '—',
            licenseSummary: null,
          }}
          onBack={() => setPreviewOpen(false)}
          onConfirm={async () => {
            const ok = await handleSubmit();
            if (ok) setPreviewOpen(false);
          }}
          onOpenChange={setPreviewOpen}
        />
      ) : null}
    </>
  );
}
