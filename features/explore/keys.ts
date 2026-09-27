// The only place Explore query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('explore');

export const exploreKeys = {
  ...base,
  /** The grid, as one viewer sees it: their own content and blocks shape it. */
  grid: (viewerId: string, interest: string | null = null) => base.list({ viewerId, interest }),
};
