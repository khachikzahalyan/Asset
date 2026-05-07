import { useEffect, useState } from 'react';

import { firestoreCategoryRepository } from '@/infra/repositories/firestoreCategoryRepository.js';

/**
 * Subscribe to a single category by id.
 *
 * @param {string | null | undefined} id
 * @returns {{
 *   data: import('@/domain/categories.js').Category | null,
 *   loading: boolean,
 *   error: Error | null,
 * }}
 */
export function useCategory(id) {
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
    const unsub = firestoreCategoryRepository.get(
      id,
      (category) => {
        setData(category);
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
