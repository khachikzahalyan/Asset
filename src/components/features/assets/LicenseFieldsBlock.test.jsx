// src/components/features/assets/LicenseFieldsBlock.test.jsx
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
// Initialise i18next so t() returns real translated strings that the test
// regexes (e.g. /subscribed at|дата подписки|բաժանորդագրման/i) can match.
import i18n from '@/i18n/index.js';

vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ role: 'super_admin' }),
}));

import { LicenseFieldsBlock } from './LicenseFieldsBlock.jsx';

// Force English so all test regex patterns match English translations:
// /business/i → "Business", /subscribed at/i → "Subscribed at", etc.
beforeAll(async () => {
  await i18n.changeLanguage('en');
});

// Restore the project default locale so this file does not pollute the i18n
// singleton for any test files that run after it in the same Vitest worker.
afterAll(async () => {
  await i18n.changeLanguage('ru');
});

describe('LicenseFieldsBlock', () => {
  const baseValue = {
    licenseType: null,
    subscribedAt: null,
    expiresAt: null,
  };

  it('emits licenseType change', () => {
    const onChange = vi.fn();
    render(
      <LicenseFieldsBlock value={baseValue} onChange={onChange} onLicenseKeyChange={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText(/business/i));
    expect(onChange).toHaveBeenCalledWith({ licenseType: 'business' });
  });

  it('emits subscribedAt change', () => {
    const onChange = vi.fn();
    render(
      <LicenseFieldsBlock value={baseValue} onChange={onChange} onLicenseKeyChange={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText(/subscribed at|дата подписки|բաժանորդագրման/i), {
      target: { value: '2026-01-01' },
    });
    expect(onChange).toHaveBeenCalledWith({ subscribedAt: '2026-01-01' });
  });

  it('shows expiresBeforeSubscribed error when dates inverted', () => {
    render(
      <LicenseFieldsBlock
        value={{
          licenseType: 'personal',
          subscribedAt: '2026-06-01',
          expiresAt: '2026-01-01',
        }}
        onChange={() => {}}
        onLicenseKeyChange={() => {}}
      />,
    );
    expect(
      screen.getByText(/expiry date must be after|должна быть позже|ուշ լինի/i),
    ).toBeInTheDocument();
  });

  it('forwards license-key changes to onLicenseKeyChange', () => {
    const onLicenseKeyChange = vi.fn();
    render(
      <LicenseFieldsBlock
        value={baseValue}
        onChange={() => {}}
        onLicenseKeyChange={onLicenseKeyChange}
      />,
    );
    const input = screen.getByLabelText(/license key|ключ лицензии|բանալին/i);
    fireEvent.input(input, { target: { value: 'KEY-1' } });
    fireEvent.blur(input);
    expect(onLicenseKeyChange).toHaveBeenCalledWith('KEY-1');
  });
});
