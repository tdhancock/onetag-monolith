// Pure Supabase access for the comments domain.
//
// Moved out of `services/apiService.ts` in ONE-14. The implementations are
// unchanged except for the notification and mention side effects, which are
// inlined below rather than imported back from `apiService` — that module
// re-exports this one, so importing it would be a cycle. ONE-17 folds all
// three copies (here, posts, profiles) into a notifications feature.

import { supabase } from '../../services/supabase.native';
import type { Comment } from './types';

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

export async function addComment(postId: string, userId: string, content: string) {
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
    await notifyPostAuthorOfComment(postId, userId, data.id, content);
    await notifyMentionedUsers(content, userId, postId, data.id);
  }

  return data;
}

export const deleteComment = async (commentId: string): Promise<void> => {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
        throw new Error('User not authenticated');
    }

    const { error } = await supabase
        .from('comments')
        .delete()
        .eq('id', commentId)
        .eq('user_id', user.id);

    if (error) {
        throw error;
    }
};

export const isCommentLikedByUser = async (commentId: string): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data, error } = await supabase.from('comment_likes').select('*').match({ comment_id: commentId, user_id: user.id }).maybeSingle();
    return !!data && !error;
};

export const getCommentLikesCount = async (commentId: string): Promise<number> => {
    const { count, error } = await supabase.from('comment_likes').select('*', { count: 'exact', head: true }).eq('comment_id', commentId);
    return error ? 0 : count || 0;
};

export const toggleCommentLike = async (commentId: string): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("User not authenticated");
    
    const isLiked = await isCommentLikedByUser(commentId);

    if (isLiked) {
        await supabase.from('comment_likes').delete().match({ comment_id: commentId, user_id: user.id });
        return false;
    } else {
        await supabase.from('comment_likes').insert({ comment_id: commentId, user_id: user.id });
        return true;
    }
};


// ---------------------------------------------------------------------------
// Side effects
// ---------------------------------------------------------------------------
//
// Both are best-effort: a notification that does not arrive is no reason to
// fail a comment that the database already accepted.

const notifyPostAuthorOfComment = async (
    postId: string,
    senderId: string,
    commentId: string,
    content: string,
): Promise<void> => {
    try {
        const { data: post } = await supabase
            .from('posts')
            .select('user_id')
            .eq('id', postId)
            .single();

        if (!post || post.user_id === senderId) return;

        await supabase.from('notifications').insert([{
            sender_id: senderId,
            receiver_id: post.user_id,
            type: 'comment',
            post_id: postId,
            comment_id: commentId,
            content: content.substring(0, 50),
        }]);
    } catch (error) {
        console.error('Failed to send comment notification:', (error as Error).message || error);
    }
};

/** Tell anyone @mentioned in the comment. Each name is notified once. */
const notifyMentionedUsers = async (
    content: string,
    senderId: string,
    postId: string,
    commentId: string,
): Promise<void> => {
    const mentions = content.match(/@(\w+)/g);
    if (!mentions) return;

    for (const username of new Set(mentions.map(m => m.replace('@', '')))) {
        try {
            const { data: user } = await supabase
                .from('profiles')
                .select('id')
                .eq('username', username)
                .single();

            if (!user || user.id === senderId) continue;

            await supabase.from('notifications').insert([{
                sender_id: senderId,
                receiver_id: user.id,
                type: 'mention',
                post_id: postId,
                comment_id: commentId,
                content: content.substring(0, 50),
            }]);
        } catch (error) {
            console.error('Failed to notify mentioned user:', (error as Error).message || error);
        }
    }
};
