// src/hooks/useNotificationSettings.js
import { useEffect, useState } from 'react';
import { subscribeToNotificationSettings } from '@/infra/repositories/firestoreNotificationSettingsRepository.js';

const DEFAULT_SETTINGS = Object.freeze({ licenseExpiryWarningDays: 30 });

/**
 * Reactive hook over `/settings/notifications`.
 * Returns default values when the doc does not exist.
 * @returns {{ data: { licenseExpiryWarningDays: number }, loading: boolean, error: Error|null }}
 */
export function useNotificationSettings() {
  const [data, setData] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribe = subscribeToNotificationSettings({
      onData: (snapshot) => {
        setData(
          snapshot && typeof snapshot.licenseExpiryWarningDays === 'number'
            ? snapshot
            : DEFAULT_SETTINGS,
        );
        setLoading(false);
        setError(null);
      },
      onError: (err) => {
        setError(err);
        setLoading(false);
      },
    });
    return unsubscribe;
  }, []);

  return { data, loading, error };
}
