// Live messages, through the shared bridge.
//
// Before ONE-18 there were two subscriptions on this stream — AppContext
// re-reading the unread count, and app/messages.tsx hydrating rows into the
// open thread's local state — both passing a raw `['messages']` key. This is
// the one that replaces them, mounted once for the signed-in user.
//
// The cache writes are the functions in ./cache, exported so the tests pin
// the once-only rule without a socket.

import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useRealtimeSync, type RealtimeRow } from '../../lib/realtimeBridge';
import { fetchMessageById, hydrateMessageRow } from './api';
import { addMessageToThread, addUnreadSender } from './cache';
import { messageKeys } from './keys';
import type { Message } from './types';

/**
 * Fold an INSERT addressed to this user into the cache.
 *
 * A plain text row renders as it arrives. A row that shares a post or a
 * profile is re-read with its joins first, as the thread fetch would have
 * returned it — without them the preview would render empty.
 */
export const applyIncomingMessage = (
  queryClient: QueryClient,
  userId: string,
  row: RealtimeRow,
): boolean => {
  const id = typeof row.id === 'string' ? row.id : undefined;
  const senderId = typeof row.sender_id === 'string' ? row.sender_id : undefined;
  if (!id || !senderId) return false;

  // The partner is whoever is not this user; a message to oneself files
  // under oneself.
  const otherUserId = senderId === userId ? String(row.receiver_id ?? userId) : senderId;

  if (senderId !== userId && row.seen !== true) addUnreadSender(queryClient, userId, senderId);

  const needsJoins = Boolean(row.shared_post_id || row.shared_profile_id);
  if (!needsJoins) {
    addMessageToThread(queryClient, userId, otherUserId, hydrateMessageRow(row) as Message);
  } else {
    fetchMessageById(id).then((message) => {
      if (message) addMessageToThread(queryClient, userId, otherUserId, message);
      else queryClient.invalidateQueries({ queryKey: messageKeys.thread(userId, otherUserId) });
    });
  }

  // Someone new, or someone moving to the top: the list order comes from the
  // server's latest-message timestamps, so re-read it rather than guess.
  queryClient.invalidateQueries({ queryKey: messageKeys.conversations(userId) });
  return true;
};

/**
 * Keep the signed-in user's conversations, threads and unread state current.
 *
 * Filtered to messages addressed to this user. Their own outgoing messages
 * reach the thread through the send mutation; if one arrives here as well it
 * lands on the same id and is merged, not duplicated.
 */
export const useMessagesRealtime = (userId: string | undefined): void => {
  const queryClient = useQueryClient();

  useRealtimeSync({
    table: 'messages',
    filter: `receiver_id=eq.${userId ?? ''}`,
    queryKey: messageKeys.all,
    enabled: Boolean(userId),

    onInsert: (row) => (userId ? applyIncomingMessage(queryClient, userId, row) : false),

    // An update is `seen` flipping, here or on another device. Only the
    // unread set cares, and it is cheap to re-read.
    onUpdate: () => {
      queryClient.invalidateQueries({ queryKey: messageKeys.unread(userId ?? '') });
      return true;
    },
  });
};
