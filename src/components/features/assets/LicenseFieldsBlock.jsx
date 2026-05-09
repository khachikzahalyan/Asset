// src/components/features/assets/LicenseFieldsBlock.jsx
import { useTranslation } from 'react-i18next';
import { LicenseTypeRadio } from './LicenseTypeRadio.jsx';
import { LicenseKeyField } from './LicenseKeyField.jsx';

function isExpiresBeforeSubscribed(value) {
  if (!value.subscribedAt || !value.expiresAt) return false;
  return new Date(value.expiresAt) <= new Date(value.subscribedAt);
}

/**
 * @param {Object} props
 * @param {{licenseType: ('personal'|'business'|'enterprise'|null), subscribedAt: string|null, expiresAt: string|null}} props.value
 * @param {(patch: Object) => void} props.onChange
 * @param {(value: string) => void} props.onLicenseKeyChange
 * @param {string} [props.licenseKeyDefault]
 * @param {number} [props.resetTick] - Incremented by the parent after "Save & add another"
 *   to remount the LicenseKeyField and clear the entered key.
 */
export function LicenseFieldsBlock({
  value,
  onChange,
  onLicenseKeyChange,
  licenseKeyDefault = '',
  resetTick = 0,
}) {
  const { t } = useTranslation('licenses');
  const dateError = isExpiresBeforeSubscribed(value);

  return (
    <fieldset className="flex flex-col gap-4 rounded-md border p-4">
      <legend className="px-1 text-sm font-semibold">{t('licenseType')}</legend>
      <LicenseTypeRadio
        value={value.licenseType}
        onChange={(licenseType) => onChange({ licenseType })}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('subscribedAt')}</span>
          <input
            type="date"
            value={value.subscribedAt ?? ''}
            onChange={(e) => onChange({ subscribedAt: e.target.value || null })}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('expiresAt')}</span>
          <input
            type="date"
            value={value.expiresAt ?? ''}
            onChange={(e) => onChange({ expiresAt: e.target.value || null })}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>
      {dateError ? (
        <p className="text-sm text-destructive">{t('errorExpiresBeforeSubscribed')}</p>
      ) : null}
      <LicenseKeyField defaultValue={licenseKeyDefault} onValueChange={onLicenseKeyChange} resetTick={resetTick} />
      <p className="text-xs text-muted-foreground">{t('licenseKeyHelpHint')}</p>
    </fieldset>
  );
}
