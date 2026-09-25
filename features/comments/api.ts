// Pure Supabase access for the comments domain.
//
// Moved out of the old shared service module in ONE-14. The notification and
// mention side effects come from `services/notificationWrites.ts`, which
// ONE-17 consolidated out of the three copies that briefly existed here, in
// posts and in profiles.

import { supabase } from '../../services/supabase.native';
import { notifyPostAuthor, notifyMentionedUsers } from '../../services/notificationWrites';
import type { Comment } from './types';
import type { ProfileId } from '../../types';

export const getCommentsForPost = async (postId: string): Promise<Comment[]> => {
    const { data, error } = await supabase
        .from('comments')
        .select('*, profiles!user_id(username, avatar_url)')
        .eq('post_id', postId)
        .order('created_at', { ascending: false });

    if (error) return [];
    return (data || []).map((c: any) => ({
        id: c.id,
        userId: c.user_id,
        username: c.profiles.username,
        avatar: c.profiles.avatar_url,
        text: c.content,
        timestamp: new Date(c.created_at),
        likes: 0, // Simplified for now
        isLiked: false, // Simplified for now
        replies: [], // Simplified for now
    }));
};

export async function addComment(postId: string, userId: ProfileId, content: string) {
  const { data, error } = await supabase
    .from('comments')
    .insert([{ post_id: postId, user_id: userId, content }])
    .select('*, profiles!user_id(username, avatar_url)')
    .single();

  if (error) {
    console.error("Yorum ekleme hatası:", error.message || error);
    throw error;
  }

  if (data) {
    await notifyPostAuthor(postId, userId, 'comment', {
      commentId: data.id,
      content: content.substring(0, 50),
    });
    await notifyMentionedUsers(content, userId, postId, data.id);
  }

  return data;
}

/**
 * Delete a comment. RLS allows it only when the account owns the comment's
 * author profile — whichever of its profiles wrote it — so no author filter
 * is needed here. It used to filter on the auth user id, which stopped
 * matching once a profile id could differ from it (ONE-22).
 */
export const deleteComment = async (commentId: string): Promise<void> => {
    const { error } = await supabase
        .from('comments')
        .delete()
        .eq('id', commentId);

    if (error) {
        throw error;
    }
};

/** Whether `viewerId` — the profile being acted as — likes this comment. */
export const isCommentLikedByUser = async (commentId: string, viewerId: ProfileId): Promise<boolean> => {
    const { data, error } = await supabase.from('comment_likes').select('*').match({ comment_id: commentId, user_id: viewerId }).maybeSingle();
    return !!data && !error;
};

export const getCommentLikesCount = async (commentId: string): Promise<number> => {
    const { count, error } = await supabase.from('comment_likes').select('*', { count: 'exact', head: true }).eq('comment_id', commentId);
    return error ? 0 : count || 0;
};

/** Like or unlike a comment as `viewerId`, the profile being acted as. */
export const toggleCommentLike = async (commentId: string, viewerId: ProfileId): Promise<boolean> => {
    const isLiked = await isCommentLikedByUser(commentId, viewerId);

    if (isLiked) {
        await supabase.from('comment_likes').delete().match({ comment_id: commentId, user_id: viewerId });
        return false;
    } else {
        await supabase.from('comment_likes').insert({ comment_id: commentId, user_id: viewerId });
        return true;
    }
};
