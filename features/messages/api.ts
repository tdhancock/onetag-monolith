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
 * The shared-post join selects the counts `mapPostData` reads; the profile
 * join selects exactly what a `SimpleUser` needs.
 */
export const MESSAGE_SELECT_QUERY = `
    *,
    sharedPost:shared_post_id (
      *,
      profiles (username, avatar_url, full_name, is_verified),
      likes(count),
      comments(count),
      reposts(count)
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

/** One conversation between two users, oldest first. */
export const fetchThread = async (userId: string, otherUserId: string): Promise<Message[]> => {
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_SELECT_QUERY)
    .or(
      `and(sender_id.eq.${userId},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${userId})`,
    )
    .order('created_at', { ascending: true });

  if (error) throw error;
  return linkReplies((data || []).map(hydrateMessageRow));
};

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

/** Everyone the user has exchanged a message with, most recent conversation first. */
export const getChatListUsers = async (userId: string): Promise<Conversation[]> => {
  const { data: messages, error: messagesError } = await supabase
    .from('messages')
    .select('sender_id, receiver_id, created_at')
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .order('created_at', { ascending: false });

  if (messagesError) throw messagesError;

  // Newest first, so the first time a partner appears is their latest message.
  const latestMessageTimestamps = new Map<string, string>();
  for (const message of messages || []) {
    const partnerId = message.sender_id === userId ? message.receiver_id : message.sender_id;
    if (!latestMessageTimestamps.has(partnerId)) {
      latestMessageTimestamps.set(partnerId, message.created_at);
    }
  }

  if (latestMessageTimestamps.size === 0) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name, username, avatar_url, is_verified')
    .in('id', Array.from(latestMessageTimestamps.keys()));

  if (profilesError) throw profilesError;

  const users: Conversation[] = (profiles || []).map((u: any) => ({
    id: u.id,
    name: u.full_name,
    username: u.username,
    avatar: u.avatar_url,
    isVerified: u.is_verified,
  }));

  // A fallback of 0 keeps a missing timestamp from producing NaN in the sort.
  const timeOf = (id: string) => new Date(latestMessageTimestamps.get(id) || 0).getTime();
  return users.sort((a, b) => timeOf(b.id) - timeOf(a.id));
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
