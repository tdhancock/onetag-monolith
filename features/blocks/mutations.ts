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

      // onMutate has already flipped the cache, so what the list says now is
      // the state being asked for — no separate record of intent to disagree
      // with it.
      const shouldBlock = (queryClient.getQueryData<BlockedUser[]>(listKey) ?? []).some(
        (user) => user.userId === userId,
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
