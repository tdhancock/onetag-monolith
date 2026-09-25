// Read hooks for direct messages.
//
// None of these is persisted: every key is under `messages`, which
// lib/queryClient.ts keeps out of the on-disk cache, so a cold start always
// fetches fresh.

import { useQuery } from '@tanstack/react-query';
import { fetchThread, fetchUnreadSenderIds, getChatListUsers } from './api';
import { messageKeys } from './keys';
import type { Conversation, Message } from './types';
import type { ProfileId } from '../../types';

/** Everyone the user has a conversation with, most recent first. */
export const useConversationsQuery = (userId: ProfileId | undefined) =>
  useQuery<Conversation[]>({
    queryKey: messageKeys.conversations(userId ?? ''),
    queryFn: () => getChatListUsers(userId!),
    enabled: Boolean(userId),
  });

/** One conversation, oldest message first. */
export const useThreadQuery = (userId: ProfileId | undefined, otherUserId: string | undefined) =>
  useQuery<Message[]>({
    queryKey: messageKeys.thread(userId ?? '', otherUserId ?? ''),
    queryFn: () => fetchThread(userId!, otherUserId!),
    enabled: Boolean(userId && otherUserId),
  });

const unreadQuery = (userId: string | undefined) => ({
  queryKey: messageKeys.unread(userId ?? ''),
  queryFn: () => fetchUnreadSenderIds(userId!),
  enabled: Boolean(userId),
});

/** How many conversations have something unread — the message half of the badge. */
export const unreadMessageCountOf = (senders: string[] | undefined): number => senders?.length ?? 0;

const toSet = (senders: string[]): Set<string> => new Set(senders);

/**
 * The number on the tab badge and the inbox icon.
 *
 * `select` narrows the subscription to the count, as the notifications badge
 * does, so a component reading it re-renders only when the count moves.
 */
export const useUnreadMessageCount = (userId: ProfileId | undefined): number => {
  const { data } = useQuery<string[], Error, number>({
    ...unreadQuery(userId),
    select: unreadMessageCountOf,
  });
  return data ?? 0;
};

/** Which conversations carry an unread dot. */
export const useUnreadChats = (userId: ProfileId | undefined): Set<string> => {
  const { data } = useQuery<string[], Error, Set<string>>({
    ...unreadQuery(userId),
    select: toSet,
  });
  return data ?? EMPTY;
};

const EMPTY: Set<string> = new Set();
