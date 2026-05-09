// src/components/features/assets/ModelSelect.jsx
import { useTranslation } from 'react-i18next';
import { useModels } from '@/hooks/useModels.js';

/**
 * @param {Object} props
 * @param {string|null} props.brandId
 * @param {string|null} props.value
 * @param {(modelId: string|null) => void} props.onChange
 * @param {string} [props.id]
 */
export function ModelSelect({ brandId, value, onChange, id }) {
  const { t } = useTranslation('assets');
  const { data, loading } = useModels({ brandId });
  const active = data.filter((m) => m.isActive && m.brandId === brandId);
  const disabled = brandId === null || loading;

  return (
    <select
      id={id}
      role="combobox"
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
    >
      <option value="">
        {brandId === null ? t('modelDisabledNoBrand') : t('modelPlaceholder')}
      </option>
      {active.map((model) => (
        <option key={model.modelId} value={model.modelId}>
          {model.name}
        </option>
      ))}
    </select>
  );
}
