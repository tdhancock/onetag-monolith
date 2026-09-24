// The only place notification query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('notifications');

export const notificationKeys = {
  ...base,
  /** Everything addressed to one user, newest first. */
  forUser: (userId: string) => [...base.all, 'user', userId] as const,
};
