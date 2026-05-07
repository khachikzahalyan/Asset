// src/hooks/useUserInvitations.js
import { useEffect, useState } from 'react';
import { firestoreUserInvitationsRepository } from '@/infra/repositories/firestoreUserInvitationsRepository.js';

/**
 * Subscribe to all pending invitations.
 * @returns {{ data: import('@/domain/userInvitations.js').UserInvitation[], loading: boolean, error: Error|null }}
 */
export function useUserInvitations() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsub = firestoreUserInvitationsRepository.listPending(
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
