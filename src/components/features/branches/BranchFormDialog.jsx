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
  BRANCH_TYPES,
  emptyBranchInput,
  sanitizeBranchInput,
  validateBranchInput,
} from '@/domain/branches.js';

/**
 * Modal form for creating or editing a branch.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('@/domain/branches.js').Branch | null} [props.branch]
 *   When present, the dialog opens in edit mode.
 * @param {(input: import('@/domain/branches.js').BranchInput) => Promise<void>} props.onSubmit
 */
export default function BranchFormDialog({ open, onClose, branch, onSubmit }) {
  const { t } = useTranslation(['branches', 'common']);

  const initial = useMemo(() => {
    if (!branch) return emptyBranchInput();
    return {
      name: { ru: branch.name?.ru ?? '', en: branch.name?.en ?? '', hy: branch.name?.hy ?? '' },
      type: branch.type ?? BRANCH_TYPES.BRANCH,
      address: branch.address ?? '',
      responsibleEmployeeId: branch.responsibleEmployeeId ?? null,
      isActive: branch.isActive ?? true,
    };
  }, [branch]);

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

  const isEdit = Boolean(branch);

  async function handleSubmit(e) {
    e.preventDefault();
    const sanitized = sanitizeBranchInput(form);
    const fieldErrors = validateBranchInput(sanitized);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(sanitized);
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
      onClose={submitting ? () => {} : onClose}
      title={isEdit ? t('editBranch') : t('addBranch')}
      description={isEdit ? null : t('subtitle')}
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
        <div className="space-y-1.5">
          <MultiLangInput
            name="name"
            label={t('formNameLabel')}
            value={form.name}
            onChange={(next) => setForm((f) => ({ ...f, name: next }))}
            disabled={submitting}
          />
          {errors.name ? (
            <p className="text-xs text-destructive">{t(errors.name)}</p>
          ) : null}
        </div>

        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">{t('formTypeLabel')}</legend>
          <div className="flex flex-wrap gap-3">
            {[BRANCH_TYPES.BRANCH, BRANCH_TYPES.WAREHOUSE].map((type) => (
              <label
                key={type}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent"
              >
                <input
                  type="radio"
                  name="type"
                  value={type}
                  checked={form.type === type}
                  onChange={() => setForm((f) => ({ ...f, type }))}
                  disabled={submitting}
                />
                <span>{type === BRANCH_TYPES.BRANCH ? t('branchType') : t('warehouseType')}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="branch-address">{t('formAddressLabel')}</Label>
          <Input
            id="branch-address"
            name="address"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            placeholder={t('addressPlaceholder')}
            disabled={submitting}
          />
        </div>

        {submitError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        {/* Hidden submit input lets Enter inside any field trigger save. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
