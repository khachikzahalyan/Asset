// src/components/features/assets/LicenseKeyDialog.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n/index.js';

const getKeyMock = vi.fn();
const setKeyMock = vi.fn();
vi.mock('@/hooks/useLicenseSecret.js', () => ({
  useLicenseSecret: () => ({
    getKey: getKeyMock,
    setKey: setKeyMock,
    loading: false,
    error: null,
  }),
}));
vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ role: 'super_admin' }),
}));

import { LicenseKeyDialog } from './LicenseKeyDialog.jsx';

describe('LicenseKeyDialog', () => {
  beforeEach(() => {
    getKeyMock.mockReset();
    setKeyMock.mockReset();
  });

  it('fetches the existing key on open', async () => {
    getKeyMock.mockResolvedValue('OLD-KEY');
    render(
      <LicenseKeyDialog assetId="a1" open onOpenChange={() => {}} />,
    );
    await waitFor(() => expect(getKeyMock).toHaveBeenCalledWith());
  });

  it('saves the new key on Save', async () => {
    getKeyMock.mockResolvedValue('OLD-KEY');
    setKeyMock.mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <LicenseKeyDialog
        assetId="a1"
        open
        onOpenChange={onOpenChange}
      />,
    );
    await waitFor(() => expect(getKeyMock).toHaveBeenCalled());
    const input = screen.getByLabelText(/license key|ключ лицензии|բаналин/i);
    fireEvent.input(input, { target: { value: 'NEW-KEY' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: /save|сохранить|պahпанел/i }));
    await waitFor(() => expect(setKeyMock).toHaveBeenCalledWith('NEW-KEY'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('does not call setKey on Cancel', async () => {
    getKeyMock.mockResolvedValue('OLD-KEY');
    const onOpenChange = vi.fn();
    render(
      <LicenseKeyDialog
        assetId="a1"
        open
        onOpenChange={onOpenChange}
      />,
    );
    await waitFor(() => expect(getKeyMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /cancel|отмена|չеղаркел/i }));
    expect(setKeyMock).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
