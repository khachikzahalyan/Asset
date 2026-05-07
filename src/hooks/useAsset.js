import { useEffect, useState } from 'react';

import { firestoreAssetRepository } from '@/infra/repositories/firestoreAssetRepository.js';

/**
 * Subscribe to a single asset doc by id.
 *
 * @param {string | null | undefined} id
 * @returns {{
 *   data: import('@/domain/assets.js').Asset | null,
 *   loading: boolean,
 *   error: Error | null,
 * }}
 */
export function useAsset(id) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) {
      setData(null);
      setLoading(false);
      setError(null);
      return undefined;
    }
    setLoading(true);
    const unsub = firestoreAssetRepository.get(
      id,
      (item) => {
        setData(item);
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );
    return unsub;
  }, [id]);

  return { data, loading, error };
}
