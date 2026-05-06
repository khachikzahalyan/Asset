import { useEffect, useState } from 'react';

import { firestoreBranchRepository } from '@/infra/repositories/firestoreBranchRepository.js';

/**
 * Subscribe to a single branch by id.
 *
 * @param {string | null | undefined} id
 * @returns {{
 *   data: import('@/domain/branches.js').Branch | null,
 *   loading: boolean,
 *   error: Error | null,
 * }}
 */
export function useBranch(id) {
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
    const unsub = firestoreBranchRepository.get(
      id,
      (branch) => {
        setData(branch);
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
