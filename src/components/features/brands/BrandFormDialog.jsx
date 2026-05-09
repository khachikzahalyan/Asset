import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog } from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';

import {
  emptyBrandInput,
  validateBrandInput,
  sanitizeBrandInput,
} from '@/domain/brands.js';

/**
 * Modal for creating or editing a brand.
 *
 * Controlled inputs throughout (no uncontrolled defaultValue) so tests
 * can drive state via fireEvent.change without needing a blur first.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('@/domain/brands.js').Brand | null} [props.brand]
 * @param {(input: import('@/domain/brands.js').BrandInput) => Promise<void>} props.onSubmit
 */
export default function BrandFormDialog({ open, onClose, brand, onSubmit }) {
  const { t } = useTranslation('brands');
  const isEdit = Boolean(brand);

  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      if (brand) {
        setName(brand.name ?? '');
        setIsActive(brand.isActive !== false);
      } else {
        const empty = emptyBrandInput();
        setName(empty.name);
        setIsActive(empty.isActive);
      }
      setErrors({});
      setSubmitError(null);
    }
  }, [open, brand]);

  async function handleSubmit(e) {
    e.preventDefault();
    const input = sanitizeBrandInput({ name, isActive });
    const errs = validateBrandInput(input);
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

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? t('editBrand') : t('addBrand')}
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="brand-name">{t('fieldName')}</Label>
            <Input
              id="brand-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('fieldNamePlaceholder')}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'brand-name-error' : undefined}
            />
            {errors.name ? (
              <p
                id="brand-name-error"
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
                id="brand-isActive"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <Label htmlFor="brand-isActive">{t('fieldIsActive')}</Label>
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
