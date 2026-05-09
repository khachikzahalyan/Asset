import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog } from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';

import {
  emptyModelInput,
  validateModelInput,
  sanitizeModelInput,
} from '@/domain/models.js';

/**
 * Modal for creating or editing a model.
 *
 * In create mode the brand selector is shown as a <select>.
 * In edit mode the brand is fixed (immutable post-create) and shown read-only.
 * Controlled inputs throughout for predictable state in tests.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('@/domain/models.js').Model | null} [props.model]
 * @param {import('@/domain/brands.js').Brand[]} props.brands
 * @param {(input: import('@/domain/models.js').ModelInput) => Promise<void>} props.onSubmit
 */
export default function ModelFormDialog({
  open,
  onClose,
  model,
  brands,
  onSubmit,
}) {
  const { t } = useTranslation('models');
  const isEdit = Boolean(model);

  const [brandId, setBrandId] = useState('');
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      if (model) {
        setBrandId(model.brandId ?? '');
        setName(model.name ?? '');
        setIsActive(model.isActive !== false);
      } else {
        const empty = emptyModelInput();
        setBrandId(empty.brandId);
        setName(empty.name);
        setIsActive(empty.isActive);
      }
      setErrors({});
      setSubmitError(null);
    }
  }, [open, model]);

  async function handleSubmit(e) {
    e.preventDefault();
    const input = sanitizeModelInput({ brandId, name, isActive });
    const errs = validateModelInput(input);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(input);
      onClose();
    } catch (err) {
      setSubmitError(err?.message ?? String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const activeBrands = (brands || []).filter((b) => b.isActive !== false);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? t('editModel') : t('addModel')}
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className="space-y-4 py-2">
          {isEdit ? (
            <div className="space-y-1.5">
              <Label>{t('fieldBrand')}</Label>
              <p className="text-sm text-muted-foreground">
                {(brands || []).find((b) => b.brandId === model.brandId)?.name ??
                  model.brandId}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="model-brand">{t('fieldBrand')}</Label>
              <select
                id="model-brand"
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                aria-invalid={Boolean(errors.brandId)}
                aria-describedby={errors.brandId ? 'model-brand-error' : undefined}
              >
                <option value="">{t('fieldBrandPlaceholder')}</option>
                {activeBrands.map((b) => (
                  <option key={b.brandId} value={b.brandId}>
                    {b.name}
                  </option>
                ))}
              </select>
              {errors.brandId ? (
                <p
                  id="model-brand-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {t('errorBrandRequired')}
                </p>
              ) : null}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="model-name">{t('fieldName')}</Label>
            <Input
              id="model-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('fieldNamePlaceholder')}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'model-name-error' : undefined}
            />
            {errors.name ? (
              <p
                id="model-name-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {t(errors.name)}
              </p>
            ) : null}
          </div>

          {isEdit ? (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="model-isActive"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <Label htmlFor="model-isActive">{t('fieldIsActive')}</Label>
            </div>
          ) : null}

          {submitError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? <Spinner size={16} className="mr-2" /> : null}
            {t('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
