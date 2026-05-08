import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog } from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';
import BranchSelect from '@/components/features/branches/BranchSelect.jsx';
import EmployeeSelect from '@/components/features/employees/EmployeeSelect.jsx';
import DepartmentSelect from '@/components/features/assets/DepartmentSelect.jsx';
import AssetSelect from '@/components/features/assets/AssetSelect.jsx';
import { useAssetSubtypes } from '@/hooks/useAssetSubtypes.js';

import { ASSIGNMENT_KINDS } from '@/domain/assets.js';
import {
  emptyAssignmentEventInput,
  sanitizeAssignmentEventInput,
  validateAssignmentEventInput,
  deriveEventType,
  AssignmentConflictError,
  MAX_NOTES_LENGTH,
} from '@/domain/assignmentEvents.js';

/**
 * Modal that records a single assignment event (issue / return / transfer).
 *
 * The `mode` prop seeds the picker:
 *   - `'issue'`     : asset is in warehouse; user picks a non-warehouse target.
 *   - `'return'`    : asset is with a holder; target is forced to warehouse;
 *                     user picks the destination warehouse (any active branch
 *                     of type warehouse — modeled as a regular branch in the
 *                     Wave-1 schema, hence reuses BranchSelect).
 *   - `'transfer'`  : asset is with a holder; user picks any non-warehouse
 *                     target; the current holder is disabled in the radio.
 *
 * In all modes the radio for the *current* holder is disabled — you can't
 * "move" an asset to where it already is.
 *
 * Submit calls `firestoreAssignmentEventRepository.create`. On
 * `AssignmentConflictError` the dialog surfaces a user-readable banner
 * directing the admin to refresh.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('@/domain/assets.js').Asset} props.asset
 * @param {'issue' | 'return' | 'transfer'} props.mode
 * @param {(input: import('@/domain/assignmentEvents.js').AssignmentEventInput, actor: { uid: string, role: string }) => Promise<string>} props.onSubmit
 * @param {{ uid: string, role: string }} props.actor
 */
export default function AssignDialog({ open, onClose, asset, mode, onSubmit, actor }) {
  const { t } = useTranslation(['assets', 'common']);
  const isReturn = mode === 'return';

  // Compose the initial form state from the asset's *live* assignedTo so
  // the optimistic-concurrency check we do server-side has the right
  // "expected" snapshot.
  const initial = useMemo(() => {
    const seed = emptyAssignmentEventInput(asset);
    if (isReturn) {
      // Return forces the target to warehouse with no id picked yet —
      // the user must pick a destination warehouse via BranchSelect.
      seed.toAssignment = { kind: ASSIGNMENT_KINDS.WAREHOUSE, id: null };
    } else {
      // Default kind for issue / transfer is "employee", except for licenses,
      // where the most natural target is another asset (device).
      const isLicense = asset?.categoryId === 'license';
      seed.toAssignment = {
        kind: isLicense ? ASSIGNMENT_KINDS.ASSET : ASSIGNMENT_KINDS.EMPLOYEE,
        id: null,
      };
    }
    return seed;
  }, [asset, isReturn]);

  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [conflictMessage, setConflictMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [destBranchId, setDestBranchId] = useState(null);

  // Reset form whenever the dialog re-opens (or mode/asset changes).
  useEffect(() => {
    if (open) {
      setForm(initial);
      setErrors({});
      setSubmitError(null);
      setConflictMessage(null);
      setDestBranchId(null);
    }
  }, [open, initial]);

  const currentKind = asset?.assignedTo?.kind ?? ASSIGNMENT_KINDS.WAREHOUSE;

  // Look up the source asset's subtype to drive license-mode target rules.
  const { data: subtypesForCategory } = useAssetSubtypes({
    categoryId: asset?.categoryId ?? null,
  });
  const sourceSubtype = useMemo(() => {
    if (!asset?.subtypeId) return null;
    return subtypesForCategory.find((s) => s.subtypeId === asset.subtypeId) ?? null;
  }, [subtypesForCategory, asset?.subtypeId]);
  const isLicenseSource = asset?.categoryId === 'license';
  const isDeviceOnlyLicense =
    isLicenseSource && sourceSubtype?.attachableTo === 'device-only';

  // The set of admissible target kinds depends on mode + the source asset's
  // category/subtype. For licenses we expose `asset` (and conditionally
  // `employee`) instead of branch/department; for everything else we keep
  // the historical employee/branch/department triple.
  const targetKinds = useMemo(() => {
    if (isReturn) {
      return [{ kind: ASSIGNMENT_KINDS.WAREHOUSE, label: t('holderWarehouse') }];
    }
    if (isLicenseSource) {
      const kinds = [
        {
          kind: ASSIGNMENT_KINDS.EMPLOYEE,
          label: t('holderEmployee'),
          disabled: isDeviceOnlyLicense,
        },
        { kind: ASSIGNMENT_KINDS.ASSET, label: t('holderAsset') },
      ];
      return kinds;
    }
    // Device, furniture, and any other category: existing behaviour.
    return [
      { kind: ASSIGNMENT_KINDS.EMPLOYEE, label: t('holderEmployee') },
      { kind: ASSIGNMENT_KINDS.BRANCH, label: t('holderBranch') },
      { kind: ASSIGNMENT_KINDS.DEPARTMENT, label: t('holderDepartment') },
    ];
  }, [isReturn, isLicenseSource, isDeviceOnlyLicense, t]);

  function setKind(nextKind) {
    setForm((f) => ({
      ...f,
      toAssignment: {
        kind: nextKind,
        id: nextKind === ASSIGNMENT_KINDS.WAREHOUSE ? null : null,
      },
    }));
  }

  function setTargetId(nextId) {
    setForm((f) => ({
      ...f,
      toAssignment: { ...f.toAssignment, id: nextId },
    }));
  }

  // Note: For a "return", the target is the warehouse — the picker is a
  // BranchSelect, but the toAssignment kind stays 'warehouse' with id:null
  // (the asset doc tracks its location via the asset's `branchId`, not via
  // the event). The destination branch is recorded in the event notes
  // and (Wave-2) will become a real `branchId` field on the asset patch.
  // For Wave-1 we keep the toAssignment shape pure; destination branch is
  // optional metadata that gets shipped through the event `notes` payload.

  const previewEventType = useMemo(() => {
    return deriveEventType(form.fromAssignment, form.toAssignment);
  }, [form.fromAssignment, form.toAssignment]);

  async function handleSubmit(e) {
    if (e?.preventDefault) e.preventDefault();
    // For return mode, we accept that the destination warehouse is
    // tracked separately. The to.id stays null (warehouse target).
    let payload = sanitizeAssignmentEventInput(form);

    // For return, append the destination branch into notes so audit
    // history captures it even though Wave-1 doesn't auto-set asset.branchId.
    if (isReturn && destBranchId) {
      const annotation = `→ branch:${destBranchId}`;
      payload = {
        ...payload,
        notes: payload.notes ? `${payload.notes}\n${annotation}` : annotation,
      };
    }

    const fieldErrors = validateAssignmentEventInput(payload);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    setSubmitError(null);
    setConflictMessage(null);
    try {
      await onSubmit(payload, actor);
      onClose();
    } catch (err) {
      if (err instanceof AssignmentConflictError || err?.code === 'assignment/conflict') {
        setConflictMessage(t('errorAssignmentConflict'));
      } else {
        setSubmitError(err?.message ?? String(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const dialogTitle = isReturn
    ? t('returnDialogTitle')
    : mode === 'transfer'
      ? t('transferDialogTitle')
      : t('assignDialogTitle');

  return (
    <Dialog
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={dialogTitle}
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
        {/* Куда */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('holder')}</legend>
          <div className="flex flex-wrap gap-3 text-sm" role="radiogroup" aria-label={t('holder')}>
            {targetKinds.map((opt) => {
              // Disable the option that matches the current holder kind
              // (and id) — you can't "move" to where you already are.
              const sameKind = currentKind === opt.kind;
              const isWarehouseTarget = opt.kind === ASSIGNMENT_KINDS.WAREHOUSE;
              const disabled =
                submitting ||
                opt.disabled === true ||
                (sameKind && (isWarehouseTarget || asset?.assignedTo?.id === form.toAssignment?.id));
              return (
                <label key={opt.kind} className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="toAssignment.kind"
                    value={opt.kind}
                    checked={form.toAssignment?.kind === opt.kind}
                    onChange={() => setKind(opt.kind)}
                    disabled={disabled}
                  />
                  <span>{opt.label}</span>
                </label>
              );
            })}
          </div>

          {isDeviceOnlyLicense ? (
            <p className="text-xs text-muted-foreground">
              {t('licenseDeviceOnlyHint')}
            </p>
          ) : null}

          {/* Holder selector per kind. */}
          {form.toAssignment?.kind === ASSIGNMENT_KINDS.EMPLOYEE ? (
            <div className="space-y-1.5">
              <Label htmlFor="assign-employee">{t('holderEmployee')}</Label>
              <EmployeeSelect
                id="assign-employee"
                name="toAssignment.id"
                value={form.toAssignment?.id ?? null}
                onChange={(next) => setTargetId(next)}
                disabled={submitting}
                includeNone={false}
              />
            </div>
          ) : null}

          {form.toAssignment?.kind === ASSIGNMENT_KINDS.BRANCH ? (
            <div className="space-y-1.5">
              <Label htmlFor="assign-branch-target">{t('holderBranch')}</Label>
              <BranchSelect
                id="assign-branch-target"
                name="toAssignment.id"
                value={form.toAssignment?.id ?? null}
                onChange={(next) => setTargetId(next)}
                disabled={submitting}
                includeNone={false}
              />
            </div>
          ) : null}

          {form.toAssignment?.kind === ASSIGNMENT_KINDS.DEPARTMENT ? (
            <div className="space-y-1.5">
              <Label htmlFor="assign-department">{t('holderDepartment')}</Label>
              <DepartmentSelect
                id="assign-department"
                name="toAssignment.id"
                value={form.toAssignment?.id ?? null}
                onChange={(next) => setTargetId(next)}
                disabled={submitting}
              />
            </div>
          ) : null}

          {form.toAssignment?.kind === ASSIGNMENT_KINDS.ASSET ? (
            <div className="space-y-1.5">
              <Label htmlFor="assign-asset-target">{t('holderAsset')}</Label>
              <AssetSelect
                id="assign-asset-target"
                name="toAssignment.id"
                value={form.toAssignment?.id ?? ''}
                onChange={(next) => setTargetId(next || null)}
                disabled={submitting}
                excludeAssetId={asset?.assetId}
                restrictToCategoryIds={['device']}
              />
            </div>
          ) : null}

          {form.toAssignment?.kind === ASSIGNMENT_KINDS.WAREHOUSE ? (
            <div className="space-y-1.5">
              <Label htmlFor="assign-dest-branch">{t('returnDestinationBranch')}</Label>
              <BranchSelect
                id="assign-dest-branch"
                name="destBranchId"
                value={destBranchId}
                onChange={(next) => setDestBranchId(next)}
                disabled={submitting}
                includeNone={false}
              />
              <p className="text-xs text-muted-foreground">
                {t('returnDestinationHint')}
              </p>
            </div>
          ) : null}

          {errors.toAssignment ? (
            <p className="text-xs text-destructive">{t(errors.toAssignment)}</p>
          ) : null}
        </fieldset>

        {/* Date */}
        <div className="space-y-1.5">
          <Label htmlFor="assign-occurred-at">{t('occurredAt')}</Label>
          <Input
            id="assign-occurred-at"
            name="occurredAt"
            type="datetime-local"
            value={
              form.occurredAt instanceof Date
                ? toLocalInputValue(form.occurredAt)
                : ''
            }
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                occurredAt: e.target.value ? new Date(e.target.value) : null,
              }))
            }
            disabled={submitting}
            aria-invalid={Boolean(errors.occurredAt)}
          />
          {errors.occurredAt ? (
            <p className="text-xs text-destructive">{t(errors.occurredAt)}</p>
          ) : null}
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label htmlFor="assign-notes">{t('notes')}</Label>
          <textarea
            id="assign-notes"
            name="notes"
            value={form.notes ?? ''}
            onChange={(e) =>
              setForm((f) => ({ ...f, notes: e.target.value }))
            }
            disabled={submitting}
            rows={3}
            maxLength={MAX_NOTES_LENGTH}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            aria-invalid={Boolean(errors.notes)}
          />
          {errors.notes ? (
            <p className="text-xs text-destructive">{t(errors.notes)}</p>
          ) : null}
        </div>

        {previewEventType ? (
          <p className="text-xs text-muted-foreground">
            {t('eventTypePreview', { type: t(`event_${previewEventType}`) })}
          </p>
        ) : null}

        {conflictMessage ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{conflictMessage}</AlertDescription>
          </Alert>
        ) : null}

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

/**
 * Format a Date as the "yyyy-MM-ddTHH:mm" string the
 * <input type="datetime-local"> element expects, in *local* time. We
 * intentionally avoid `toISOString()` here because that converts to UTC
 * and shifts the visible value by the user's offset.
 *
 * @param {Date} d
 * @returns {string}
 */
function toLocalInputValue(d) {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yy}-${mm}-${dd}T${hh}:${mi}`;
}
