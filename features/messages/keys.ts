// The only place message query keys are constructed.
//
// The root must stay `messages`: lib/queryClient.ts keeps every key starting
// with it out of the persisted cache (`NEVER_PERSISTED`), which is what stops
// a force-quit from restoring conversation content. Renaming the root would
// silently start writing messages to disk.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('messages');

export const messageKeys = {
  ...base,
  /** The people this user has a conversation with. */
  conversations: (userId: string) => [...base.all, 'conversations', userId] as const,
  /** One conversation, oldest message first. */
  thread: (userId: string, otherUserId: string) =>
    [...base.all, 'thread', userId, otherUserId] as const,
  /** Who has sent this user a message they have not read yet. */
  unread: (userId: string) => [...base.all, 'unread', userId] as const,
};
