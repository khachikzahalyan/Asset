import { useEffect, useState } from 'react';

import { firestoreBranchRepository } from '@/infra/repositories/firestoreBranchRepository.js';

/**
 * Subscribe to the full branches list.
 *
 * @returns {{
 *   data: import('@/domain/branches.js').Branch[],
 *   loading: boolean,
 *   error: Error | null,
 * }}
 */
export function useBranches() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    const unsub = firestoreBranchRepository.list(
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
