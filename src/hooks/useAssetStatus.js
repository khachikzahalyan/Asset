import { useEffect, useState } from 'react';

import { firestoreAssetStatusRepository } from '@/infra/repositories/firestoreAssetStatusRepository.js';

/**
 * Subscribe to a single asset-status by id (the doc id is the stable
 * code identifier — e.g. 'warehouse', 'assigned').
 *
 * @param {string | null | undefined} id
 * @returns {{
 *   data: import('@/domain/assetStatuses.js').AssetStatus | null,
 *   loading: boolean,
 *   error: Error | null,
 * }}
 */
export function useAssetStatus(id) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) {
      setData(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsub = firestoreAssetStatusRepository.get(
      id,
      (status) => {
        setData(status);
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
