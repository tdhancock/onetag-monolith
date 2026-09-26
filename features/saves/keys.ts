// The only place save query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('saves');

export const saveKeys = {
  ...base,
  /** Every save one profile has made. Keyed by the profile: a switch reads the other's. */
  mine: (profileId: string) => base.list({ profileId }),
  /** The same saves with their targets ready to list (ONE-43). Beneath `all`, so a toggle re-reads it. */
  items: (profileId: string) => [...base.all, 'items', profileId] as const,
};
