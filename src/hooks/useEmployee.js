import { useEffect, useState } from 'react';

import { firestoreEmployeeRepository } from '@/infra/repositories/firestoreEmployeeRepository.js';

/**
 * Subscribe to a single employee by id.
 *
 * @param {string | null | undefined} id
 * @returns {{
 *   data: import('@/domain/employees.js').Employee | null,
 *   loading: boolean,
 *   error: Error | null,
 * }}
 */
export function useEmployee(id) {
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
    const unsub = firestoreEmployeeRepository.get(
      id,
      (employee) => {
        setData(employee);
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
