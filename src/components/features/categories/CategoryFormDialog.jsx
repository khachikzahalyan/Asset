import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog } from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';
import MultiLangInput from '@/components/common/MultiLangInput/MultiLangInput.jsx';

import {
  emptyCategoryInput,
  sanitizeCategoryInput,
  validateCategoryInput,
  CategoryIdConflictError,
} from '@/domain/categories.js';
import { ASSIGNMENT_KIND_LIST } from '@/domain/assets.js';

/**
 * Modal that creates or edits a category.
 *
 * Storage shape: `name` is always a `{ ru, en, hy }` map. The form's
 * `requiresMultilang` toggle controls whether the inputs render as a
 * three-locale group (MultiLangInput) or a single Input. When the toggle
 * is off, the sanitizer mirrors the single typed value into all three
 * locale keys at submit time so downstream `localize(...)` calls remain
 * uniform.
 *
 * Stable doc id strategy: derived from the RU name (or whichever locale
 * is filled in for a single-lang category). Slug is lower-cased ASCII;
 * non-`[a-z0-9]` characters collapse to `_`. Existing-id collisions are
 * surfaced as CategoryIdConflictError. The list page (caller) handles the
 * "append numeric suffix on conflict" retry — the dialog itself stays
 * deterministic so the operator always sees what id is about to commit.
 *
 * Edit mode: doc id is fixed; the input is shown but disabled. The
 * `isActive` checkbox is only rendered in edit mode (a brand-new
 * category is always active).
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('@/domain/categories.js').Category | null} [props.category]
 * @param {(input: import('@/domain/categories.js').CategoryInput, opts: { id?: string }) => Promise<void>} props.onSubmit
 */
export default function CategoryFormDialog({
  open,
  onClose,
  category,
  onSubmit,
}) {
  const { t } = useTranslation(['categories', 'common']);
  const isEdit = Boolean(category);

  const initial = useMemo(() => {
    if (!category) return emptyCategoryInput();
    return {
      name: {
        ru: category.name?.ru ?? '',
        en: category.name?.en ?? '',
        hy: category.name?.hy ?? '',
      },
      inventoryCodePrefix: category.inventoryCodePrefix ?? '',
      requiresMultilang: Boolean(category.requiresMultilang),
      attachableTo: Array.isArray(category.attachableTo)
        ? category.attachableTo
        : [],
      assignsInventoryCode: category.assignsInventoryCode !== false,
      isActive: category.isActive !== false,
    };
  }, [category]);

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

  const derivedId = useMemo(() => {
    if (isEdit) return category.categoryId;
    return deriveCategoryId(form.name);
  }, [isEdit, category, form.name]);

  function setField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function setName(next) {
    setField('name', next);
  }

  function toggleAttachableKind(kind, checked) {
    setForm((prev) => {
      const set = new Set(prev.attachableTo ?? []);
      if (checked) set.add(kind);
      else set.delete(kind);
      const next = ASSIGNMENT_KIND_LIST.filter((k) => set.has(k));
      return { ...prev, attachableTo: next };
    });
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();
    const sanitized = sanitizeCategoryInput(form);
    const fieldErrors = validateCategoryInput(sanitized);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(sanitized, { id: isEdit ? category.categoryId : derivedId });
    } catch (err) {
      if (err instanceof CategoryIdConflictError) {
        setSubmitError(t('categories:errorIdConflict'));
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
      title={
        isEdit
          ? t('categories:dialogEditTitle')
          : t('categories:dialogCreateTitle')
      }
      closeLabel={t('common:cancel')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('categories:cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="gap-2"
          >
            {submitting ? <Spinner size={14} /> : null}
            {t('categories:save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={handleSubmit}
        className="space-y-4"
        data-derived-id={derivedId || ''}
      >
        <div className="flex items-center gap-2">
          <input
            id="category-requires-multilang"
            type="checkbox"
            checked={Boolean(form.requiresMultilang)}
            onChange={(e) => setField('requiresMultilang', e.target.checked)}
            disabled={submitting}
            className="h-4 w-4"
          />
          <Label
            htmlFor="category-requires-multilang"
            className="cursor-pointer"
          >
            {t('categories:fieldRequiresMultilang')}
          </Label>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            id="category-assigns-inventory-code"
            type="checkbox"
            checked={form.assignsInventoryCode !== false}
            onChange={(e) => setField('assignsInventoryCode', e.target.checked)}
            aria-label={t('categories:assignsInventoryCodeLabel')}
            disabled={submitting}
            className="mt-0.5 h-4 w-4"
          />
          <span className="flex flex-col">
            <span>{t('categories:assignsInventoryCodeLabel')}</span>
            <span className="text-xs text-muted-foreground">
              {t('categories:assignsInventoryCodeHint')}
            </span>
          </span>
        </label>

        <div className="space-y-1.5">
          <Label>{t('categories:name')}</Label>
          {form.requiresMultilang ? (
            <MultiLangInput
              name="name"
              value={form.name}
              onChange={setName}
              disabled={submitting}
              invalid={Boolean(errors.name)}
            />
          ) : (
            <Input
              name="name"
              value={form.name?.ru ?? ''}
              onChange={(e) =>
                setName({
                  ru: e.target.value,
                  en: e.target.value,
                  hy: e.target.value,
                })
              }
              disabled={submitting}
              aria-invalid={Boolean(errors.name)}
            />
          )}
          {errors.name ? (
            <p className="text-xs text-destructive">
              {t(`categories:${errors.name}`)}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="category-prefix">
            {t('categories:inventoryCodePrefix')}
          </Label>
          <Input
            id="category-prefix"
            name="inventoryCodePrefix"
            value={form.inventoryCodePrefix ?? ''}
            onChange={(e) => setField('inventoryCodePrefix', e.target.value)}
            disabled={submitting}
            className="font-mono"
            aria-invalid={Boolean(errors.inventoryCodePrefix)}
          />
          {errors.inventoryCodePrefix ? (
            <p className="text-xs text-destructive">
              {t(`categories:${errors.inventoryCodePrefix}`)}
            </p>
          ) : null}
        </div>

        <fieldset className="space-y-2 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">
            {t('categories:attachableToFieldset')}
          </legend>
          <p className="text-xs text-muted-foreground">
            {t('categories:attachableToHelp')}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            {ASSIGNMENT_KIND_LIST.map((kind) => {
              const id = `category-attachable-${kind}`;
              const checked = (form.attachableTo ?? []).includes(kind);
              const labelKey = `assets:assignmentKind${kind.charAt(0).toUpperCase() + kind.slice(1)}`;
              return (
                <div key={kind} className="flex items-center gap-2">
                  <input
                    id={id}
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleAttachableKind(kind, e.target.checked)}
                    disabled={submitting}
                    className="h-4 w-4"
                    aria-invalid={Boolean(errors.attachableTo)}
                  />
                  <Label htmlFor={id} className="cursor-pointer">
                    {t(labelKey)}
                  </Label>
                </div>
              );
            })}
          </div>
          {errors.attachableTo ? (
            <p className="text-xs text-destructive">
              {t(`categories:${errors.attachableTo}`)}
            </p>
          ) : null}
        </fieldset>

        {isEdit ? (
          <div className="flex items-center gap-2">
            <input
              id="category-is-active"
              type="checkbox"
              checked={form.isActive !== false}
              onChange={(e) => setField('isActive', e.target.checked)}
              disabled={submitting}
              className="h-4 w-4"
            />
            <Label
              htmlFor="category-is-active"
              className="cursor-pointer"
            >
              {t('categories:fieldIsActive')}
            </Label>
          </div>
        ) : null}

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
    </Dialog>
  );
}

/**
 * Build a stable doc id from the supplied category name. Strategy:
 * prefer RU, then EN, then HY. Lowercase, collapse non-`[a-z0-9]` runs
 * to `_`, trim leading/trailing underscores. Returns '' if nothing slug-
 * worthy remains. Cyrillic and Armenian characters are dropped (we ask
 * the user to type at least one ASCII-compatible name) — this matches
 * the approach already used by SubtypeFormDialog.
 *
 * Exported via the named export `deriveCategoryId` so the management
 * page can run the same logic when it appends a numeric suffix on
 * collision (`device_2`, `device_3`, ...).
 */
export function deriveCategoryId(name) {
  const candidates = [
    name?.ru,
    name?.en,
    name?.hy,
    typeof name === 'string' ? name : '',
  ];
  for (const c of candidates) {
    const slug = slugify(c);
    if (slug) return slug;
  }
  return '';
}

function slugify(value) {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
