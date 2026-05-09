// src/hooks/useInventoryCodePreview.js
import { useEffect, useState } from 'react';
import { useCategories } from '@/hooks/useCategories.js';

/**
 * Returns a preview of the next inventory code that would be assigned to an
 * asset in the given category. This reads from the category's
 * `inventoryCodePrefix` and the `category_counters` collection.
 *
 * Returns `{ value: null, loading: false }` when `categoryId` is null /
 * undefined, or when the category does not assign inventory codes.
 *
 * This is a display-only hook — it does NOT increment the counter. The real
 * allocation happens inside the Firestore transaction at create time.
 *
 * @param {string|null} categoryId
 * @returns {{ value: string|null, loading: boolean }}
 */
export function useInventoryCodePreview(categoryId) {
  const { data: categories } = useCategories();
  const [value, setValue] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!categoryId) {
      setValue(null);
      setLoading(false);
      return;
    }

    const category = categories.find(
      (c) => (c.categoryId ?? c.id) === categoryId
    );

    if (!category) {
      setValue(null);
      setLoading(false);
      return;
    }

    // If the category explicitly does not assign codes, return null.
    if (category.assignsInventoryCode === false) {
      setValue(null);
      setLoading(false);
      return;
    }

    // Build a preview from the prefix. We don't read the counter here to
    // avoid an extra Firestore read on every keystroke — the real code is
    // allocated on submit. Show the prefix to give the user a hint.
    const prefix = category.inventoryCodePrefix ?? '???';
    setValue(`${prefix}/…`);
    setLoading(false);
  }, [categoryId, categories]);

  return { value, loading };
}
