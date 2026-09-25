// The only place tag query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('tags');

export const tagKeys = {
  ...base,
  /** What a short code resolves to, as the resolution route reads it. */
  resolution: (shortCode: string) => [...base.all, 'resolution', shortCode] as const,
};
