const FALLBACK_ORDER = ['ru', 'en', 'hy'];

export function localize(value, locale) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return '';

  if (locale && value[locale]) return value[locale];

  for (const fb of FALLBACK_ORDER) {
    if (value[fb]) return value[fb];
  }

  for (const v of Object.values(value)) {
    if (v) return v;
  }

  return '';
}
