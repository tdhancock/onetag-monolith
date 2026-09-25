// Read hooks for the blocks domain.

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchBlocks } from './api';
import { blockKeys } from './keys';
import type { BlockedUser } from './types';
import type { AuthUserId } from '../../types';

/**
 * Everyone the signed-in user has blocked.
 *
 * Disabled without a user id: signed out there is nobody whose blocks these
 * would be, and firing it anyway would cache an answer under an empty key.
 */
export const useBlocksQuery = (blockerId: AuthUserId | undefined) =>
  useQuery<BlockedUser[]>({
    queryKey: blockKeys.list(blockerId ?? ''),
    queryFn: () => fetchBlocks(blockerId!),
    enabled: Boolean(blockerId),
  });

/**
 * `isUserBlocked(username)` and the list behind it.
 *
 * Screens ask by username because that is what a post, a story or a search
 * result carries. The query is keyed by id, so the lookup happens here rather
 * than making every caller hold both.
 *
 * While the list is loading nobody is blocked, which errs towards showing
 * content for a moment rather than hiding it forever — the block still holds
 * on the server either way, which is the point of this ticket.
 */
export const useBlockedUsers = (blockerId: AuthUserId | undefined) => {
  const query = useBlocksQuery(blockerId);
  const blocked = query.data;

  const isUserBlocked = useCallback(
    (username: string) => Boolean(blocked?.some((user) => user.usernames.includes(username) || user.username === username)),
    [blocked],
  );

  const isUserIdBlocked = useCallback(
    (userId: string) => Boolean(blocked?.some((user) => user.userId === userId)),
    [blocked],
  );

  return { blockedUsers: blocked ?? [], isUserBlocked, isUserIdBlocked, query };
};
