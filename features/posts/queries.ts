// Read hooks for the posts domain.

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import { fetchFeedPage, fetchPostById, nextFeedCursor } from './api';
import type { FeedCursor } from './api';
import { postKeys } from './keys';
import type { Post } from './types';
import type { ProfileId } from '../../types';

/**
 * The signed-in user's feed, one page at a time.
 *
 * Page state lives in the query, not in a module-level counter, so two feeds
 * can page independently and a fresh mount starts from the top on its own.
 *
 * Disabled until there is a user id — the feed is "everyone I follow, plus
 * me", which is meaningless without one, and firing it anyway would cache a
 * page under an empty key.
 */
export const useFeedQuery = (userId: ProfileId | undefined) =>
  // The generics are spelled out because inference widens the page param to
  // `unknown` once getNextPageParam is a named function rather than an inline
  // arrow, which then leaks into every consumer of `data`.
  useInfiniteQuery<Post[], Error, InfiniteData<Post[], FeedCursor>, QueryKey, FeedCursor>({
    queryKey: postKeys.feed(userId ?? ''),
    queryFn: ({ pageParam }) => fetchFeedPage({ userId: userId!, pageParam }),
    initialPageParam: null as FeedCursor,
    getNextPageParam: nextFeedCursor,
    enabled: Boolean(userId),
  });

/**
 * A single post by id.
 *
 * `viewerId` decides whether the post comes back marked as liked, reposted
 * or saved — that state is read per viewer and carried on the entity, so the
 * toggle hooks have something to flip (ONE-13).
 *
 * It is deliberately *not* part of the key: the toggle helper addresses a
 * post by `postKeys.detail(id)` alone, and a key that varied by viewer would
 * leave it patching an entry nothing is reading. Signing out therefore has
 * to clear the cache rather than out-key it — `QueryProvider` is where that
 * belongs, and it is worth its own ticket.
 */
export const usePostQuery = (postId: string | undefined, viewerId?: ProfileId) =>
  useQuery<Post | undefined>({
    queryKey: postKeys.detail(postId ?? ''),
    queryFn: () => fetchPostById(postId!, viewerId),
    enabled: Boolean(postId),
  });
