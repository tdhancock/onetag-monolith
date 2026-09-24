

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
import { sendMessage } from '../features/messages';
import { isLikelyStoragePolicyError, isStorageBucketMissingError } from './mediaUpload';

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

// Helper to convert blob/data URLs to a Blob object for uploading (web-only)
async function localUrlToBlob(url: string): Promise<Blob> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch local URL: ${response.statusText}`);
    }
    return response.blob();
}

const toStorageExtension = (mimeType: string | undefined, fallback: string = 'bin'): string => {
    if (!mimeType) return fallback;
    const normalized = mimeType.toLowerCase();
    if (normalized.includes('jpeg')) return 'jpg';
    if (normalized.includes('png')) return 'png';
    if (normalized.includes('gif')) return 'gif';
    if (normalized.includes('webp')) return 'webp';
    if (normalized.includes('mp4')) return 'mp4';
    if (normalized.includes('quicktime')) return 'mov';
    if (normalized.includes('plain')) return 'txt';

    const raw = normalized.split('/')[1] || fallback;
    const cleaned = raw.replace(/[^a-z0-9]/g, '');
    return cleaned.length > 0 ? cleaned : fallback;
};

const uploadToPostMediaBucket = async (
    file: Blob | File,
    userId: string,
    scope: 'posts' | 'stories',
): Promise<string> => {
    const fallbackExtension = scope === 'stories' ? 'jpg' : 'bin';
    const extension = toStorageExtension(file.type, fallbackExtension);
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const candidatePaths = [
        `${userId}/${scope}/${fileName}`,
        `${scope}/${userId}/${fileName}`,
        `public/${userId}/${fileName}`,
    ];

    let lastError: unknown = null;

    for (const filePath of candidatePaths) {
        const { error } = await supabase.storage
            .from('post-media')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false,
                contentType: file.type || undefined,
            });

        if (!error) {
            return filePath;
        }

        lastError = error;
        if (!isLikelyStoragePolicyError(error)) {
            throw error;
        }
    }

    throw lastError || new Error('Storage upload failed.');
};

const uploadStoryMedia = async (
    file: Blob | File,
    userId: string,
): Promise<{ bucket: string; filePath: string }> => {
    const fallbackExtension = 'jpg';
    const extension = toStorageExtension(file.type, fallbackExtension);
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const bucketCandidates = ['post-media', 'avatars', 'stories', 'story-media'];
    const filePathCandidates = [
        `${userId}/stories/${fileName}`,
        `stories/${userId}/${fileName}`,
        `${userId}/${fileName}`,
        `${userId}/posts/${fileName}`,
        `public/${userId}/${fileName}`,
    ];

    let lastError: unknown = null;

    for (const bucket of bucketCandidates) {
        for (const filePath of filePathCandidates) {
            const { error } = await supabase.storage
                .from(bucket)
                .upload(filePath, file, {
                    cacheControl: '3600',
                    upsert: false,
                    contentType: file.type || undefined,
                });

            if (!error) {
                return { bucket, filePath };
            }

            lastError = error;
            if (!isLikelyStoragePolicyError(error) && !isStorageBucketMissingError(error)) {
                throw error;
            }
        }
    }

    throw lastError || new Error('Story storage upload failed.');
};

const blobToDataUrl = async (blob: Blob): Promise<string> => {
    if (typeof FileReader === 'undefined') {
        throw new Error('FileReader is not available');
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error('Could not convert blob to data URL'));
            }
        };
        reader.onerror = () => reject(reader.error || new Error('FileReader error'));
        reader.readAsDataURL(blob);
    });
};

const buildTextStoryDataUri = (text: string): string => {
    const normalized = (text || '').trim() || 'Story';
    const escaped = normalized
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1e3a5f"/><stop offset="100%" stop-color="#0f172a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/><foreignObject x="88" y="220" width="904" height="1480"><div xmlns="http://www.w3.org/1999/xhtml" style="color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:54px;line-height:1.35;font-weight:700;white-space:pre-wrap;word-break:break-word;">${escaped}</div></foreignObject></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

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

export const getStories = async (): Promise<Story[]> => {
    try {
        // Get current user — don't return early if null, RLS will handle it
        const { data: { user } } = await supabase.auth.getUser();
        
        // Get IDs of users the current user follows
        const followingIds: string[] = [];
        if (user) {
            const { data: followingData, error: followingError } = await supabase
                .from('follows')
                .select('followed_id')
                .eq('follower_id', user.id);
            if (!followingError && followingData) {
                followingIds.push(...followingData.map(f => f.followed_id));
            }
        }
        
        // Fetch stories from followed users AND the current user
        const userIdsToFetch = user ? [...followingIds, user.id] : followingIds;
        if (userIdsToFetch.length === 0) return [];

        // Filter stories created in the last 24 hours
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const { data, error } = await supabase
            .from('stories')
            .select(`*, profiles!user_id(username, avatar_url)`)
            .in('user_id', userIdsToFetch)
            .gte('created_at', twentyFourHoursAgo)
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Error fetching stories", (error as Error).message || error);
            return [];
        }

        return (data || []).map((s: any) => ({
            id: s.id,
            userId: s.user_id,
            username: s.profiles.username,
            avatar: s.profiles.avatar_url,
            timestamp: s.created_at,
            imageUrl: s.media_url,
            content: s.caption,
        }));
    } catch (error) {
        console.error("Error in getStories logic:", (error as Error).message || error);
        return [];
    }
};

export const getMyStories = async (userId: string): Promise<Story[]> => {
    const { data, error } = await supabase
        .from('stories')
        .select(`*, profiles!user_id(username, avatar_url)`)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error fetching my stories", (error as Error).message || error);
        return [];
    }

    return (data || []).map((s: any) => ({
        id: s.id,
        userId: s.user_id,
        username: s.profiles.username,
        avatar: s.profiles.avatar_url,
        timestamp: s.created_at,
        imageUrl: s.media_url,
        content: s.caption,
    }));
};

export const getStoryById = async (storyId: string): Promise<Story | null> => {
    const { data: storyData, error } = await supabase
        .from('stories')
        .select('*, profiles!user_id(username, avatar_url)')
        .eq('id', storyId)
        .single();

    if (error || !storyData) {
        console.error("Error fetching story by id or story not found", error);
        return null;
    }

    // Now, check for permissions
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) {
        return null; // Not logged in, can't view stories.
    }

    const storyOwnerId = storyData.user_id;

    // A user can always see their own story
    if (currentUser.id === storyOwnerId) {
        return {
            id: storyData.id,
            userId: storyData.user_id,
            username: storyData.profiles.username,
            avatar: storyData.profiles.avatar_url,
            timestamp: storyData.created_at,
            imageUrl: storyData.media_url,
            content: storyData.caption
        };
    }

    // Check if the current user follows the story owner
    const { count, error: followError } = await supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('follower_id', currentUser.id)
        .eq('followed_id', storyOwnerId);

    if (followError) {
        console.error("Error checking follow status:", followError);
        return null; // Fail safe
    }

    if (count && count > 0) {
        // Is a follower, grant access
        return {
            id: storyData.id,
            userId: storyData.user_id,
            username: storyData.profiles.username,
            avatar: storyData.profiles.avatar_url,
            timestamp: storyData.created_at,
            imageUrl: storyData.media_url,
            content: storyData.caption
        };
    }

    // Not a follower, deny access
    return null;
};

export const uploadStory = async (file: File | Blob | null, caption: string | null, userId: string): Promise<Story | null> => {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
        throw new Error('User not authenticated');
    }

    if (userId && userId !== user.id) {
        console.warn('uploadStory user mismatch. Falling back to authenticated user.', {
            requestedUserId: userId,
            authenticatedUserId: user.id,
        });
    }

    const profileReady = await ensureProfileRowForUser(user);
    if (!profileReady) {
        throw new Error('Could not create or find a profile row for this account.');
    }

    let mediaUrl: string | null = null;
    if (file) {
        try {
            const { bucket, filePath } = await uploadStoryMedia(file, user.id);
            const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(filePath);
            if (!urlData) throw new Error("Could not get public URL for story.");
            mediaUrl = urlData.publicUrl;
        } catch (uploadError) {
            if (isLikelyStoragePolicyError(uploadError) || isStorageBucketMissingError(uploadError)) {
                console.warn('Story media upload skipped due storage policy/bucket constraints.', uploadError);
                try {
                    mediaUrl = await blobToDataUrl(file);
                } catch (dataUrlError) {
                    console.warn('Could not convert story media to inline data URL.', dataUrlError);
                    mediaUrl = buildTextStoryDataUri(caption || 'Story');
                }
            } else {
                throw uploadError;
            }
        }
    }

    const insertStory = async (url: string | null) => supabase
        .from('stories')
        .insert({ user_id: user.id, media_url: url, caption })
        .select('*, profiles!user_id(username, avatar_url)')
        .single();

    let { data: storyData, error: insertError } = await insertStory(mediaUrl);

    if (insertError && !file && insertError.code === '23502') {
        const fallbackUrl = buildTextStoryDataUri(caption || '');
        const retry = await insertStory(fallbackUrl);
        storyData = retry.data;
        insertError = retry.error;
    }

    if (insertError) throw insertError;
    
    return {
        id: storyData.id,
        userId: storyData.user_id,
        username: storyData.profiles.username,
        avatar: storyData.profiles.avatar_url,
        timestamp: storyData.created_at,
        imageUrl: storyData.media_url,
        content: storyData.caption,
    };
};

export const deleteStoryFromDatabase = async (storyId: string): Promise<boolean> => {
    const { error } = await supabase.from('stories').delete().eq('id', storyId);
    return !error;
};

export const toggleStoryLikeInDatabase = async (storyId: string, userId: string): Promise<void> => {
     const { data: existingLike, error: likeError } = await supabase
        .from('story_likes')
        .select('*')
        .eq('story_id', storyId)
        .eq('user_id', userId)
        .maybeSingle();

    if(likeError) throw likeError;

    if (existingLike) {
        const { error } = await supabase.from('story_likes').delete().match({ story_id: storyId, user_id: userId });
        if(error) throw error;
    } else {
        const { error } = await supabase.from('story_likes').insert({ story_id: storyId, user_id: userId });
        if(error) throw error;
    }
};

export const recordStoryView = async (storyId: string, userId: string) => {
    // Upsert to not create duplicate view records
    await supabase.from('story_views').upsert({ story_id: storyId, user_id: userId });
};

export const getStoryViewCount = async (storyId: string): Promise<number> => {
    const { count, error } = await supabase
        .from('story_views')
        .select('*', { count: 'exact', head: true })
        .eq('story_id', storyId);
    return error ? 0 : count || 0;
};

export interface StoryViewer {
    user_id: string;
    username: string;
    avatar_url: string | null;
}

export const getStoryViewers = async (storyId: string): Promise<StoryViewer[]> => {
    const { data, error } = await supabase
        .from('story_views')
        .select(`
            user_id,
            profiles!user_id (
                username,
                avatar_url
            )
        `)
        .eq('story_id', storyId)
        .limit(50);

    if (error) {
        console.error('Error fetching story viewers:', error);
        return [];
    }

    return (data || []).map((row: any) => ({
        user_id: row.user_id,
        username: row.profiles?.username || 'unknown',
        avatar_url: row.profiles?.avatar_url || null,
    }));
};

export const replyToStory = async (storyId: string, storyOwnerId: string, text: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("User not authenticated");
    
    return sendMessage({
        sender_id: user.id,
        receiver_id: storyOwnerId,
        text,
        replied_story_id: storyId
    });
};

// =========================================================
// User & Profile
// =========================================================

/**
 * The two halves of the `profiles` column mapping live next to each other on
 * purpose. The client shape uses `name` / `profilePicture`; the table uses
 * `full_name` / `avatar_url`. Reads mapped and writes did not, which is how
 * every profile save came to target a column that does not exist.
 */
type ProfileRow = {
    id: string;
    username: string;
    full_name: string | null;
    bio: string | null;
    avatar_url: string | null;
    is_verified: boolean;
    is_private: boolean;
};


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

