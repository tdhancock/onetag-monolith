// Read hooks for the posts domain.

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import { fetchFeedPage, fetchNewestFeedPost, fetchPostById, getPostLikers, getPostReposters, nextFeedCursor } from './api';
import { findCachedPost } from './cache';
import type { FeedCursor } from './api';
import { postKeys } from './keys';
import type { Post } from './types';
import type { ProfileId, SimpleUser } from '../../types';

/** How often the home feed looks for newer posts while it's on screen. */
export const NEW_POSTS_CHECK_MS = 60_000;

/**
 * The newest post the feed holds now, checked every NEW_POSTS_CHECK_MS while
 * `watching` (the home tab is on screen) and again whenever it comes back.
 */
export const useNewestFeedPostQuery = (
  userId: ProfileId | undefined,
  interest: string | null,
  watching: boolean,
) =>
  useQuery<FeedCursor>({
    queryKey: postKeys.newest(userId ?? '', interest),
    queryFn: () => fetchNewestFeedPost(userId!, interest),
    enabled: Boolean(userId) && watching,
    // Always worth asking again when the tab comes back into view.
    staleTime: 0,
    refetchInterval: watching ? NEW_POSTS_CHECK_MS : false,
  });

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
export const useFeedQuery = (userId: ProfileId | undefined, interest: string | null = null) =>
  // The generics are spelled out because inference widens the page param to
  // `unknown` once getNextPageParam is a named function rather than an inline
  // arrow, which then leaks into every consumer of `data`.
  useInfiniteQuery<Post[], Error, InfiniteData<Post[], FeedCursor>, QueryKey, FeedCursor>({
    queryKey: interest ? postKeys.feedForInterest(userId ?? '', interest) : postKeys.feed(userId ?? ''),
    queryFn: ({ pageParam }) => fetchFeedPage({ userId: userId!, pageParam, interest }),
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
 *
 * A post opened from a list that already holds it — the feed, a profile's
 * grid — shows at once from there while it loads in full.
 */
export const usePostQuery = (postId: string | undefined, viewerId?: ProfileId) => {
  const queryClient = useQueryClient();
  return useQuery<Post | undefined>({
    queryKey: postKeys.detail(postId ?? ''),
    queryFn: () => fetchPostById(postId!, viewerId),
    enabled: Boolean(postId),
    placeholderData: () =>
      postId ? findCachedPost(queryClient.getQueriesData({}).map(([, data]) => data), postId) : undefined,
  });
};

/** Who liked a post. */
export const usePostLikersQuery = (postId: string | undefined) =>
  useQuery<SimpleUser[]>({
    queryKey: postKeys.likers(postId ?? ''),
    queryFn: () => getPostLikers(postId!),
    enabled: Boolean(postId),
  });

/** Who reposted a post. */
export const usePostRepostersQuery = (postId: string | undefined) =>
  useQuery<SimpleUser[]>({
    queryKey: postKeys.reposters(postId ?? ''),
    queryFn: () => getPostReposters(postId!),
    enabled: Boolean(postId),
  });
