// Pure Supabase access for the comments domain.
//
// Moved out of `services/apiService.ts` in ONE-14. The notification and
// mention side effects come from `services/notificationWrites.ts`, which
// ONE-17 consolidated out of the three copies that briefly existed here, in
// posts and in profiles.

import { supabase } from '../../services/supabase.native';
import { notifyPostAuthor, notifyMentionedUsers } from '../../services/notificationWrites';
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
    await notifyPostAuthor(postId, userId, 'comment', {
      commentId: data.id,
      content: content.substring(0, 50),
    });
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
