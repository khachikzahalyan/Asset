import { useEffect, useState } from 'react';

import { firestoreAssetRepository } from '@/infra/repositories/firestoreAssetRepository.js';

/**
 * Subscribe to the full assets list (sorted by inventoryCode ASC).
 *
 * @returns {{
 *   data: import('@/domain/assets.js').Asset[],
 *   loading: boolean,
 *   error: Error | null,
 * }}
 */
export function useAssets() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    const unsub = firestoreAssetRepository.list(
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
