// Write hooks for Saves (ONE-39).
//
// Saving is an optimistic boolean toggle, so it runs on the shared helper
// (lib/optimisticToggle.ts) rather than growing a fifth hand-written
// rollback. As with blocking, the thing that changes is *membership of a
// list*: the profile's cached save list is the entity, and the target's key
// says which row.

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { saveKeyOf, saveTarget, targetOfSaveKey, unsaveTarget } from './api';
import { saveKeys } from './keys';
import type { Save, SaveTarget } from './types';
import { useOptimisticToggle, type OptimisticToggleConfig } from '../../lib/optimisticToggle';

/**
 * Whether the toggle under way is a save, read off the cached list after
 * onMutate has flipped it — so there is no separate record of intent to
 * disagree with the cache.
 *
 * With no list cached there was nothing to flip, and reading that as "not
 * saved" would turn a save into a silent unsave. It saves instead: an unsave
 * can only start from a rendered, and so loaded, list, and saving something
 * already saved is a no-op.
 */
export const shouldSaveAfterFlip = (list: Save[] | undefined, key: string): boolean =>
  list === undefined || list.some((save) => saveKeyOf(save.target) === key);

/**
 * The toggle's configuration: the profile's save list is the entity, a
 * target's key (`kind:id`) is the id. Exported so the rollback is exercised
 * against a real QueryClient in tests, without a renderer.
 */
export const saveToggleConfig = (
  queryClient: QueryClient,
  profileId: string | undefined,
): OptimisticToggleConfig<Save[]> => {
  const listKey = saveKeys.mine(profileId ?? '');
  return {
    entityKey: () => listKey,
    // Nothing else caches a profile's save list, so there is no second copy.
    listKey: saveKeys.all,
    entityId: () => '',

    isOn: (list, key) => list.some((save) => saveKeyOf(save.target) === key),
    count: (list) => list.length,
    apply: (list, next, key) => {
      if (!next.isOn) return list.filter((save) => saveKeyOf(save.target) !== key);
      const target = targetOfSaveKey(key);
      if (!target || !profileId) return list;
      // A provisional row, newest first; onSettled replaces it with the stored one.
      return [{ id: `pending:${key}`, profileId, target, savedAt: new Date().toISOString() }, ...list];
    },

    mutationFn: async (key: string) => {
      const target = targetOfSaveKey(key);
      if (!profileId) throw new Error('You must be signed in to save.');
      if (!target) throw new Error(`Cannot save ${key}.`);

      return shouldSaveAfterFlip(queryClient.getQueryData<Save[]>(listKey), key)
        ? saveTarget(profileId, target)
        : unsaveTarget(profileId, target);
    },
  };
};

export interface SaveToggle {
  /** Save the target if it isn't saved, unsave it if it is. */
  toggle: (target: SaveTarget) => void;
  isPending: boolean;
}

/**
 * Save or unsave a Product, Project, Profile or Post, optimistically, as a
 * profile. A post's own save button uses `useSavePost` (features/posts),
 * which patches the post wherever a feed shows it; this one patches the
 * profile's save list.
 */
export const useToggleSave = (profileId: string | undefined): SaveToggle => {
  const queryClient = useQueryClient();
  const mutation = useOptimisticToggle<Save[]>(saveToggleConfig(queryClient, profileId));
  const { mutate } = mutation;

  return {
    toggle: useCallback((target: SaveTarget) => mutate(saveKeyOf(target)), [mutate]),
    isPending: mutation.isPending,
  };
};
