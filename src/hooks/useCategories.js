import { useEffect, useState } from 'react';

import { firestoreCategoryRepository } from '@/infra/repositories/firestoreCategoryRepository.js';

/**
 * Subscribe to the full categories list.
 *
 * @returns {{
 *   data: import('@/domain/categories.js').Category[],
 *   loading: boolean,
 *   error: Error | null,
 * }}
 */
export function useCategories() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    const unsub = firestoreCategoryRepository.list(
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
