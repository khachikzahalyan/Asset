import { useTranslation } from 'react-i18next';

import { localize } from '@/lib/localize.js';
import { cn } from '@/lib/utils.js';

/**
 * Inline status pill rendered with the status's hex color as the background.
 * Falls back to muted gray when the status is unknown / loading.
 *
 * @param {Object} props
 * @param {{ statusId: string, name?: { ru?: string, en?: string, hy?: string }, color?: string } | null | undefined} props.status
 * @param {string} [props.fallback]   Text to render when status is null.
 * @param {string} [props.className]
 */
export default function StatusBadge({ status, fallback, className }) {
  const { i18n } = useTranslation();
  const lng = i18n.resolvedLanguage ?? 'ru';

  if (!status) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground',
          className
        )}
      >
        {fallback ?? '—'}
      </span>
    );
  }

  const label = localize(status.name, lng) || status.statusId;
  const color = isHexColor(status.color) ? status.color : '#64748b';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium text-white',
        className
      )}
      style={{ backgroundColor: color }}
      title={label}
    >
      {label}
    </span>
  );
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}
