// src/hooks/useBrands.js
import { useEffect, useState } from 'react';
import { subscribeToBrands } from '@/infra/repositories/firestoreBrandRepository.js';

/**
 * Reactive hook over the `/brands` collection.
 * @returns {{ data: Array, loading: boolean, error: Error|null }}
 */
export function useBrands() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribe = subscribeToBrands({
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
  }, []);

  return { data, loading, error };
}
