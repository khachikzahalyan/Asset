// src/hooks/useModels.js
import { useEffect, useState } from 'react';
import { subscribeToModels } from '@/infra/repositories/firestoreModelRepository.js';

/**
 * Reactive hook over `/models`. When `brandId` is null, returns all models.
 * @param {Object} [options]
 * @param {string|null} [options.brandId]
 * @returns {{ data: Array, loading: boolean, error: Error|null }}
 */
export function useModels({ brandId = null } = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeToModels({
      brandId,
      onData: (rows) => {
        setData(rows);
        setLoading(false);
        setError(null);
      },
      onError: (err) => {
        setError(err);
        setLoading(false);
      },
    });
    return unsubscribe;
  }, [brandId]);

  return { data, loading, error };
}
