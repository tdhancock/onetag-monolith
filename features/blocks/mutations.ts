// Write hooks for the blocks domain.
//
// Block/unblock is an optimistic boolean toggle over a join table, so it runs
// on the shared helper from ONE-13 rather than growing a fourth hand-written
// rollback. One wrinkle: a block has no record with a boolean on it — what
// changes is *membership of a list*. So the cached list is the entity here.
// `isOn` asks whether it holds this user, `apply` adds or removes the row,
// and the helper's snapshot/restore covers that exactly as it covers a like.

import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { blockUser, unblockUser } from './api';
import { blockKeys } from './keys';
import type { BlockedUser } from './types';
import { useOptimisticToggle } from '../../lib/optimisticToggle';

/** Enough of an account to block it and render the row. */
export interface BlockTarget {
  userId: string;
  username: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface BlockToggle {
  /** Block if not blocked, unblock if blocked. */
  toggle: (target: BlockTarget) => void;
  isPending: boolean;
}

/**
 * Whether the toggle now under way is a block, read off the cached list after
 * onMutate has flipped it — so there is no separate record of intent to
 * disagree with the cache.
 *
 * With no list cached — still loading, or its fetch just cancelled by
 * onMutate — there was nothing to flip, and reading that as "not in the
 * list" turned a block into a silent unblock. It blocks instead: an unblock
 * can only start from a rendered, and so loaded, block list, and blocking
 * someone already blocked is a harmless upsert.
 */
export const shouldBlockAfterFlip = (
  list: BlockedUser[] | undefined,
  userId: string,
): boolean => list === undefined || list.some((user) => user.userId === userId);

/**
 * Block or unblock, optimistically.
 *
 * The optimistic row is built from what the caller already has on screen, so
 * the block list is right immediately; the invalidation in `onSettled` then
 * replaces it with the stored row.
 */
export const useBlockToggle = (blockerId: string | undefined): BlockToggle => {
  const queryClient = useQueryClient();
  const listKey = blockKeys.list(blockerId ?? '');

  // The helper addresses a toggle by id alone, but building the optimistic
  // row needs the username and avatar the caller was already rendering.
  // `toggle()` parks them here on the way in.
  const targets = useRef(new Map<string, BlockTarget>());

  const mutation = useOptimisticToggle<BlockedUser[]>({
    entityKey: () => listKey,
    // Nothing else caches a block list, so there is no second copy to patch.
    listKey: blockKeys.all,
    entityId: (list) => '',

    isOn: (list, userId) => list.some((user) => user.userId === userId),
    count: (list) => list.length,
    apply: (list, next, userId) => {
      if (!next.isOn) return list.filter((user) => user.userId !== userId);

      const target = targets.current.get(userId);

      return [
        {
          userId,
          username: target?.username ?? 'unknown_user',
          name: target?.name ?? null,
          avatarUrl: target?.avatarUrl ?? null,
          blockedAt: new Date().toISOString(),
        },
        ...list,
      ];
    },

    mutationFn: async (userId: string) => {
      if (!blockerId) throw new Error('You must be signed in to block someone.');

      const shouldBlock = shouldBlockAfterFlip(
        queryClient.getQueryData<BlockedUser[]>(listKey),
        userId,
      );

      return shouldBlock
        ? blockUser(blockerId, userId)
        : unblockUser(blockerId, userId);
    },
  });

  const { mutate } = mutation;

  return {
    toggle: useCallback(
      (target: BlockTarget) => {
        // Signed out there is nobody to attribute the block to, and blocking
        // yourself is refused by a check constraint — neither is worth a
        // round trip or an optimistic flicker.
        if (!blockerId || target.userId === blockerId) return;

        targets.current.set(target.userId, target);
        mutate(target.userId);
      },
      [blockerId, mutate],
    ),
    isPending: mutation.isPending,
  };
};
