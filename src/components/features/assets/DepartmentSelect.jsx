import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils.js';

/**
 * Department select — stub for Wave-1 Step 2.
 *
 * The `/departments` collection is NOT modeled yet. This component
 * renders a disabled select with a single placeholder option so the
 * "Куда → ОТДЕЛ" radio in the asset form has somewhere to go even though
 * the user can't actually pick a department. Form-level validation
 * surfaces a helpful inline message.
 *
 * Replace with a real `useDepartments`-backed select once the
 * departments slice ships.
 *
 * @param {Object} props
 * @param {string | null | undefined} props.value
 * @param {(next: string | null) => void} props.onChange
 * @param {string} [props.id]
 * @param {string} [props.name]
 * @param {string} [props.className]
 * @param {boolean} [props.disabled]
 */
// eslint-disable-next-line no-unused-vars
export default function DepartmentSelect({ value, onChange, id, name, className, disabled }) {
  const { t } = useTranslation('assets');
  return (
    <select
      id={id}
      name={name}
      value=""
      disabled
      onChange={() => {}}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      aria-disabled="true"
      title={t('departmentsComingSoon')}
    >
      <option value="">{t('departmentsComingSoon')}</option>
    </select>
  );
}
