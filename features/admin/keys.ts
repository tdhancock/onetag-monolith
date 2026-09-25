// The only place admin query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('admin');

export const adminKeys = {
  ...base,
  /** Whether this account is an admin. */
  isAdmin: (authUserId: string) => [...base.all, 'isAdmin', authUserId] as const,
};
