import { useEffect, useState } from 'react';

import { firestoreEmployeeRepository } from '@/infra/repositories/firestoreEmployeeRepository.js';
import { useAuth } from '@/contexts/AuthContext.jsx';

/**
 * Subscribe to the employee record that matches the currently-authenticated
 * user's email. Uses the `email_index` sentinel for the lookup.
 *
 * States:
 *   - loading === true while the auth state is resolving OR the index lookup
 *     is in flight.
 *   - data === null AND loading === false means the user is not linked to any
 *     employee record in the system.
 *   - data !== null means we have a valid Employee document.
 *
 * @returns {{
 *   data: import('@/domain/employees.js').Employee | null,
 *   loading: boolean,
 *   error: Error | null,
 * }}
 */
export function useCurrentEmployee() {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return undefined;
    }
    if (!user?.email) {
      setData(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const unsub = firestoreEmployeeRepository.getByEmail(
      user.email,
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
  }, [user?.email, authLoading]);

  return { data, loading, error };
}
