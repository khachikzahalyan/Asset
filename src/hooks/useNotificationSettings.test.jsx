// src/hooks/useNotificationSettings.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const subscribeToNotificationSettingsMock = vi.fn();
vi.mock('@/infra/repositories/firestoreNotificationSettingsRepository.js', () => ({
  subscribeToNotificationSettings: (...args) =>
    subscribeToNotificationSettingsMock(...args),
}));

import { useNotificationSettings } from './useNotificationSettings.js';

describe('useNotificationSettings', () => {
  beforeEach(() => {
    subscribeToNotificationSettingsMock.mockReset();
  });

  it('starts in loading state with default settings', () => {
    subscribeToNotificationSettingsMock.mockImplementation(() => () => {});
    const { result } = renderHook(() => useNotificationSettings());
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toEqual({ licenseExpiryWarningDays: 30 });
  });

  it('exposes settings once pushed', () => {
    let pushSnapshot = null;
    subscribeToNotificationSettingsMock.mockImplementation(({ onData }) => {
      pushSnapshot = onData;
      return () => {};
    });
    const { result } = renderHook(() => useNotificationSettings());
    act(() => {
      pushSnapshot({ licenseExpiryWarningDays: 14 });
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data.licenseExpiryWarningDays).toBe(14);
  });

  it('falls back to defaults when settings doc does not exist', () => {
    let pushSnapshot = null;
    subscribeToNotificationSettingsMock.mockImplementation(({ onData }) => {
      pushSnapshot = onData;
      return () => {};
    });
    const { result } = renderHook(() => useNotificationSettings());
    act(() => {
      pushSnapshot(null);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data.licenseExpiryWarningDays).toBe(30);
  });
});
