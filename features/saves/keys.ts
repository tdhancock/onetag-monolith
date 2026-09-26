// The only place save query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('saves');

export const saveKeys = {
  ...base,
  /** Every save one profile has made. Keyed by the profile: a switch reads the other's. */
  mine: (profileId: string) => base.list({ profileId }),
};
