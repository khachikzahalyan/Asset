import { useEffect, useState } from 'react';

import { firestoreAssignmentEventRepository } from '@/infra/repositories/firestoreAssignmentEventRepository.js';

/**
 * Subscribe to all assignment events for one asset, newest first.
 *
 * @param {string | null | undefined} assetId
 * @returns {{
 *   data: import('@/domain/assignmentEvents.js').AssignmentEvent[],
 *   loading: boolean,
 *   error: Error | null,
 * }}
 */
export function useAssignmentEvents(assetId) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(Boolean(assetId));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!assetId) {
      setData([]);
      setLoading(false);
      setError(null);
      return undefined;
    }
    setLoading(true);
    const unsub = firestoreAssignmentEventRepository.listByAsset(
      assetId,
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
  }, [assetId]);

  return { data, loading, error };
}
