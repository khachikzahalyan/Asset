import { useEffect, useState } from 'react';

import { firestoreAuditRepository } from '@/infra/repositories/firestoreAuditRepository.js';

/**
 * Fetch audit-log entries for a single entity.
 *
 * Returns `{ data, loading, error }`. Refetches when `entityType`,
 * `entityId`, or `refreshKey` changes. The shape mirrors the data hooks
 * elsewhere in AMS.
 *
 * @param {string|null|undefined} entityType
 * @param {string|null|undefined} entityId
 * @param {{ limit?: number, refreshKey?: number }} [opts]
 * @returns {{
 *   data: import('@/domain/audit.js').AuditLog[],
 *   loading: boolean,
 *   error: Error | null,
 * }}
 */
export function useAuditLogs(entityType, entityId, opts = {}) {
  const { limit = 50, refreshKey = 0 } = opts;
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!entityType || !entityId) {
      setData([]);
      setLoading(false);
      setError(null);
      return undefined;
    }
    setLoading(true);
    setError(null);
    firestoreAuditRepository
      .listForEntity(entityType, entityId, { limit })
      .then((items) => {
        if (cancelled) return;
        setData(items);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId, limit, refreshKey]);

  return { data, loading, error };
}
