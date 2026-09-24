// Cache writes for a conversation thread.
//
// A message the user sends reaches the thread by up to three paths — the
// optimistic append, the mutation's response, and a realtime INSERT — and must
// end up there exactly once, in the place it was first shown. Every path goes
// through these functions, so that rule lives in one place and the tests pin
// it without a socket or a renderer.
//
// None of them creates a thread that has not loaded: writing a list marks it
// fresh, and the real fetch would never run (ONE-17 hit exactly this).

import type { QueryClient } from '@tanstack/react-query';
import { messageKeys } from './keys';
import type { Message } from './types';

/** True for a message that exists only on this device, awaiting the server. */
export const isPendingMessage = (message: Pick<Message, 'id'>): boolean =>
  message.id.startsWith('temp-');

/** Link a message to the one it replies to, if that one is in the thread. */
const withReply = (thread: Message[], message: Message): Message =>
  message.reply_to && !message.repliedMessage
    ? { ...message, repliedMessage: thread.find((m) => m.id === message.reply_to) || null }
    : message;

/**
 * Append a message to the end of a thread, once.
 *
 * A thread is oldest-first, so a new message goes at the bottom. If a row
 * with the same id is already there, its fields are merged in place instead:
 * the mutation's response beat the realtime echo, or the other way round.
 */
export const appendToThread = (thread: Message[], message: Message): Message[] => {
  const index = thread.findIndex((m) => m.id === message.id);
  if (index === -1) return [...thread, withReply(thread, message)];

  const next = [...thread];
  next[index] = { ...thread[index], ...message, repliedMessage: thread[index].repliedMessage ?? message.repliedMessage };
  return next;
};

/**
 * Swap the optimistic row for the server's, where the optimistic row sits.
 *
 * Replacing in place is what keeps the message from jumping when the server's
 * `created_at` differs from the client's. If the realtime echo already put
 * the server row in the thread, that copy is dropped — the one the user has
 * been looking at stays.
 */
export const reconcileSentMessage = (
  thread: Message[],
  tempId: string,
  serverRow: Message,
): Message[] => {
  const tempIndex = thread.findIndex((m) => m.id === tempId);

  // The optimistic row is gone (the thread was refetched meanwhile): fall
  // back to an ordinary once-only append.
  if (tempIndex === -1) return appendToThread(thread, serverRow);

  const optimistic = thread[tempIndex];
  const settled: Message = {
    ...optimistic,
    ...serverRow,
    // The server row carries no joins; the optimistic one already has them.
    sharedPost: serverRow.sharedPost ?? optimistic.sharedPost,
    sharedUser: serverRow.sharedUser ?? optimistic.sharedUser,
    repliedStory: serverRow.repliedStory ?? optimistic.repliedStory,
    repliedMessage: optimistic.repliedMessage,
  };

  return thread
    .map((m, i) => (i === tempIndex ? settled : m))
    .filter((m, i) => i === tempIndex || m.id !== serverRow.id);
};

/** Put a message into its cached thread, if that thread has loaded. */
export const addMessageToThread = (
  queryClient: QueryClient,
  userId: string,
  otherUserId: string,
  message: Message,
): void => {
  queryClient.setQueryData<Message[] | undefined>(
    messageKeys.thread(userId, otherUserId),
    (thread) => thread && appendToThread(thread, message),
  );
};

/** Record a new unread sender, if the unread set has loaded. */
export const addUnreadSender = (queryClient: QueryClient, userId: string, senderId: string): void => {
  queryClient.setQueryData<string[] | undefined>(messageKeys.unread(userId), (senders) =>
    senders && !senders.includes(senderId) ? [...senders, senderId] : senders,
  );
};
