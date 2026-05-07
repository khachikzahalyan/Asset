// src/hooks/useUsers.js
import { useEffect, useState } from 'react';
import { firestoreUsersRepository } from '@/infra/repositories/firestoreUsersRepository.js';

/**
 * Subscribe to all users.
 * @returns {{ data: import('@/domain/repositories/UsersRepository.js').AppUser[], loading: boolean, error: Error|null }}
 */
export function useUsers() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsub = firestoreUsersRepository.list(
      (rows) => {
        setData(rows);
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
