// Write hooks for direct messages.
//
// Sending is optimistic: the message appears at the bottom of the thread the
// moment the user taps Send, with a temporary id that `MessageStatus` renders
// as pending. The server row replaces it in place on success
// (`reconcileSentMessage`), and it is removed on error.
//
// Read state is optimistic too, so the badge drops as the conversation opens
// rather than a round-trip later.
//
// The cycles are plain option builders, as in features/notifications, so the
// tests drive what ships against a real QueryClient without a renderer.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import {
  deleteConversationForBothSides,
  markAllMessagesAsRead,
  markMessagesAsRead,
  sendMessage,
} from './api';
import { reconcileSentMessage } from './cache';
import { messageKeys } from './keys';
import type { Conversation, Message, SendMessageInput } from './types';
import type { ProfileId } from '../../types';

// ─── Send ─────────────────────────────────────────────────────────────

interface SendContext {
  tempId: string;
}

let tempCounter = 0;

/** A temporary id no server row can have. `isPendingMessage` keys off the prefix. */
const nextTempId = () => `temp-message-${Date.now()}-${tempCounter++}`;

const messageTypeOf = (input: SendMessageInput): Message['type'] => {
  if (input.repliedStoryId) return 'story_reply';
  if (input.user) return 'profile_share';
  if (input.post) return 'post_share';
  return 'text';
};

/** The send cycle, as plain mutation options. */
export const sendMessageOptions = (queryClient: QueryClient, userId: string | undefined) => ({
  mutationFn: (input: SendMessageInput): Promise<Message> => {
    if (!userId) return Promise.reject(new Error('You must be signed in.'));

    return sendMessage({
      sender_id: userId,
      receiver_id: input.receiverId,
      text: input.text ?? null,
      post: input.post ?? null,
      user: input.user ?? null,
      replied_story_id: input.repliedStoryId ?? null,
      reply_to: input.replyTo?.id ?? null,
    });
  },

  onMutate: async (input: SendMessageInput): Promise<SendContext> => {
    const tempId = nextTempId();
    if (!userId) return { tempId };

    const key = messageKeys.thread(userId, input.receiverId);
    await queryClient.cancelQueries({ queryKey: key });

    const optimistic: Message = {
      id: tempId,
      sender_id: userId,
      receiver_id: input.receiverId,
      text: input.text ?? '',
      created_at: new Date().toISOString(),
      type: messageTypeOf(input),
      shared_post_id: input.post?.id ?? null,
      shared_profile_id: input.user?.id ?? null,
      replied_story_id: input.repliedStoryId ?? null,
      reply_to: input.replyTo?.id ?? null,
      sharedPost: input.post ?? null,
      sharedUser: input.user ?? null,
      repliedStory: null,
      repliedMessage: input.replyTo ?? null,
    };

    // Only into a thread that has loaded — see features/messages/cache.ts.
    queryClient.setQueryData<Message[] | undefined>(key, (thread) => thread && [...thread, optimistic]);
    return { tempId };
  },

  onSuccess: (serverRow: Message, input: SendMessageInput, context?: SendContext) => {
    if (!userId || !context) return;

    queryClient.setQueryData<Message[] | undefined>(
      messageKeys.thread(userId, input.receiverId),
      (thread) => thread && reconcileSentMessage(thread, context.tempId, serverRow),
    );
  },

  onError: (_error: unknown, input: SendMessageInput, context?: SendContext) => {
    if (!userId || !context) return;

    queryClient.setQueryData<Message[] | undefined>(
      messageKeys.thread(userId, input.receiverId),
      (thread) => thread?.filter((m) => m.id !== context.tempId),
    );
  },

  // A first message to someone new puts them in the conversation list, and
  // any message moves its conversation to the top.
  onSettled: () =>
    queryClient.invalidateQueries({ queryKey: messageKeys.conversations(userId ?? '') }),
});

/** Send a message from the signed-in user. */
export const useSendMessage = (userId: ProfileId | undefined) => {
  const queryClient = useQueryClient();
  return useMutation(sendMessageOptions(queryClient, userId));
};

// ─── Read state ───────────────────────────────────────────────────────

interface UnreadSnapshot {
  previous: string[] | undefined;
}

const patchUnread = async (
  queryClient: QueryClient,
  userId: string | undefined,
  patch: (senders: string[]) => string[],
): Promise<UnreadSnapshot> => {
  const key = messageKeys.unread(userId ?? '');
  await queryClient.cancelQueries({ queryKey: key });
  const previous = queryClient.getQueryData<string[]>(key);
  queryClient.setQueryData<string[] | undefined>(key, (senders) => senders && patch(senders));
  return { previous };
};

const restoreUnread = (queryClient: QueryClient, userId: string | undefined, snapshot?: UnreadSnapshot) => {
  if (!snapshot) return;
  queryClient.setQueryData(messageKeys.unread(userId ?? ''), snapshot.previous);
};

/** The open-a-conversation cycle: everything from one sender becomes read. */
export const markChatReadOptions = (queryClient: QueryClient, userId: string | undefined) => ({
  mutationFn: async (senderId: string): Promise<void> => {
    if (!userId) throw new Error('You must be signed in.');
    if (!(await markMessagesAsRead(userId, senderId))) {
      throw new Error("Couldn't mark messages as read.");
    }
  },

  onMutate: (senderId: string) =>
    patchUnread(queryClient, userId, (senders) => senders.filter((id) => id !== senderId)),

  onError: (_error: unknown, _senderId: string, snapshot?: UnreadSnapshot) =>
    restoreUnread(queryClient, userId, snapshot),

  onSettled: () => queryClient.invalidateQueries({ queryKey: messageKeys.unread(userId ?? '') }),
});

/** The open-the-inbox cycle: everything becomes read. */
export const markAllMessagesReadOptions = (queryClient: QueryClient, userId: string | undefined) => ({
  mutationFn: async (): Promise<void> => {
    if (!userId) throw new Error('You must be signed in.');
    if (!(await markAllMessagesAsRead(userId))) {
      throw new Error("Couldn't mark messages as read.");
    }
  },

  onMutate: () => patchUnread(queryClient, userId, () => []),

  onError: (_error: unknown, _variables: void, snapshot?: UnreadSnapshot) =>
    restoreUnread(queryClient, userId, snapshot),

  onSettled: () => queryClient.invalidateQueries({ queryKey: messageKeys.unread(userId ?? '') }),
});

/** Mark one conversation read. */
export const useMarkChatRead = (userId: ProfileId | undefined) => {
  const queryClient = useQueryClient();
  return useMutation(markChatReadOptions(queryClient, userId));
};

/** Mark every conversation read. */
export const useMarkAllMessagesRead = (userId: ProfileId | undefined) => {
  const queryClient = useQueryClient();
  return useMutation(markAllMessagesReadOptions(queryClient, userId));
};

// ─── Delete ───────────────────────────────────────────────────────────

interface ConversationsSnapshot {
  previous: Conversation[] | undefined;
}

/** The delete-for-both-sides cycle, as plain mutation options. */
export const deleteConversationOptions = (queryClient: QueryClient, userId: string | undefined) => ({
  mutationFn: async (otherUserId: string): Promise<void> => {
    if (!userId) throw new Error('You must be signed in.');
    if (!(await deleteConversationForBothSides(userId, otherUserId))) {
      throw new Error('Failed to delete conversation.');
    }
  },

  onMutate: async (otherUserId: string): Promise<ConversationsSnapshot> => {
    const key = messageKeys.conversations(userId ?? '');
    await queryClient.cancelQueries({ queryKey: key });
    const previous = queryClient.getQueryData<Conversation[]>(key);
    queryClient.setQueryData<Conversation[] | undefined>(key, (list) =>
      list?.filter((user) => user.id !== otherUserId),
    );
    return { previous };
  },

  onError: (_error: unknown, _otherUserId: string, snapshot?: ConversationsSnapshot) => {
    if (!snapshot) return;
    queryClient.setQueryData(messageKeys.conversations(userId ?? ''), snapshot.previous);
  },

  onSuccess: (_data: void, otherUserId: string) => {
    queryClient.removeQueries({ queryKey: messageKeys.thread(userId ?? '', otherUserId) });
  },

  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: messageKeys.conversations(userId ?? '') });
    queryClient.invalidateQueries({ queryKey: messageKeys.unread(userId ?? '') });
  },
});

/** Delete a conversation for both participants. */
export const useDeleteConversation = (userId: ProfileId | undefined) => {
  const queryClient = useQueryClient();
  return useMutation(deleteConversationOptions(queryClient, userId));
};
