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
};
