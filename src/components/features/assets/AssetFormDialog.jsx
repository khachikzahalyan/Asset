import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

import {
  emptyAssetInput,
  sanitizeAssetInput,
  validateAssetInput,
  ASSIGNMENT_KINDS,
  AssetInventoryCodeTakenError,
  AssetCounterMissingError,
  AssetCategoryInactiveError,
} from '@/domain/assets.js';
import { DEFAULT_ASSET_STATUS_CODE } from '@/domain/assetStatuses.js';
import { useCategories } from '@/hooks/useCategories.js';
import { useAssetStatuses } from '@/hooks/useAssetStatuses.js';
import { localize } from '@/lib/localize.js';

/**
 * Modal form for creating an asset.
 *
 * Per the user-approved field list (2026-05-07):
 *   1. Категория        — required, drives `name` shape (multi-lang vs plain).
 *   2. Название         — Tier 3, required.
 *   3. Бренд             — Tier 4 ASCII, optional.
 *   4. Модель            — Tier 4 ASCII, optional.
 *   5. S/N               — Tier 4 ASCII, optional.
 *   6. Куда              — radio: СКЛАД (default) / СОТРУДНИК / ФИЛИАЛ / ОТДЕЛ.
 *      • СКЛАД      → BranchSelect required ("which warehouse"); status filtered to isAssignable=false.
 *      • СОТРУДНИК  → EmployeeSelect required; status filtered to isAssignable=true.
 *      • ФИЛИАЛ     → BranchSelect required; status filtered to isAssignable=true.
 *      • ОТДЕЛ      → DepartmentSelect (stub, disabled). Validation surfaces the
 *                      "switch mode" hint.
 *   7. Статус            — required, filtered by Куда rule. Default: 'warehouse'.
 *   8. Дополнительно     — collapsed <details>: notes, purchaseDate, purchasePrice.
 *
 * Submit: sanitizeAssetInput → validateAssetInput → onSubmit. Catches the
 * three repository-side errors (`AssetInventoryCodeTakenError`,
 * `AssetCounterMissingError`, `AssetCategoryInactiveError`) and surfaces
 * them inline.
 *
 * Edit mode (Step 2): supports name / brand / model / serialNumber /
 * branchId / assignedTo / notes / purchase metadata. `inventoryCode`,
 * `categoryId`, `statusId` are immutable here — categoryId is locked at
 * the DB level; statusId has its own dedicated control on the detail page.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('@/domain/assets.js').Asset | null} [props.asset]
 *   When present the dialog opens in edit mode.
 * @param {(input: import('@/domain/assets.js').AssetInput, opts: { category: any | null }) => Promise<void>} props.onSubmit
 */
export default function AssetFormDialog({ open, onClose, asset, onSubmit }) {
  const { t, i18n } = useTranslation(['assets', 'common']);
  const lng = i18n.resolvedLanguage ?? 'ru';
  const { data: categories } = useCategories();
  const { data: statuses } = useAssetStatuses();

  const isEdit = Boolean(asset);

  const initial = useMemo(() => {
    if (!asset) return emptyAssetInput();
    return {
      categoryId: asset.categoryId ?? '',
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
      isActive: asset.isActive ?? true,
    };
  }, [asset]);

  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

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

  function setField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function setKind(nextKind) {
    setForm((f) => {
      const at = { kind: nextKind, id: nextKind === ASSIGNMENT_KINDS.WAREHOUSE ? null : null };
      // Clear branchId when switching to employee or department
      // (branchId is the location for warehouse / branch modes only).
      let branchId = f.branchId;
      if (nextKind === ASSIGNMENT_KINDS.EMPLOYEE || nextKind === ASSIGNMENT_KINDS.DEPARTMENT) {
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

  async function handleSubmit(e) {
    if (e?.preventDefault) e.preventDefault();
    const opts = { category: selectedCategory };
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
      await onSubmit(sanitized, { category: selectedCategory });
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

        {/* 2. Название */}
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

        {/* 3. Бренд / 4. Модель / 5. S/N */}
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

        {/* 6. Куда */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('holder')}</legend>
          <div className="flex flex-wrap gap-3 text-sm" role="radiogroup" aria-label={t('holder')}>
            {[
              { kind: ASSIGNMENT_KINDS.WAREHOUSE, label: t('holderWarehouse') },
              { kind: ASSIGNMENT_KINDS.EMPLOYEE, label: t('holderEmployee') },
              { kind: ASSIGNMENT_KINDS.BRANCH, label: t('holderBranch') },
              { kind: ASSIGNMENT_KINDS.DEPARTMENT, label: t('holderDepartment') },
            ].map((opt) => (
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
        </fieldset>

        {/* 7. Статус */}
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

        {/* 8. Дополнительно (collapsed) */}
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
    </Dialog>
  );
}
