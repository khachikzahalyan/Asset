import { useEffect, useState } from 'react';

import { firestoreAssetRepository } from '@/infra/repositories/firestoreAssetRepository.js';

/**
 * Subscribe to all assets currently assigned to the given employee.
 * Wraps `firestoreAssetRepository.listByEmployee`.
 *
 * When `employeeId` is null/undefined the hook immediately returns
 * `{ data: [], loading: false, error: null }` without hitting Firestore.
 *
 * @param {string | null | undefined} employeeId
 * @returns {{
 *   data: import('@/domain/assets.js').Asset[],
 *   loading: boolean,
 *   error: Error | null,
 * }}
 */
export function useAssetsByEmployee(employeeId) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!employeeId) {
      setData([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const unsub = firestoreAssetRepository.listByEmployee(
      employeeId,
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
  }, [employeeId]);

  return { data, loading, error };
}
