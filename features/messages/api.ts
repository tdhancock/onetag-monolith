// Pure Supabase access for direct messages.
//
// Moved out of the old shared service module, and the thread fetch out of
// `app/messages.tsx` where it ran inline (ONE-18). The client-side hydration
// of `sharedPost` / `sharedUser` / `repliedMessage` comes with it unchanged:
// rows are joined, mapped onto the render shape, then linked to the message
// they reply to.

import { supabase } from '../../services/supabase.native';
import { mapPostData } from '../../services/postRows';
import type { Conversation, Message } from './types';

/**
 * A message row plus the post or profile it shares.
 *
 * The shared-post join selects the totals `mapPostData` reads (ONE-109); the profile
 * join selects exactly what a `SimpleUser` needs.
 *
 * The post's author names the column it follows, as every embed does:
 * `likes` and `reposts` also link posts to profiles, and a bare `profiles`
 * made the API refuse the whole read as ambiguous, so no thread loaded
 * (found in ONE-110).
 */
export const MESSAGE_SELECT_QUERY = `
    *,
    sharedPost:shared_post_id (
      *,
      profiles!user_id (username, avatar_url, full_name, is_verified),
      stats:explore_scores(likes, comments, reposts)
    ),
    sharedUser:shared_profile_id(id, username, full_name, avatar_url, is_verified, bio)
`;

/** Map a joined row onto the render shape. `repliedMessage` is linked separately. */
export const hydrateMessageRow = (row: any): Message => {
  const message: Message = {
    ...row,
    sharedPost: null,
    sharedUser: null,
    repliedStory: null,
    repliedMessage: null,
  };

  if (row.sharedPost) message.sharedPost = mapPostData(row.sharedPost);
  if (row.sharedUser) {
    message.sharedUser = {
      id: row.sharedUser.id,
      name: row.sharedUser.full_name,
      username: row.sharedUser.username,
      avatar: row.sharedUser.avatar_url,
      isVerified: row.sharedUser.is_verified,
      bio: row.sharedUser.bio,
    };
  }

  return message;
};

/** Point each reply at the message it answers, when that message is in the list. */
export const linkReplies = (messages: Message[]): Message[] =>
  messages.map((message) =>
    message.reply_to
      ? { ...message, repliedMessage: messages.find((m) => m.id === message.reply_to) || null }
      : message,
  );

/** How many messages a thread opens with, and how many each scroll back adds. */
export const THREAD_PAGE_SIZE = 100;

/** The most `messages_thread` returns to one request. */
const THREAD_MAX_REQUEST = 200;

/** Where a page of a thread ends: the oldest message already showing. */
export type ThreadCursor = Pick<Message, 'id' | 'created_at'>;

/**
 * Up to `limit` messages of a conversation from before `before`, newest first.
 *
 * `messages_thread` pages in the database. The whole conversation in one read
 * stopped at the API's 1,000 rows, oldest first, so a long thread lost its
 * newest messages (ONE-110).
 */
const fetchThreadPage = async (
  userId: string,
  otherUserId: string,
  before: ThreadCursor | null,
  limit: number,
): Promise<Message[]> => {
  const { data, error } = await supabase
    .rpc('messages_thread', {
      p_profile: userId,
      p_other: otherUserId,
      p_before: before?.created_at ?? null,
      p_before_id: before?.id ?? null,
      p_limit: limit,
    })
    .select(MESSAGE_SELECT_QUERY)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (error) throw error;
  return ((data || []) as any[]).map(hydrateMessageRow);
};

/**
 * A conversation's newest messages, oldest first.
 *
 * `depth` is how many: a page when the thread opens, and as many as it holds
 * when it refetches, so a refetch never takes away the older messages
 * someone scrolled back to.
 */
export const fetchThread = async (
  userId: string,
  otherUserId: string,
  depth: number = THREAD_PAGE_SIZE,
): Promise<Message[]> => {
  const newestFirst: Message[] = [];
  let before: ThreadCursor | null = null;
  while (newestFirst.length < depth) {
    const limit = Math.min(depth - newestFirst.length, THREAD_MAX_REQUEST);
    const page = await fetchThreadPage(userId, otherUserId, before, limit);
    newestFirst.push(...page);
    if (page.length < limit) break;
    before = page[page.length - 1];
  }
  return linkReplies(newestFirst.reverse());
};

/** The page of a conversation before `before`, oldest first — what scrolling back loads. */
export const fetchOlderMessages = async (
  userId: string,
  otherUserId: string,
  before: ThreadCursor,
): Promise<Message[]> => (await fetchThreadPage(userId, otherUserId, before, THREAD_PAGE_SIZE)).reverse();

/** One message by id, hydrated — for a realtime insert that shares a post or profile. */
export const fetchMessageById = async (messageId: string): Promise<Message | undefined> => {
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_SELECT_QUERY)
    .eq('id', messageId)
    .maybeSingle();

  if (error || !data) return undefined;
  return hydrateMessageRow(data);
};

/**
 * Everyone the user has exchanged a message with, most recent conversation first.
 *
 * `chat_list` finds each partner and their latest message in the database.
 * Reading the messages here to do it stopped at the API's 1,000 rows, so a
 * conversation older than that sank as if it had no messages (ONE-110).
 */
export const getChatListUsers = async (userId: string): Promise<Conversation[]> => {
  const { data, error } = await supabase
    .rpc('chat_list', { p_profile: userId })
    .select('id, full_name, username, avatar_url, is_verified, last_message_at')
    .order('last_message_at', { ascending: false });

  if (error) throw error;

  return ((data || []) as any[]).map((u: any) => ({
    id: u.id,
    name: u.full_name,
    username: u.username,
    avatar: u.avatar_url,
    isVerified: u.is_verified,
  }));
};

/**
 * The ids of everyone with a message to this user they have not read.
 *
 * The tab badge counts senders, not messages — three unread from one person
 * is one conversation to open — so the unread state is this set.
 */
export const fetchUnreadSenderIds = async (userId: string): Promise<string[]> => {
  const { data, error } = await supabase
    .from('messages')
    .select('sender_id')
    .eq('receiver_id', userId)
    .eq('seen', false);

  if (error) throw error;
  return Array.from(new Set((data || []).map((m: { sender_id: string }) => m.sender_id)));
};

export const sendMessage = async ({
  sender_id,
  receiver_id,
  text,
  post,
  user,
  replied_story_id,
  reply_to,
}: {
  sender_id: string;
  receiver_id: string;
  text?: string | null;
  post?: { id: string } | null;
  user?: { id: string } | null;
  replied_story_id?: string | null;
  reply_to?: string | null;
}): Promise<Message> => {
  let type: Message['type'] = 'text';
  if (post) type = 'post_share';
  if (user) type = 'profile_share';
  if (replied_story_id) type = 'story_reply';

  const { data, error } = await supabase
    .from('messages')
    .insert({
      sender_id,
      receiver_id,
      text,
      type,
      shared_post_id: post?.id,
      shared_profile_id: user?.id,
      replied_story_id,
      reply_to,
    })
    .select()
    .single();

  if (error) throw error;
  return data as Message;
};

/** Mark everything one sender sent this user as read. */
export const markMessagesAsRead = async (receiverId: string, senderId: string): Promise<boolean> => {
  const { error } = await supabase
    .from('messages')
    .update({ seen: true })
    .match({ receiver_id: receiverId, sender_id: senderId, seen: false });
  return !error;
};

/** Mark every unread message to this user as read. */
export const markAllMessagesAsRead = async (receiverId: string): Promise<boolean> => {
  const { error } = await supabase
    .from('messages')
    .update({ seen: true })
    .eq('receiver_id', receiverId)
    .eq('seen', false);

  if (error) {
    console.error('Error marking all messages as read:', error.message || error);
    return false;
  }
  return true;
};

export const deleteChatHistory = async (userId1: string, userId2: string): Promise<void> => {
  const { error } = await supabase.rpc('delete_chat_history', { user_id_1: userId1, user_id_2: userId2 });
  if (error) throw error;
};

export const deleteConversationForBothSides = async (myId: string, otherId: string): Promise<boolean> => {
  const { error } = await supabase.rpc('delete_conversation', {
    user1: myId,
    user2: otherId,
  });
  if (error) {
    console.error('Error deleting conversation:', error);
    return false;
  }
  return true;
};
