// src/components/features/assets/BrandSelect.jsx
import { useTranslation } from 'react-i18next';
import { useBrands } from '@/hooks/useBrands.js';

/**
 * @param {Object} props
 * @param {string|null} props.value
 * @param {(brandId: string|null) => void} props.onChange
 * @param {string} [props.id]
 * @param {boolean} [props.disabled]
 */
export function BrandSelect({ value, onChange, id, disabled = false }) {
  const { t } = useTranslation('assets');
  const { data, loading } = useBrands();
  const active = data.filter((b) => b.isActive);

  return (
    <select
      id={id}
      role="combobox"
      value={value ?? ''}
      disabled={disabled || loading}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
    >
      <option value="">{t('brandPlaceholder')}</option>
      {active.map((brand) => (
        <option key={brand.brandId} value={brand.brandId}>
          {brand.name}
        </option>
      ))}
    </select>
  );
}
