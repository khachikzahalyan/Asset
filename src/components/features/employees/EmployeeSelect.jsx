import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useEmployees } from '@/hooks/useEmployees.js';
import { formatEmployeeName } from '@/domain/employees.js';
import { cn } from '@/lib/utils.js';

/**
 * Reusable select that lists active employees, optionally scoped to a branch.
 *
 * Used by the asset-assignment form once it lands. Shipped now as part of the
 * Employees slice so Wave 3 doesn't have to backfill it.
 *
 * Inactive (terminated) employees are hidden — Wave 3 will pick a former owner
 * from the audit log, not from this select.
 *
 * Mirrors `BranchSelect`: the data subscription is delegated to the hook, the
 * widget itself is presentational, and the option label uses the domain helper
 * `formatEmployeeName(employee)` so display stays consistent across the app.
 *
 * @param {Object} props
 * @param {string | null | undefined} props.value
 * @param {(next: string | null) => void} props.onChange
 * @param {string} [props.id]
 * @param {string} [props.name]
 * @param {string} [props.className]
 * @param {string | null} [props.branchId]   When set, only employees whose
 *                                            `branchId` matches are shown.
 * @param {boolean} [props.includeNone]      Show a "—" / no-selection option.
 * @param {boolean} [props.disabled]
 */
export default function EmployeeSelect({
  value,
  onChange,
  id,
  name,
  className,
  branchId,
  includeNone = true,
  disabled,
}) {
  const { t, i18n } = useTranslation('employees');
  const { data, loading } = useEmployees();

  const lng = i18n.resolvedLanguage ?? 'ru';

  const options = useMemo(() => {
    const active = data.filter((e) => e.isActive);
    const scoped = branchId ? active.filter((e) => e.branchId === branchId) : active;
    // Sort by display name (Russian collation by default; locale-aware fallback).
    const collator = new Intl.Collator(lng, { sensitivity: 'base' });
    return [...scoped].sort((a, b) =>
      collator.compare(formatEmployeeName(a, lng), formatEmployeeName(b, lng))
    );
  }, [data, branchId, lng]);

  return (
    <select
      id={id}
      name={name}
      value={value ?? ''}
      disabled={disabled || loading}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
    >
      {includeNone ? <option value="">{t('none')}</option> : null}
      {options.map((e) => (
        <option key={e.employeeId} value={e.employeeId}>
          {formatEmployeeName(e, lng)}
        </option>
      ))}
    </select>
  );
}
