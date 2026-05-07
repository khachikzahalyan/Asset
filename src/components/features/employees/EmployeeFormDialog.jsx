import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog } from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';
import BranchSelect from '@/components/features/branches/BranchSelect.jsx';

import {
  emptyEmployeeInput,
  sanitizeEmployeeInput,
  validateEmployeeInput,
  EmployeeEmailTakenError,
} from '@/domain/employees.js';
import { useBranches } from '@/hooks/useBranches.js';

const HEAD_OFFICE_NAME_PATTERN = /(главн|head|hq|կենտր|գլխ)/i;

function isHeadOfficeName(name) {
  if (!name) return false;
  return ['ru', 'en', 'hy'].some((lng) => {
    const v = name[lng];
    return typeof v === 'string' && HEAD_OFFICE_NAME_PATTERN.test(v);
  });
}

/**
 * Modal form for creating or editing an employee.
 *
 * Reused from both `/employees` (full-list page) and the dashboard
 * "Quick Actions" tile. When `mode="quick"` is passed, the dialog rendering
 * is identical, but the calling page's success banner adds a wired-but-disabled
 * "Issue asset" CTA — this dialog itself does not render that CTA.
 *
 * Wave-1 form (post user-driven simplification 2026-05-07):
 *   - First name, Last name (required, Tier 3).
 *   - Email (required, ASCII, Tier 4).
 *   - Phone (optional, Tier 3).
 *   - Department (optional free text, Tier 3 — replaces Wave-1 "Position";
 *     `AMS_Plan_v3.md` §14 lists "отдел" not "должность").
 *
 * Wave 1.5 (2026-05-07, user decision 3A):
 *   - Branch select restored as REQUIRED. Aligns with §14 of the plan.
 *
 * Removed in this revision:
 *   - Middle name (patronymic) — user request.
 *   - Hire date — user request.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('@/domain/employees.js').Employee | null} [props.employee]
 *   When present, the dialog opens in edit mode.
 * @param {(input: import('@/domain/employees.js').EmployeeInput) => Promise<void>} props.onSubmit
 *   Caller's persistence handler — usually wraps the repository's create/update
 *   with the actor context. The dialog does not import the repository.
 */
export default function EmployeeFormDialog({ open, onClose, employee, onSubmit }) {
  const { t } = useTranslation(['employees', 'common']);
  const { data: branches } = useBranches();

  const initial = useMemo(() => {
    if (!employee) return emptyEmployeeInput();
    return {
      firstName: employee.firstName ?? '',
      lastName: employee.lastName ?? '',
      email: employee.email ?? '',
      phone: employee.phone ?? null,
      branchId: employee.branchId ?? null,
      departmentId: employee.departmentId ?? null,
      department: employee.department ?? null,
      isActive: employee.isActive ?? true,
    };
  }, [employee]);

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

  // Auto-select the head-office branch when the dialog opens with no
  // branchId yet. Covers two cases: (a) creation — empty form starts
  // pre-filled instead of with the placeholder "—"; (b) editing a legacy
  // pre-Wave-1.5 employee whose branchId is null. Edit mode with an
  // existing branchId is left untouched.
  //
  // Selection priority:
  //   1. The branch explicitly flagged as head office (`isPrimary === true`).
  //   2. Name match in any locale: "главн", "head", "hq", "կենտր", "գլխ".
  //      Lets the autoselect work for legacy data where no branch has been
  //      flagged yet — the existing "Главный Офис" branch is picked by name.
  //   3. Fallback: the first active branch in the catalog.
  useEffect(() => {
    if (!open) return;
    if (form.branchId) return;
    const active = branches.filter((b) => b.isActive);
    const headOffice = active.find((b) => b.isPrimary);
    const byName = headOffice
      ? null
      : active.find((b) => isHeadOfficeName(b.name));
    const pick = headOffice ?? byName ?? active[0];
    if (pick) {
      setForm((f) => ({ ...f, branchId: pick.branchId }));
    }
  }, [open, branches, form.branchId]);

  const isEdit = Boolean(employee);

  function setField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    if (e?.preventDefault) e.preventDefault();
    const sanitized = sanitizeEmployeeInput(form);
    const fieldErrors = validateEmployeeInput(sanitized);
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
      if (err instanceof EmployeeEmailTakenError || err?.code === 'employee/email-taken') {
        setErrors({ email: 'errorEmailTaken' });
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
      title={isEdit ? t('editEmployee') : t('addEmployee')}
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="employee-lastName">{t('lastName')}</Label>
            <Input
              id="employee-lastName"
              name="lastName"
              value={form.lastName}
              onChange={(e) => setField('lastName', e.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(errors.lastName)}
            />
            {errors.lastName ? (
              <p className="text-xs text-destructive">{t(errors.lastName)}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="employee-firstName">{t('firstName')}</Label>
            <Input
              id="employee-firstName"
              name="firstName"
              value={form.firstName}
              onChange={(e) => setField('firstName', e.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(errors.firstName)}
            />
            {errors.firstName ? (
              <p className="text-xs text-destructive">{t(errors.firstName)}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="employee-email">{t('email')}</Label>
            <Input
              id="employee-email"
              name="email"
              type="email"
              autoComplete="off"
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(errors.email)}
            />
            {errors.email ? (
              <p className="text-xs text-destructive">{t(errors.email)}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="employee-phone">{t('phone')}</Label>
            <Input
              id="employee-phone"
              name="phone"
              type="tel"
              value={form.phone ?? ''}
              onChange={(e) => setField('phone', e.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(errors.phone)}
            />
            {errors.phone ? (
              <p className="text-xs text-destructive">{t(errors.phone)}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="employee-branch">{t('branch')}</Label>
            <BranchSelect
              id="employee-branch"
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

          <div className="space-y-1.5">
            <Label htmlFor="employee-department">{t('department')}</Label>
            <Input
              id="employee-department"
              name="department"
              value={form.department ?? ''}
              onChange={(e) => setField('department', e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        {submitError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        {/* Hidden submit button so Enter inside any field saves. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
