// Pure Supabase access for the comments domain.
//
// Moved out of the old shared service module in ONE-14. A comment's
// notifications, to the post's author and to anyone it @mentions, are written
// by the database from the comment itself (ONE-107), so nothing here sends
// them.

import { supabase } from '../../services/supabase.native';
import { threadComments } from './thread';
import type { Comment } from './types';
import type { ProfileId } from '../../types';

/**
 * What a post's comments are read with: each comment's author, its like
 * count, and whether the viewer is among the likes (`viewer_like`, narrowed
 * to them). One request for the whole list: each row used to ask for its own
 * likes, two requests a comment.
 */
export const COMMENT_SELECT =
    '*, profiles!user_id(username, avatar_url), like_count:comment_likes(count), viewer_like:comment_likes(user_id)';

/** Narrows `viewer_like` to nobody, when nobody is viewing. */
const NO_VIEWER = '00000000-0000-0000-0000-000000000000';

const likeCount = (embed: unknown): number => {
    const first = Array.isArray(embed) ? (embed[0] as { count?: unknown } | undefined) : undefined;
    return Number(first?.count) || 0;
};

/**
 * A post's comments as threads: newest first, each with its replies beneath
 * it, oldest first (see ./thread), each with its likes as the viewer sees
 * them.
 */
export const getCommentsForPost = async (postId: string, viewerId?: ProfileId): Promise<Comment[]> => {
    const { data, error } = await supabase
        .from('comments')
        .select(COMMENT_SELECT)
        .eq('post_id', postId)
        .eq('viewer_like.user_id', viewerId ?? NO_VIEWER)
        .order('created_at', { ascending: false });

    if (error) return [];
    return threadComments((data || []).map((c: any) => ({
        id: c.id,
        userId: c.user_id,
        username: c.profiles.username,
        avatar: c.profiles.avatar_url,
        text: c.content,
        timestamp: new Date(c.created_at),
        likes: likeCount(c.like_count),
        isLiked: Array.isArray(c.viewer_like) && c.viewer_like.length > 0,
        parentId: c.parent_id ?? null,
        replies: [],
    })));
};

/**
 * Comment on a post, or reply to one of its comments. The database files a
 * reply to a reply under the comment that reply answers.
 */
export async function addComment(postId: string, userId: ProfileId, content: string, parentId?: string | null) {
  const { data, error } = await supabase
    .from('comments')
    .insert([{ post_id: postId, user_id: userId, content, parent_id: parentId ?? null }])
    .select('*, profiles!user_id(username, avatar_url)')
    .single();

  if (error) {
    console.error('Failed to add a comment:', error.message || error);
    throw error;
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
