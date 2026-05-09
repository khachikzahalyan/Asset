// src/components/features/assets/LicenseKeyField.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
// Initialise i18next so t('licenseKey') returns the real Russian string
// ("Ключ лицензии") which the test regex /ключ лицензии/i can match.
import '@/i18n/index.js';

const useAuthMock = vi.fn();
vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => useAuthMock(),
}));

import { LicenseKeyField } from './LicenseKeyField.jsx';

describe('LicenseKeyField', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
  });

  it('renders nothing for asset_admin', () => {
    useAuthMock.mockReturnValue({ role: 'asset_admin' });
    const { container } = render(
      <LicenseKeyField defaultValue="" onValueChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for employee', () => {
    useAuthMock.mockReturnValue({ role: 'employee' });
    const { container } = render(
      <LicenseKeyField defaultValue="" onValueChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a masked input for super_admin', () => {
    useAuthMock.mockReturnValue({ role: 'super_admin' });
    render(<LicenseKeyField defaultValue="SECRET" onValueChange={() => {}} />);
    const input = screen.getByLabelText(/license key|ключ лицензии|բանալին/i);
    expect(input).toHaveAttribute('type', 'password');
  });

  it('toggles to visible text on Show', () => {
    useAuthMock.mockReturnValue({ role: 'tech_admin' });
    render(<LicenseKeyField defaultValue="SECRET" onValueChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /show|показать|ցույց/i }));
    const input = screen.getByLabelText(/license key|ключ лицензии|բանալին/i);
    expect(input).toHaveAttribute('type', 'text');
  });

  it('emits new value on blur', () => {
    useAuthMock.mockReturnValue({ role: 'super_admin' });
    const onValueChange = vi.fn();
    render(<LicenseKeyField defaultValue="" onValueChange={onValueChange} />);
    const input = screen.getByLabelText(/license key|ключ лицензии|բանալին/i);
    fireEvent.input(input, { target: { value: 'NEW-VAL' } });
    fireEvent.blur(input);
    expect(onValueChange).toHaveBeenCalledWith('NEW-VAL');
  });

  it('writes value to clipboard on Copy', async () => {
    useAuthMock.mockReturnValue({ role: 'super_admin' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<LicenseKeyField defaultValue="SECRET" onValueChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /copy|копировать|պատճենել/i }));
    expect(writeText).toHaveBeenCalledWith('SECRET');
  });
});
