import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';

import NotificationSettingsPage from '@/pages/NotificationSettingsPage.jsx';
import i18n from '@/i18n/index.js';

vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { uid: 'u_super' },
    role: 'super_admin',
    loading: false,
    signOut: vi.fn(),
  }),
}));

const { settingsState, setNotificationSettingsMock } = vi.hoisted(() => ({
  settingsState: {
    data: { licenseExpiryWarningDays: 30 },
    loading: false,
    error: null,
  },
  setNotificationSettingsMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/hooks/useNotificationSettings.js', () => ({
  useNotificationSettings: () => settingsState,
}));

vi.mock('@/infra/repositories/firestoreNotificationSettingsRepository.js', () => ({
  setNotificationSettings: setNotificationSettingsMock,
}));

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/settings/notifications']}>
        <NotificationSettingsPage />
      </MemoryRouter>
    </I18nextProvider>
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('ru');
  settingsState.data = { licenseExpiryWarningDays: 30 };
  settingsState.loading = false;
  settingsState.error = null;
  setNotificationSettingsMock.mockClear();
  setNotificationSettingsMock.mockResolvedValue(undefined);
});

describe('NotificationSettingsPage', () => {
  it('renders the title and subtitle', () => {
    renderPage();
    expect(
      screen.getByText(i18n.t('settings:notificationSettingsTitle'))
    ).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('settings:notificationSettingsSubtitle'))
    ).toBeInTheDocument();
  });

  it('prefills the days field from hook data', () => {
    renderPage();
    expect(
      screen.getByLabelText(i18n.t('settings:licenseExpiryWarningDaysLabel'))
    ).toHaveValue(30);
  });

  it('blocks submit when value is out of range', async () => {
    const user = userEvent.setup();
    renderPage();

    const input = screen.getByLabelText(
      i18n.t('settings:licenseExpiryWarningDaysLabel')
    );
    await user.clear(input);
    await user.type(input, '999');

    await user.click(
      screen.getByRole('button', { name: i18n.t('settings:saveButton') })
    );

    expect(setNotificationSettingsMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      i18n.t('settings:errorRange')
    );
  });

  it('submits valid value and calls setNotificationSettings', async () => {
    const user = userEvent.setup();
    renderPage();

    const input = screen.getByLabelText(
      i18n.t('settings:licenseExpiryWarningDaysLabel')
    );
    await user.clear(input);
    await user.type(input, '14');

    await user.click(
      screen.getByRole('button', { name: i18n.t('settings:saveButton') })
    );

    await waitFor(() =>
      expect(setNotificationSettingsMock).toHaveBeenCalledTimes(1)
    );
    const [payload] = setNotificationSettingsMock.mock.calls[0];
    expect(payload.licenseExpiryWarningDays).toBe(14);
  });

  it('shows error from hook', () => {
    settingsState.error = new Error('network error');
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('network error');
  });

  it('shows loading state', () => {
    settingsState.loading = true;
    settingsState.data = null;
    renderPage();
    expect(screen.getByText(i18n.t('common:loading'))).toBeInTheDocument();
  });
});
