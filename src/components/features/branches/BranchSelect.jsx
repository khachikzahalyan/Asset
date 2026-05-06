import { useTranslation } from 'react-i18next';

import { useBranches } from '@/hooks/useBranches.js';
import { localize } from '@/lib/localize.js';
import { cn } from '@/lib/utils.js';

/**
 * Reusable select that lists active branches. Used by the asset and
 * employee forms once they exist.
 *
 * Inactive branches are hidden — pick a branch from history via the audit log.
 *
 * @param {Object} props
 * @param {string | null | undefined} props.value
 * @param {(next: string | null) => void} props.onChange
 * @param {string} [props.id]
 * @param {string} [props.name]
 * @param {string} [props.className]
 * @param {boolean} [props.includeNone]   Show a "—" / no-selection option.
 * @param {boolean} [props.disabled]
 */
export default function BranchSelect({
  value,
  onChange,
  id,
  name,
  className,
  includeNone = true,
  disabled,
}) {
  const { t, i18n } = useTranslation('branches');
  const { data, loading } = useBranches();

  const lng = i18n.resolvedLanguage ?? 'ru';
  const active = data.filter((b) => b.isActive);

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
      {active.map((b) => (
        <option key={b.branchId} value={b.branchId}>
          {localize(b.name, lng)}
        </option>
      ))}
    </select>
  );
}
