// src/components/features/assets/LicenseTypeRadio.jsx
import { useTranslation } from 'react-i18next';

const LICENSE_TYPES = ['personal', 'business', 'enterprise'];
const LABEL_KEY = {
  personal: 'licenseTypePersonal',
  business: 'licenseTypeBusiness',
  enterprise: 'licenseTypeEnterprise',
};

/**
 * @param {Object} props
 * @param {'personal'|'business'|'enterprise'|null} props.value
 * @param {(value: 'personal'|'business'|'enterprise') => void} props.onChange
 * @param {string} [props.name]
 */
export function LicenseTypeRadio({ value, onChange, name = 'licenseType' }) {
  const { t } = useTranslation('licenses');
  return (
    <div role="radiogroup" className="flex flex-col gap-2 sm:flex-row sm:gap-4">
      {LICENSE_TYPES.map((type) => (
        <label key={type} className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={name}
            value={type}
            checked={value === type}
            onChange={() => onChange(type)}
            aria-label={t(LABEL_KEY[type])}
          />
          <span>{t(LABEL_KEY[type])}</span>
        </label>
      ))}
    </div>
  );
}
