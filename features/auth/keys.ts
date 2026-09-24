// The only place auth query keys are constructed.
//
// The root must stay `auth`: lib/queryClient.ts keeps every key starting with
// it out of the persisted cache (`NEVER_PERSISTED`), so a session never
// outlives the process on disk.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('auth');

export const authKeys = {
  ...base,
  /** The signed-in account's auth user id, or null when signed out. */
  session: () => [...base.all, 'session'] as const,
};
