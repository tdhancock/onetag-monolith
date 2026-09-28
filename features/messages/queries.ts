// Read hooks for direct messages.
//
// None of these is persisted: every key is under `messages`, which
// lib/queryClient.ts keeps out of the on-disk cache, so a cold start always
// fetches fresh.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchThread, fetchUnreadSenderIds, getChatListUsers, THREAD_PAGE_SIZE } from './api';
import { isPendingMessage } from './cache';
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

/**
 * How far back a thread's refetch reads: as many server messages as the
 * thread holds, and never less than a page.
 */
export const loadedDepth = (thread: Message[] | undefined): number =>
  Math.max(THREAD_PAGE_SIZE, thread?.filter((m) => !isPendingMessage(m)).length ?? 0);

/**
 * One conversation, oldest message first: its newest page when it opens
 * (ONE-110). `useOlderMessages` adds the pages before it, and a refetch reads
 * back as far as they reach, so it never takes them away.
 */
export const useThreadQuery = (userId: ProfileId | undefined, otherUserId: string | undefined) => {
  const queryClient = useQueryClient();
  const queryKey = messageKeys.thread(userId ?? '', otherUserId ?? '');
  return useQuery<Message[]>({
    queryKey,
    queryFn: () => fetchThread(userId!, otherUserId!, loadedDepth(queryClient.getQueryData<Message[]>(queryKey))),
    enabled: Boolean(userId && otherUserId),
  });
};

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
