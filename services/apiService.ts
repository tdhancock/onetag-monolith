

// FIX: Import all necessary types from the newly created types.ts file.
import type { Message, Post, Notification, Comment, Story, UserProfile, SimpleUser } from '../types';
import type { User } from '@supabase/supabase-js';
// Import supabase client from the native adapter (uses SecureStore for session persistence)
import { supabase } from './supabase.native';
// Re-export so other files can import from apiService
export { supabase };

// Feed reads moved to features/posts in ONE-12. These are re-exported so the
// rest of the app keeps working while the strangler migration runs; the shims
// go away in the final M2 cleanup.
export {
    FEED_PAGE_SIZE,
    POST_SELECT_QUERY,
    mapPostData,
    getFeedUserIds,
    fetchPostById as getPostById,
    fetchTrendingPosts as getTrendingPosts,
} from '../features/posts';

import {
    POST_SELECT_QUERY,
    mapPostData,
} from '../features/posts';

// The profile-row bootstrap moved to services/profileBootstrap.ts in ONE-15 so
// features/posts and features/profiles can both reach it without importing
// each other.
import {
    ensureProfileRowForUser,
    ensureProfileForNotificationUser,
} from './profileBootstrap';

// Post media upload moved to services/mediaUpload.ts, and publishing, editing
// and deleting posts to features/posts, to break the import cycle that
// crashed the app on boot. Re-exported until the final M2 cleanup.
export {
    MediaUploadError,
    isLocalMediaUri,
    assertRemoteMediaUrl,
    uploadMedia,
} from './mediaUpload';
export { publishPost, updatePost, deletePost, adminDeletePost } from '../features/posts';

export { ensureCurrentUserProfile } from './profileBootstrap';

export async function sendNotification({
  sender_id,
  receiver_id,
  type,
  post_id = null,
  comment_id = null,
  story_id = null,
  content = null,
}: {
  sender_id: string;
  receiver_id: string;
  type: string;
  post_id?: string | null;
  comment_id?: string | null;
  story_id?: string | null;
  content?: string | null;
}) {
  try {
    if (!receiver_id || receiver_id === sender_id) return; // Do not send notifications to oneself

    const [senderReady, receiverReady] = await Promise.all([
      ensureProfileForNotificationUser(sender_id),
      ensureProfileForNotificationUser(receiver_id),
    ]);

    if (!senderReady || !receiverReady) {
      console.warn('Skipping notification due to missing sender/receiver profile row.', {
        sender_id,
        receiver_id,
        type,
      });
      return;
    }

    const { error } = await supabase.from("notifications").insert([
      {
        sender_id,
        receiver_id,
        type,
        post_id,
        comment_id,
        story_id,
        content,
      },
    ]);

    if (error) {
      console.error("Notification error:", error.message || error);
    } else {
    }
  } catch (err: any) {
    console.error("Notification insert failed:", err.message);
  }
}

async function handleMentions(content: string, sender_id: string, post_id: string, comment_id: string | null = null) {
  // Find @username mentions
  const mentions = content.match(/@(\w+)/g);
  if (!mentions) return;

  // Use a Set to avoid notifying the same user multiple times from one piece of content
  const mentionedUsernames = new Set(mentions.map(m => m.replace("@", "")));

  for (const username of mentionedUsernames) {
    try {
      // Find the mentioned user by username
      const { data: user, error: userError } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", username)
        .single();

      if (userError && userError.code !== 'PGRST116') { // PGRST116 means no user found, which is not an error here
          console.error(`Error fetching user @${username}:`, userError.message || userError);
          continue;
      }
      
      // If user exists and is not the sender, create a notification
      if (user && user.id !== sender_id) {
        await sendNotification({
            sender_id,
            receiver_id: user.id,
            type: 'mention',
            post_id,
            comment_id,
            content: `You were mentioned in a ${comment_id ? 'comment' : 'post'}`,
        });
      }
    } catch (error) {
       console.error(`Error processing mention for @${username}:`, (error as Error).message || error);
    }
  }
}

// --- ADMIN FUNCTIONS ---
export const setUserVerified = async (userId: string, username: string, status: boolean): Promise<void> => {
    // We update by ID to be absolutely sure we target the correct row,
    // preventing issues with case sensitivity or duplicate usernames (if any).
    // We also select the data back to confirm the update happened.
    const { data, error } = await supabase
        .from("profiles")
        .update({ is_verified: status })
        .eq("id", userId)
        .select();

    if (error) throw error;
    
    // If data is empty, it means no row was updated (likely RLS blocked it or ID not found).
    if (!data || data.length === 0) {
        throw new Error("Update failed: No rows modified. Check permissions.");
    }

    // The username-keyed cache this used to poke is gone (ONE-15); the
    // profile query is invalidated by the caller instead.
};

// -----------------------

export const cleanHtml = (html: string): string => {
    if (!html) return "";

    if (typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return doc.body.textContent || "";
    }

    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

// Moved to features/notifications in ONE-17; re-exported until the final M2
// cleanup.
export { markNotificationsAsRead } from '../features/notifications';

export const fetchLikeCount = async (postId: string): Promise<number> => {
  const { count, error } = await supabase
    .from('likes')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);

  if (error) {
    console.error("Beğeni sayısı hatası:", error.message || error);
    return 0;
  }

  return count || 0;
}

export const fetchRepostCount = async (postId: string): Promise<number> => {
  const { count, error } = await supabase
    .from('reposts')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);

  if (error) {
    console.error("Repost sayısı hatası:", error.message || error);
    return 0;
  }

  return count || 0;
}

export const fetchCommentCount = async (postId: string): Promise<number> => {
  const { count, error } = await supabase
    .from('comments')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);

  if (error) {
    console.error("Yorum sayısı hatası:", error.message || error);
    return 0;
  }

  return count || 0;
}

// Moved to features/posts/api.ts in ONE-13, where the optimistic toggle hooks
// that drive them live. Re-exported here so existing callers keep working
// while the strangler migration runs; this shim goes away in the final M2
// cleanup, once nothing imports it.
export { toggleLike, toggleRepost, toggleSavePost } from '../features/posts';

// Moved to features/stories/api.ts in ONE-19. Re-exported until the final
// M2 cleanup (ONE-20).
export {
    getStories,
    getMyStories,
    getStoryById,
    uploadStory,
    deleteStoryFromDatabase,
    toggleStoryLikeInDatabase,
    recordStoryView,
    getStoryViewCount,
    getStoryViewers,
} from '../features/stories';
export type { StoryViewer } from '../features/stories';

export const getSavedPosts = async (userId: string): Promise<Post[]> => {
    try {
        const { data: savedIdsData, error: savedError } = await supabase
            .from('saved_posts')
            .select('post_id, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (savedError) throw savedError;
        if (!savedIdsData || savedIdsData.length === 0) return [];
        
        const postIds = savedIdsData.map(r => r.post_id);

        const { data: postsData, error: postsError } = await supabase
            .from('posts')
            .select(POST_SELECT_QUERY)
            .in('id', postIds);

        if (postsError) throw postsError;
        if (!postsData) return [];
        // Sort by when they were saved, not when they were created
        const savedOrderMap = new Map<string, number>(savedIdsData.map((r: any) => [r.post_id, new Date(r.created_at).getTime()]));
        const sortedPosts = [...postsData].sort((a, b) => {
            // FIX: `savedOrderMap.get()` can return `undefined`. Using `?? 0` as a fallback ensures that `timeA` and `timeB` are always numbers, preventing a type error during the subtraction operation.
            const timeA = savedOrderMap.get(a.id) ?? 0;
            const timeB = savedOrderMap.get(b.id) ?? 0;
            return timeB - timeA;
        });

        return sortedPosts.map(mapPostData);

    } catch (error) {
        console.error("Error fetching saved posts:", (error as Error).message || error);
        return [];
    }
};

export const getPostLikers = async (postId: string): Promise<SimpleUser[]> => {
    const { data, error } = await supabase
        .from('likes')
        .select('profiles!user_id(id, username, full_name, avatar_url, is_verified)')
        .eq('post_id', postId);
    if (error || !data) return [];
    const uniqueUsers = new Map<string, SimpleUser>();
    data.forEach((item: any) => {
        const profile = Array.isArray(item?.profiles)
            ? item.profiles[0]
            : item?.profiles;
        if (!profile?.id || uniqueUsers.has(profile.id)) return;
        uniqueUsers.set(profile.id, {
            id: profile.id,
            username: profile.username,
            name: profile.full_name || profile.username,
            avatar: profile.avatar_url,
            isVerified: profile.is_verified || false,
        });
    });
    return Array.from(uniqueUsers.values());
};

export const getPostReposters = async (postId: string): Promise<SimpleUser[]> => {
    const { data, error } = await supabase
        .from('reposts')
        .select('profiles!user_id(id, username, full_name, avatar_url, is_verified)')
        .eq('post_id', postId);
    if (error || !data) return [];
    const uniqueUsers = new Map<string, SimpleUser>();
    data.forEach((item: any) => {
        const profile = Array.isArray(item?.profiles)
            ? item.profiles[0]
            : item?.profiles;
        if (!profile?.id || uniqueUsers.has(profile.id)) return;
        uniqueUsers.set(profile.id, {
            id: profile.id,
            username: profile.username,
            name: profile.full_name || profile.username,
            avatar: profile.avatar_url,
            isVerified: profile.is_verified || false,
        });
    });
    return Array.from(uniqueUsers.values());
};

// Moved to features/messages/api.ts in ONE-18. Re-exported until the final
// M2 cleanup (ONE-20).
export {
    getChatListUsers,
    sendMessage,
    markMessagesAsRead,
    deleteChatHistory,
    deleteConversationForBothSides,
} from '../features/messages';

// --- REPORT FUNCTIONS ---

export const reportPost = async (postId: string, reason: string): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { error } = await supabase.from('reports').insert([
        {
            reporter_id: user.id,
            target_type: 'post',
            target_id: postId,
            reason,
        },
    ]);

    if (error) {
        console.error('Error reporting post:', error.message || error);
        return false;
    }
    return true;
};

export const reportUser = async (userId: string, reason: string): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { error } = await supabase.from('reports').insert([
        {
            reporter_id: user.id,
            target_type: 'user',
            target_id: userId,
            reason,
        },
    ]);

    if (error) {
        console.error('Error reporting user:', error.message || error);
        return false;
    }
    return true;
};

// Moved to features/profiles/api.ts in ONE-15. Re-exported here so existing
// callers keep working while the strangler migration runs; these shims go
// away in the final M2 cleanup (ONE-20), once nothing imports them.
//
// `prefetchUserProfile` has no shim: it fronted a module-level Map that the
// query cache replaces. Its call sites use `queryClient.prefetchQuery`.
export {
    mapProfileRow,
    mapProfileUpdatesToRow,
    getUserProfile,
    getUserPosts,
    getUserReposts,
    updateUserProfileData,
    uploadAvatar,
    getFollowerCount,
    getFollowingCount,
    getFollowingList,
    getFollowerUsers,
    getFollowingUsers,
    followUser,
    unfollowUser,
    checkUsernameExists,
    searchUsers,
    getSmartUserSuggestions,
} from '../features/profiles';
export type { ProfileRow, ProfileUpdates } from '../features/profiles';


// Moved to features/comments/api.ts in ONE-14. Re-exported here so existing
// callers keep working while the strangler migration runs; these shims go away
// in the final M2 cleanup (ONE-20).
export {
    getCommentsForPost,
    addComment,
    deleteComment,
    isCommentLikedByUser,
    getCommentLikesCount,
    toggleCommentLike,
} from '../features/comments';

