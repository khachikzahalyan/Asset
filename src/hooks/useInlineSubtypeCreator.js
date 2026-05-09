import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { firestoreAssetSubtypeRepository } from '@/infra/repositories/firestoreAssetSubtypeRepository.js';
import { firestoreCategoryRepository } from '@/infra/repositories/firestoreCategoryRepository.js';
import { CategoryIdConflictError } from '@/domain/categories.js';

/**
 * Returns a stable `createInlineSubtype(input, opts)` function that
 * encapsulates the inline-subtype-creation write path, including the optional
 * new-category pre-creation step.
 *
 * Accepted by `SubtypeFormDialog` as its `onSubmit` prop from within
 * `AssetFormDialog`, keeping infra imports out of UI components.
 *
 * @returns {(input: Object, opts: { id: string, newCategory?: { id: string, input: Object } }) => Promise<void>}
 */
export function useInlineSubtypeCreator() {
  const { user, role } = useAuth();

  return useCallback(
    async (input, opts) => {
      if (!user) throw new Error('not-authenticated');
      const actor = { uid: user.uid, role };

      if (opts?.newCategory) {
        // Pre-create the category; tolerate ID conflicts (idempotent).
        try {
          await firestoreCategoryRepository.create(
            opts.newCategory.input,
            actor,
            { id: opts.newCategory.id }
          );
        } catch (err) {
          if (!(err instanceof CategoryIdConflictError)) throw err;
        }

        // Create the subtype under the (possibly pre-existing) category.
        try {
          await firestoreAssetSubtypeRepository.create(input, actor, {
            id: opts.id,
          });
        } catch (err) {
          const e = new Error('subtype/orphan-category');
          e.code = 'subtype/orphan-category';
          e.cause = err;
          throw e;
        }
      } else {
        await firestoreAssetSubtypeRepository.create(input, actor, {
          id: opts.id,
        });
      }
    },
    [user, role]
  );
}
