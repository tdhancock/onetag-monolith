// The only place block query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('blocks');

export const blockKeys = {
  ...base,
  /**
   * Everyone one user has blocked. Built from `all`, so invalidating
   * `blockKeys.all` reaches it.
   *
   * Keyed by the blocker: two accounts signed in on one device must never
   * share an answer about who *they* blocked.
   */
  list: (blockerId: string) => [...base.all, 'list', blockerId] as const,
};
