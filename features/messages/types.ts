// Domain types for direct messages.
//
// `Message` stays in the repo-root `types.ts`, where its hydrated fields —
// `sharedPost`, `sharedUser`, `repliedStory`, `repliedMessage` — are declared
// beside the row columns. Re-exported so callers take everything about the
// domain from `features/messages`.

import type { Message, Post, SimpleUser } from '../../types';

export type { Message };

/** A conversation's latest message, as the Messages list previews it. */
export interface ConversationPreview {
  text: string | null;
  type: Message['type'];
  senderId: string;
  sentAt: string;
}

/** Someone the user has a conversation with, most recent first in the list. */
export interface Conversation extends SimpleUser {
  /** Absent only for a row written into the cache before the list's first read. */
  lastMessage?: ConversationPreview | null;
}

/** What a send needs. The sender is always the signed-in user. */
export interface SendMessageInput {
  receiverId: string;
  text?: string | null;
  /** A post shared into the conversation. */
  post?: Post | null;
  /** A profile shared into the conversation. */
  user?: SimpleUser | null;
  repliedStoryId?: string | null;
  /** The message being replied to, carried so the optimistic row can show it. */
  replyTo?: Message | null;
}
