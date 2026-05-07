import { useEffect, useState } from 'react';

import { firestoreAssetStatusRepository } from '@/infra/repositories/firestoreAssetStatusRepository.js';

/**
 * Subscribe to the full asset-statuses list (sorted by sortOrder ASC).
 *
 * @returns {{
 *   data: import('@/domain/assetStatuses.js').AssetStatus[],
 *   loading: boolean,
 *   error: Error | null,
 * }}
 */
export function useAssetStatuses() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    const unsub = firestoreAssetStatusRepository.list(
      (items) => {
        setData(items);
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  return { data, loading, error };
}
