import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { SUPPORTED_LOCALES } from '@/i18n/namespaces.js';

const LABELS = {
  ru: 'Русский',
  en: 'English',
  hy: 'Հայերեն',
};

const SHORT = {
  ru: 'RU',
  en: 'EN',
  hy: 'HY',
};

export default function LanguageSwitcher({ variant = 'pills', className }) {
  const { i18n, t } = useTranslation('common');
  const current = i18n.resolvedLanguage ?? i18n.language ?? 'ru';

  if (variant === 'select') {
    return (
      <label className={cn('inline-flex items-center gap-2 text-sm', className)}>
        <Languages className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">{t('language')}</span>
        <select
          value={current}
          onChange={(e) => i18n.changeLanguage(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {SUPPORTED_LOCALES.map((lng) => (
            <option key={lng} value={lng}>
              {LABELS[lng]}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div
      role="group"
      aria-label={t('language')}
      className={cn(
        'inline-flex items-center rounded-md border border-input bg-background p-0.5 shadow-sm',
        className
      )}
    >
      {SUPPORTED_LOCALES.map((lng) => {
        const active = current === lng;
        return (
          <button
            key={lng}
            type="button"
            onClick={() => i18n.changeLanguage(lng)}
            aria-pressed={active}
            aria-label={LABELS[lng]}
            className={cn(
              'rounded px-2 py-1 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {SHORT[lng]}
          </button>
        );
      })}
    </div>
  );
}
