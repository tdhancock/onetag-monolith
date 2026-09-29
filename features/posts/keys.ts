// The only place post query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('posts');

export const postKeys = {
  ...base,
  /**
   * The infinite feed for one user. Built from `all`, so invalidating
   * `postKeys.all` reaches the feed along with everything else.
   */
  feed: (userId: string) => [...base.all, 'feed', userId] as const,
  /**
   * The feed narrowed to one interest (ONE-49). Beneath `feed(userId)`, so
   * invalidating the feed reaches every filtered copy of it too.
   */
  feedForInterest: (userId: string, interest: string) => [...base.all, 'feed', userId, interest] as const,
  /**
   * The newest post a feed holds now, which the home feed compares its top
   * with to offer "New posts". Beside the feed rather than beneath it, so
   * refetching the feed doesn't refetch this, and under `all`, so publishing
   * does.
   */
  newest: (userId: string, interest: string | null) => [...base.all, 'newest', userId, interest ?? ''] as const,
  /** Who liked a post, for its Likes list. */
  likers: (postId: string) => [...base.all, 'likers', postId] as const,
  /** Who reposted a post, for its Reposts list. */
  reposters: (postId: string) => [...base.all, 'reposters', postId] as const,
};
