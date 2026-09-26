// The only place scan query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('scans');

export const scanKeys = {
  ...base,
  /** One profile's scan history — the caller's own, or a public one. */
  history: (profileId: string) => [...base.all, 'history', profileId] as const,
};
