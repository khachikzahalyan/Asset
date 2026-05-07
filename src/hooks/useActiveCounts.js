import { useEffect, useState } from 'react';
import { collection, getCountFromServer, query, where } from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';

/**
 * Subscribe-style hook that returns the count of `employees` and `branches`
 * documents where `isActive == true`.
 *
 * Implementation notes
 * --------------------
 *  - We use `getCountFromServer()` (Firestore aggregation query) instead of
 *    `onSnapshot` because:
 *      1. Cheaper — a single billed read per refresh, not N reads for the
 *         full document list every time anyone signs in.
 *      2. The dashboard is a one-shot landing surface, not a live feed.
 *  - The hook is intentionally NOT live: it refetches only when the consumer
 *    component re-mounts. A bumpable `refreshKey` prop is exposed so future
 *    callers can force a refetch after a mutation (e.g. the quick-action
 *    "Add employee" dialog success handler) without remounting the page.
 *  - On `permission-denied` (user lost role mid-session, missing rules) we
 *    quietly resolve to `null` and surface the error on `error` — the
 *    DashboardPage shows `—` in that case rather than crashing.
 *
 * @param {Object} [opts]
 * @param {number} [opts.refreshKey] Bump to force a refetch.
 * @returns {{
 *   activeEmployees: number | null,
 *   branches: number | null,
 *   loading: boolean,
 *   error: Error | null,
 * }}
 */
export function useActiveCounts({ refreshKey = 0 } = {}) {
  const [activeEmployees, setActiveEmployees] = useState(null);
  const [branches, setBranches] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      getCountFromServer(
        query(collection(db, 'employees'), where('isActive', '==', true))
      ),
      getCountFromServer(
        query(collection(db, 'branches'), where('isActive', '==', true))
      ),
    ])
      .then(([empSnap, brSnap]) => {
        if (cancelled) return;
        setActiveEmployees(empSnap.data().count ?? 0);
        setBranches(brSnap.data().count ?? 0);
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
  }, [refreshKey]);

  return { activeEmployees, branches, loading, error };
}
