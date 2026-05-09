// src/components/features/assets/LicenseKeyField.jsx
import { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { ROLES } from '@/domain/roles.js';

const PRIVILEGED_ROLES = [ROLES.SUPER_ADMIN, ROLES.TECH_ADMIN];

/**
 * Uncontrolled masked input for the license key. Hidden entirely for
 * non-privileged roles. Emits the current value via `onValueChange` on
 * blur. The current value is held in the input element's DOM state so
 * we never round-trip the secret through React's render path beyond
 * the explicit blur handler.
 *
 * When `resetTick` changes the component clears its internal input value
 * and calls `onValueChange('')` so the parent ref clears too. This is
 * consumed by the T35 "Save & add another" sticky-defaults flow.
 *
 * @param {Object} props
 * @param {string} [props.defaultValue]
 * @param {(value: string) => void} props.onValueChange
 * @param {string} [props.id]
 * @param {string} [props.name]
 * @param {number} [props.resetTick]
 */
export function LicenseKeyField({
  defaultValue = '',
  onValueChange,
  id = 'licenseKey',
  name = 'licenseKey',
  resetTick = 0,
}) {
  const { role } = useAuth();
  const { t } = useTranslation('licenses');
  const inputRef = useRef(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  // When resetTick changes, clear the input value and notify the parent.
  // We skip the initial mount (resetTick === 0) by using a ref to track
  // whether this is the first render.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (inputRef.current) {
      inputRef.current.value = '';
    }
    onValueChange('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetTick]);

  if (!PRIVILEGED_ROLES.includes(role)) {
    return null;
  }

  function handleCopy() {
    const value = inputRef.current?.value ?? '';
    if (!value) return;
    navigator.clipboard?.writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {t('licenseKey')}
      </label>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          id={id}
          name={name}
          type={revealed ? 'text' : 'password'}
          defaultValue={defaultValue}
          onBlur={(e) => onValueChange(e.target.value)}
          aria-label={t('licenseKey')}
          autoComplete="off"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm font-mono"
        />
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          className="rounded-md border px-2 py-1 text-xs"
        >
          {revealed ? t('licenseKeyHide') : t('licenseKeyShow')}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-md border px-2 py-1 text-xs"
        >
          {copied ? t('licenseKeyCopied') : t('licenseKeyCopy')}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{t('licenseKeyAdminOnlyHint')}</p>
    </div>
  );
}
