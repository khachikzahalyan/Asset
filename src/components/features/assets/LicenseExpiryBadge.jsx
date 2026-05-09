// src/components/features/assets/LicenseExpiryBadge.jsx
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge.jsx';
import { useNotificationSettings } from '@/hooks/useNotificationSettings.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  if (typeof value.toDate === 'function') return value.toDate();
  return null;
}

/**
 * @param {Object} props
 * @param {Date|string|number|{toDate: () => Date}|null} props.expiresAt
 */
export function LicenseExpiryBadge({ expiresAt }) {
  const { t } = useTranslation('licenses');
  const { data } = useNotificationSettings();
  const expires = toDate(expiresAt);
  if (!expires) return null;

  const now = new Date();
  const diffDays = Math.round((expires.getTime() - now.getTime()) / ONE_DAY_MS);
  const threshold = data.licenseExpiryWarningDays;

  if (diffDays < 0) {
    return (
      <Badge variant="destructive">
        {t('expiryBadgePast', { days: Math.abs(diffDays) })}
      </Badge>
    );
  }
  if (diffDays <= threshold) {
    return (
      <Badge variant="secondary" className="bg-amber-100 text-amber-900 hover:bg-amber-100">
        {t('expiryBadgeSoon', { days: diffDays })}
      </Badge>
    );
  }
  return null;
}
