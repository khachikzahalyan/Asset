import { SUPPORTED_LOCALES } from '@/i18n/namespaces.js';

/**
 * MultiLangInput — Tier-2 input component.
 * Renders one input per supported locale and emits a `{ ru, en, hy }` object.
 *
 * Full styling and validation land in the internationalization feature step.
 * This is the API stub so other features can import and use it.
 *
 * @param {Object} props
 * @param {string} props.name
 * @param {{ ru?: string, en?: string, hy?: string }} props.value
 * @param {(next: { ru: string, en: string, hy: string }) => void} props.onChange
 * @param {string} [props.label]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.invalid] When true, sets `aria-invalid` on every
 *   inner locale input so assistive technology can identify the error state.
 *   Callers typically pass `Boolean(errors.<field>)`.
 */
export default function MultiLangInput({
  name,
  value = {},
  onChange,
  label,
  disabled,
  invalid,
}) {
  const normalized = SUPPORTED_LOCALES.reduce((acc, l) => ({ ...acc, [l]: value[l] ?? '' }), {});

  function handleChange(locale, next) {
    onChange?.({ ...normalized, [locale]: next });
  }

  return (
    <fieldset className="space-y-2">
      {label && <legend className="text-sm font-medium">{label}</legend>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {SUPPORTED_LOCALES.map((locale) => (
          <label key={locale} className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground uppercase">{locale}</span>
            <input
              type="text"
              name={`${name}.${locale}`}
              value={normalized[locale]}
              onChange={(e) => handleChange(locale, e.target.value)}
              disabled={disabled}
              aria-invalid={invalid ? true : undefined}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
