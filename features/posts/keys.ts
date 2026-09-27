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
};
