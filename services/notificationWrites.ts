// Writing a notification row.
//
// Three feature folders send notifications — a like or repost on a post, a
// new follower, a comment or a mention — and each had inlined its own copy of
// this insert. They could not share one through `features/notifications`,
// because a feature's `api.ts` may not import another feature
// (features/README.md), so the shared copy lives here, where any of them can
// reach it. Consolidated in ONE-17.
//
// Every failure is logged and swallowed. A notification that does not arrive
// is never a reason to fail — or to roll back — the thing that triggered it:
// the like, the follow and the comment are already in the database.

import { supabase } from './supabase.native';

/** The kinds of notification the app sends today. */
export type NotificationType = 'like' | 'repost' | 'follow' | 'comment' | 'mention';

export interface NotificationInsert {
  senderId: string;
  receiverId: string;
  type: NotificationType;
  postId?: string | null;
  commentId?: string | null;
  storyId?: string | null;
  content?: string | null;
}

/** Insert one notification. Nobody is ever notified about their own action. */
export const sendNotification = async ({
  senderId,
  receiverId,
  type,
  postId = null,
  commentId = null,
  storyId = null,
  content = null,
}: NotificationInsert): Promise<void> => {
  if (!receiverId || receiverId === senderId) return;

  try {
    const { error } = await supabase.from('notifications').insert([
      {
        sender_id: senderId,
        receiver_id: receiverId,
        type,
        post_id: postId,
        comment_id: commentId,
        story_id: storyId,
        content,
      },
    ]);

    if (error) console.error(`Failed to send ${type} notification:`, error.message || error);
  } catch (error) {
    console.error(`Failed to send ${type} notification:`, (error as Error).message || error);
  }
};

/**
 * Notify a post's author, looking the author up from the post.
 *
 * Used by like, repost and comment, which all know the post rather than the
 * person.
 */
export const notifyPostAuthor = async (
  postId: string,
  senderId: string,
  type: NotificationType,
  extra: { commentId?: string | null; content?: string | null } = {},
): Promise<void> => {
  try {
    const { data: post } = await supabase
      .from('posts')
      .select('user_id')
      .eq('id', postId)
      .single();

    if (!post) return;

    await sendNotification({
      senderId,
      receiverId: post.user_id,
      type,
      postId,
      commentId: extra.commentId ?? null,
      content: extra.content ?? null,
    });
  } catch (error) {
    console.error(`Failed to send ${type} notification:`, (error as Error).message || error);
  }
};

/**
 * Notify everyone @mentioned in a piece of text, once each.
 *
 * A mention of somebody who does not exist, or of the author themselves, is
 * simply skipped.
 */
export const notifyMentionedUsers = async (
  content: string,
  senderId: string,
  postId: string,
  commentId: string | null = null,
): Promise<void> => {
  const mentions = content.match(/@(\w+)/g);
  if (!mentions) return;

  for (const username of new Set(mentions.map((m) => m.replace('@', '')))) {
    try {
      const { data: user } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username)
        .single();

      if (!user) continue;

      await sendNotification({
        senderId,
        receiverId: user.id,
        type: 'mention',
        postId,
        commentId,
        content: content.substring(0, 50),
      });
    } catch (error) {
      console.error('Failed to notify mentioned user:', (error as Error).message || error);
    }
  }
};
