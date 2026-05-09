// src/hooks/useLicenseSecret.js
import { useCallback, useState } from 'react';
import {
  getLicenseKey,
  setLicenseKey,
  transferLicenseKey,
} from '@/infra/repositories/firestoreLicenseSecretRepository.js';
import { useAuth } from '@/contexts/AuthContext.jsx';

/**
 * Imperative hook over `/assets/{assetId}/secrets/key`.
 * Deliberately NOT a subscription — the key is fetched only when the
 * operator explicitly asks for it (e.g. clicks "Показать").
 *
 * @param {Object} options
 * @param {string} options.assetId
 * @returns {{
 *   getKey: () => Promise<string|null>,
 *   setKey: (value: string) => Promise<void>,
 *   transferKey: (toAssetId: string) => Promise<void>,
 *   loading: boolean,
 *   error: Error|null,
 * }}
 */
export function useLicenseSecret({ assetId }) {
  const { user, role } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const getKey = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      return await getLicenseKey(assetId);
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  const setKey = useCallback(
    async (value) => {
      setLoading(true);
      setError(null);
      try {
        await setLicenseKey(assetId, value, { uid: user?.uid, role });
      } catch (err) {
        setError(err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [assetId, user?.uid, role],
  );

  const transferKey = useCallback(
    async (toAssetId) => {
      setLoading(true);
      setError(null);
      try {
        await transferLicenseKey({
          fromAssetId: assetId,
          toAssetId,
          actor: { uid: user?.uid, role },
        });
      } catch (err) {
        setError(err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [assetId, user?.uid, role],
  );

  return { getKey, setKey, transferKey, loading, error };
}
