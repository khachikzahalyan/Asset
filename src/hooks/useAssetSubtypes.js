import { useEffect, useMemo, useState } from 'react';

import { firestoreAssetSubtypeRepository } from '@/infra/repositories/firestoreAssetSubtypeRepository.js';

/**
 * Subscribes to the full asset_subtypes catalog and exposes a filtered list.
 *
 * @param {{ categoryId?: string | null, includeInactive?: boolean }} [opts]
 * @returns {{
 *   data: import('@/domain/assetSubtypes.js').AssetSubtype[],
 *   all: import('@/domain/assetSubtypes.js').AssetSubtype[],
 *   loading: boolean,
 *   error: Error | null,
 * }}
 */
export function useAssetSubtypes(opts = {}) {
  const { categoryId = null, includeInactive = false } = opts;
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    const unsub = firestoreAssetSubtypeRepository.list(
      (items) => {
        setAll(items);
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

  const data = useMemo(() => {
    let out = all;
    if (categoryId) {
      out = out.filter((s) => s.categoryId === categoryId);
    }
    if (!includeInactive) {
      out = out.filter((s) => s.isActive !== false);
    }
    return out;
  }, [all, categoryId, includeInactive]);

  return { data, all, loading, error };
}
