

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

const DEFAULT_USER_BIO = 'Hello, I am using OneTag';

const sanitizeUsername = (value: string): string =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9_.]/g, '')
        .replace(/^[._]+|[._]+$/g, '')
        .slice(0, 20);

const buildUsernameCandidate = (base: string, attempt: number, userId: string): string => {
    const fallback = `user_${userId.slice(0, 6)}`;
    const normalizedBase = sanitizeUsername(base) || fallback;

    if (attempt === 0) {
        return normalizedBase.length >= 3 ? normalizedBase : `${normalizedBase}${userId.slice(0, 3)}`.slice(0, 20);
    }

    const suffix = `${attempt}${userId.slice(0, 3)}`.toLowerCase();
    const maxBaseLength = Math.max(3, 20 - suffix.length - 1);
    const trimmedBase = normalizedBase.slice(0, maxBaseLength);
    return `${trimmedBase}_${suffix}`.slice(0, 20);
};

const profileExists = async (userId: string): Promise<boolean> => {
    const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        console.error('Profile check error:', error.message || error);
        return false;
    }

    return Boolean(data);
};

const ensureProfileRowForUser = async (user: User): Promise<boolean> => {
    if (await profileExists(user.id)) return true;

    const metadata = user.user_metadata || {};
    const fullName = typeof metadata.full_name === 'string' && metadata.full_name.trim().length > 0
        ? metadata.full_name.trim()
        : (user.email?.split('@')[0] || 'OneTag User');
    const avatarUrl = typeof metadata.avatar_url === 'string' ? metadata.avatar_url : null;
    const bio = typeof metadata.bio === 'string' && metadata.bio.trim().length > 0
        ? metadata.bio.trim()
        : DEFAULT_USER_BIO;
    const baseUsername =
        (typeof metadata.username === 'string' && metadata.username) ||
        (typeof metadata.preferred_username === 'string' && metadata.preferred_username) ||
        (user.email?.split('@')[0] || '');

    for (let attempt = 0; attempt < 6; attempt += 1) {
        const username = buildUsernameCandidate(baseUsername, attempt, user.id);

        const { error } = await supabase
            .from('profiles')
            .upsert(
                {
                    id: user.id,
                    username,
                    full_name: fullName,
                    avatar_url: avatarUrl,
                    bio,
                },
                { onConflict: 'id' },
            );

        if (!error) {
            return true;
        }

        if (error.code === '23505') {
            continue;
        }

        console.error('Error ensuring profile row:', error.message || error);
        return false;
    }

    return profileExists(user.id);
};

const ensureProfileForNotificationUser = async (userId: string): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user && user.id === userId) {
        return ensureProfileRowForUser(user);
    }
    return profileExists(userId);
};

export const ensureCurrentUserProfile = async (): Promise<boolean> => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
        console.error('Cannot ensure profile without an authenticated user.', error?.message || error);
        return false;
    }
    return ensureProfileRowForUser(user);
};

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

/**
 * Upload a local media file (from expo-image-picker or camera) to Supabase Storage.
 * Uses fetch().arrayBuffer() which works reliably on React Native.
 * Returns the public URL of the uploaded file.
 */
/**
 * Read a local media URI into an ArrayBuffer, alongside the content type and
 * extension implied by the URI. This is the React Native path — `fetch()` +
 * `arrayBuffer()` works for file:// and content:// URIs, where `.blob()` does
 * not, because RN's Blob is a shim with no accessible binary data.
 *
 * Shared by every upload path so none of them can drift back onto `.blob()`.
 */
async function readLocalFile(localUri: string): Promise<{ arrayBuffer: ArrayBuffer; contentType: string; ext: string }> {
    const response = await fetch(localUri);
    if (!response.ok) {
        throw new Error(`Failed to read local file: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();

    // Determine content type from URI extension
    const uriLower = localUri.toLowerCase();
    let contentType = 'image/jpeg'; // default
    let ext = 'jpg';
    if (uriLower.endsWith('.png')) { contentType = 'image/png'; ext = 'png'; }
    else if (uriLower.endsWith('.webp')) { contentType = 'image/webp'; ext = 'webp'; }
    else if (uriLower.endsWith('.gif')) { contentType = 'image/gif'; ext = 'gif'; }
    else if (uriLower.endsWith('.mp4')) { contentType = 'video/mp4'; ext = 'mp4'; }
    else if (uriLower.endsWith('.mov')) { contentType = 'video/quicktime'; ext = 'mov'; }

    return { arrayBuffer, contentType, ext };
}

/**
 * Raised when a post's media could not be turned into a remotely readable URL.
 * Distinct from a generic publish failure so the composer can tell the author
 * the *image* is the problem, not their text.
 */
export class MediaUploadError extends Error {
    constructor(message: string, readonly cause?: unknown) {
        super(message);
        this.name = 'MediaUploadError';
    }
}

/** A URI that only resolves on the device that produced it. */
export const isLocalMediaUri = (uri: string): boolean =>
    uri.startsWith('file://') ||
    uri.startsWith('content://') ||
    uri.startsWith('blob:') ||
    uri.startsWith('data:');

/**
 * Last line of defence before an insert: a device-local URI stored as
 * `image_url` renders for exactly one person and is unfixable afterwards, so
 * fail loudly rather than writing the row.
 */
export function assertRemoteMediaUrl(url: string | null | undefined): void {
    if (url && isLocalMediaUri(url)) {
        throw new MediaUploadError('Your photo could not be uploaded, so the post was not published.');
    }
}

export async function uploadMedia(localUri: string, userId: string): Promise<string> {
    const { arrayBuffer, contentType, ext } = await readLocalFile(localUri);

    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    // Try uploading to the 'post-media' bucket first (same bucket the web app uses)
    const candidatePaths = [
        `${userId}/posts/${fileName}`,
        `posts/${userId}/${fileName}`,
        `public/${userId}/${fileName}`,
    ];

    const bucketCandidates = ['post-media', 'media', 'uploads'];

    let lastError: unknown = null;

    for (const bucket of bucketCandidates) {
        for (const filePath of candidatePaths) {
            const { error } = await supabase.storage
                .from(bucket)
                .upload(filePath, arrayBuffer, {
                    cacheControl: '3600',
                    upsert: false,
                    contentType,
                });

            if (!error) {
                const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
                return data.publicUrl;
            }

            lastError = error;
            // If it's not a policy/bucket error, throw immediately
            if (!isLikelyStoragePolicyError(error) && !isStorageBucketMissingError(error)) {
                throw error;
            }
            // If it's a bucket-missing error for this bucket, try next bucket
            if (isStorageBucketMissingError(error)) {
                break; // skip remaining paths for this bucket, try next bucket
            }
        }
    }

    // All buckets failed — fall back to data URL
    console.warn('All storage buckets unavailable, falling back to data URL.');
    return arrayBufferToDataUrl(arrayBuffer, contentType);
}

/**
 * Convert ArrayBuffer to base64 data URL — fallback when storage is unavailable.
 */
function arrayBufferToDataUrl(buffer: ArrayBuffer, contentType: string): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return `data:${contentType};base64,${base64}`;
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

const isLikelyStoragePolicyError = (error: unknown): boolean => {
    const message = String((error as { message?: unknown })?.message || error).toLowerCase();
    return (
        message.includes('row-level security policy') ||
        message.includes('not authorized') ||
        message.includes('permission denied')
    );
};

const isStorageBucketMissingError = (error: unknown): boolean => {
    const message = String((error as { message?: unknown })?.message || error).toLowerCase();
    return message.includes('bucket') && message.includes('not found');
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

export const publishPost = async (post: Post): Promise<Post | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        console.error("❌ Error publishing post: User not authenticated.");
        throw new Error("User not authenticated");
    }

    const profileReady = await ensureProfileRowForUser(user);
    if (!profileReady) {
        throw new Error('Could not create or find a profile row for this account. Please re-login and try again.');
    }

    try {
        const content = post.content || "";
        let uploadUrl = post.media || null;
        const mediaType = post.media_type || 'text';
        const aspectRatio = post.media_aspect_ratio || null;

        // --- NEW UPLOAD LOGIC ---
        // If the media is a local URL (from camera or gallery), upload it to storage first.
        if (uploadUrl && isLocalMediaUri(uploadUrl)) {
            // Use the RN-compatible uploadMedia function which uses arrayBuffer.
            // This is the only upload site for post media — callers hand us the
            // local URI and we resolve it here, so nothing uploads twice.
            try {
                uploadUrl = await uploadMedia(uploadUrl, user.id);
            } catch (uploadError) {
                throw new MediaUploadError('Your photo could not be uploaded, so the post was not published.', uploadError);
            }
        }
        // uploadMedia falls back to a data: URL when every bucket is unavailable;
        // that is still unreadable to everyone else, so it must not be inserted.
        assertRemoteMediaUrl(uploadUrl);
        // --- END NEW UPLOAD LOGIC ---

        const { data: insertData, error } = await supabase
            .from("posts")
            .insert([
                {
                    user_id: user.id,
                    content: content,
                    image_url: uploadUrl, // This is now the permanent URL if an image was uploaded
                    media_type: mediaType,
                    media_aspect_ratio: aspectRatio,
                    created_at: post.timestamp || new Date().toISOString(),
                },
            ])
            .select('id')
            .single();

        if (error) throw error;
        if (!insertData) throw new Error("Post insertion did not return data.");

        const { data, error: fetchError } = await supabase
            .from('posts')
            .select(POST_SELECT_QUERY)
            .eq('id', insertData.id)
            .single();

        if (fetchError) throw fetchError;
        if (!data) throw new Error("Could not retrieve post after creation.");

        // Handle mentions after post is successfully created
        if (content.trim().length > 0) {
            await handleMentions(content, user.id, data.id, null);
        }
        
        return mapPostData(data);

    } catch (err) {
        console.error("❌ Error publishing post:", (err as Error).message || err);
        throw err;
    }
};

export const deletePost = async (postId: string): Promise<boolean> => {
    const { error } = await supabase.from('posts').delete().eq('id', postId);
    if (error) {
        console.error('Error deleting post:', error.message || error);
        return false;
    }
    return true;
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

    // Update local cache to prevent UI reversion
    if (profileCache.has(username)) {
        const cached = profileCache.get(username)!;
        profileCache.set(username, { ...cached, isVerified: status });
    }
};

export const adminDeletePost = async (postId: string): Promise<void> => {
    const { error } = await supabase
        .from("posts")
        .delete()
        .eq("id", postId);
    if (error) throw error;
};
// -----------------------

export const updatePost = async (post: Post): Promise<Post | null> => {
    const { id, content } = post;
    const { data, error } = await supabase
        .from('posts')
        .update({ content })
        .eq('id', id)
        .select()
        .single();
    if (error) {
        console.error('Error updating post:', error.message || error);
        return null;
    }
    return { ...data, timestamp: data.created_at } as Post;
};

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

export const markNotificationsAsRead = async (userId: string): Promise<boolean> => {
    const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('receiver_id', userId)
        .eq('is_read', false);
    
    if (error) {
        console.error("Error marking notifications as read:", error.message || error);
        return false;
    }
    return true;
};

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

export const checkUsernameExists = async (username: string): Promise<boolean> => {
    const { data, error } = await supabase
        .from('profiles')
        .select('username')
        .eq('username', username)
        .maybeSingle();

    if (error) {
        console.error('Error checking username:', error);
        throw new Error('Could not verify username availability.');
    }
    return !!data;
};
// FIX: Add all missing functions below and export them.
// =========================================================
// Stories
// =========================================================
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

export const mapProfileRow = (row: ProfileRow): UserProfile => ({
    id: row.id,
    name: row.full_name,
    username: row.username,
    bio: row.bio,
    profilePicture: row.avatar_url,
    isVerified: row.is_verified,
    isPrivate: row.is_private,
} as UserProfile);

/** The inverse of `mapProfileRow`: client field names → `profiles` columns. */
export type ProfileUpdates = Partial<Pick<UserProfile, 'name' | 'username' | 'bio' | 'profilePicture'>>;

export const mapProfileUpdatesToRow = (updates: ProfileUpdates): Partial<ProfileRow> => {
    const row: Partial<ProfileRow> = {};
    if (updates.name !== undefined) row.full_name = updates.name;
    if (updates.username !== undefined) row.username = updates.username;
    if (updates.bio !== undefined) row.bio = updates.bio;
    if (updates.profilePicture !== undefined) row.avatar_url = updates.profilePicture;
    return row;
};

// FIX: Replaced undefined 'UserProfileType' with 'UserProfile'.
const profileCache = new Map<string, UserProfile>();
export const getUserProfile = async (username: string): Promise<UserProfile | null> => {
    if (profileCache.has(username)) {
        return profileCache.get(username)!;
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('username', username).single();
    if (error || !data) {
        console.error("Error fetching profile", error);
        return null;
    }
    const profile = mapProfileRow(data);
    profileCache.set(username, profile);
    return profile;
};

export const prefetchUserProfile = (username: string) => {
    if (!profileCache.has(username)) {
        getUserProfile(username);
    }
};

export const getUserPosts = async (userId: string): Promise<Post[]> => {
    const { data, error } = await supabase
        .from('posts')
        .select(POST_SELECT_QUERY)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    
    if (error) return [];
    return (data || []).map(mapPostData);
};

export const getUserReposts = async (userId: string): Promise<Post[]> => {
    try {
        const { data: repostIdsData, error: repostsError } = await supabase
            .from('reposts')
            .select('post_id, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (repostsError) throw repostsError;
        if (!repostIdsData || repostIdsData.length === 0) return [];
        
        const postIds = repostIdsData.map(r => r.post_id);
        const repostOrderMap = new Map<string, number>(repostIdsData.map((r: any) => [r.post_id, new Date(r.created_at).getTime()]));

        const { data: postsData, error: postsError } = await supabase
            .from('posts')
            .select(POST_SELECT_QUERY)
            .in('id', postIds);

        if (postsError) throw postsError;
        if (!postsData) return [];
        const sortedPosts = [...postsData].sort((a, b) => {
            // FIX: `repostOrderMap.get()` can return `undefined`. Using `?? 0` as a fallback ensures that `timeA` and `timeB` are always numbers, preventing a type error during the subtraction operation.
            const timeA = repostOrderMap.get(a.id) ?? 0;
            const timeB = repostOrderMap.get(b.id) ?? 0;
            return timeB - timeA;
        });

        return sortedPosts.map(mapPostData);

    } catch (error) {
        console.error("Error fetching user reposts:", (error as Error).message || error);
        return [];
    }
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

export const updateUserProfileData = async (updates: ProfileUpdates): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const row = mapProfileUpdatesToRow(updates);
    if (Object.keys(row).length === 0) return true;

    const { error } = await supabase.from('profiles').update(row).eq('id', user.id);
    if (error) {
        console.error('Profile update error:', error);
        return false;
    }

    // The username-keyed read cache would otherwise keep serving the old row
    // for the rest of the session.
    if (updates.username) profileCache.delete(updates.username);
    return true;
};

/**
 * Upload a new avatar from a local URI and return its public URL.
 *
 * Takes a local URI rather than a Blob: `fetch(uri).blob()` is the web path and
 * yields an empty upload on React Native, which is why this shares
 * `readLocalFile` with `uploadMedia`. The path shape is fixed by storage RLS —
 * the avatars policies match `(storage.foldername(name))[2]` against
 * `auth.uid()`, so the uid must stay the second segment.
 */
export const uploadAvatar = async (localUri: string): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    try {
        const { arrayBuffer, contentType, ext } = await readLocalFile(localUri);
        const filePath = `avatars/${user.id}/${Date.now()}.${ext}`;

        const { error } = await supabase.storage
            .from('avatars')
            .upload(filePath, arrayBuffer, { upsert: true, contentType, cacheControl: '3600' });

        if (error) {
            console.error('Avatar upload error:', error);
            return null;
        }

        const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
        return data.publicUrl ?? null;
    } catch (err) {
        console.error('Avatar upload error:', (err as Error).message || err);
        return null;
    }
};

// =========================================================
// Follows
// =========================================================

export const getFollowerCount = async (userId: string): Promise<number> => {
    const { count, error } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followed_id', userId);
    return error ? 0 : count || 0;
};

export const getFollowingCount = async (userId: string): Promise<number> => {
    const { count, error } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId);
    return error ? 0 : count || 0;
};

export const getFollowingList = async (userId: string): Promise<string[]> => {
    const { data, error } = await supabase.from('follows').select('profiles!followed_id(username)').eq('follower_id', userId);
    if (error) return [];
    const unique = new Set<string>();
    for (const item of data || []) {
        const profile = Array.isArray(item?.profiles)
            ? item.profiles[0]
            : item?.profiles;
        const username = profile?.username;
        if (typeof username === 'string' && username.trim().length > 0) {
            unique.add(username.toLowerCase());
        }
    }
    return Array.from(unique);
};

export const getFollowerUsers = async (userId: string): Promise<SimpleUser[]> => {
    const { data, error } = await supabase
        .from('follows')
        .select('profiles!follower_id(id, username, full_name, avatar_url, is_verified)')
        .eq('followed_id', userId);
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

export const getFollowingUsers = async (userId: string): Promise<SimpleUser[]> => {
    const { data, error } = await supabase
        .from('follows')
        .select('profiles!followed_id(id, username, full_name, avatar_url, is_verified)')
        .eq('follower_id', userId);
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

export const followUser = async (follower_id: string, followed_id: string): Promise<void> => {
    const { data: existingFollow, error: existingError } = await supabase
        .from('follows')
        .select('follower_id')
        .eq('follower_id', follower_id)
        .eq('followed_id', followed_id)
        .maybeSingle();

    if (existingError) {
        throw existingError;
    }
    if (existingFollow) {
        return;
    }

    const { error } = await supabase
        .from('follows')
        .insert({ follower_id, followed_id });

    if (error && error.code !== '23505') throw error;
    if (error?.code === '23505') return;

    await sendNotification({ sender_id: follower_id, receiver_id: followed_id, type: 'follow' });
};

export const unfollowUser = async (follower_id: string, followed_id: string): Promise<void> => {
    const { error } = await supabase.from('follows').delete().match({ follower_id, followed_id });
    if (error) throw error;
};

// =========================================================
// Comments
// =========================================================

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
    const { data: postData } = await supabase.from('posts').select('user_id').eq('id', postId).single();
    if (postData && postData.user_id !== userId) {
        await sendNotification({
            sender_id: userId,
            receiver_id: postData.user_id,
            type: 'comment',
            post_id: postId,
            comment_id: data.id,
            content: content.substring(0, 50),
        });
    }
    await handleMentions(content, userId, postId, data.id);
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

// =========================================================
// Misc
// =========================================================

// Moved to features/hashtags/api.ts in ONE-11. Re-exported here so existing
// callers keep working while the strangler migration runs; this shim goes
// away in the final M2 cleanup, once nothing imports it.
export { fetchHashtags as getAllHashtags } from '../features/hashtags';

export const searchUsers = async (query: string): Promise<any[]> => {
    const { data, error } = await supabase
        .from('profiles')
        .select('id, username, full_name, avatar_url, is_verified, bio')
        .ilike('username', `%${query}%`)
        .limit(10);
    if (error) return [];
    return data || [];
};

export const getSmartUserSuggestions = async(userId: string): Promise<any[]> => {
    // The original RPC function 'get_user_suggestions' causes a "column reference is ambiguous" SQL error.
    // As we cannot modify the backend function, this implementation replaces it with a client-side query
    // that suggests recent users the current user is not already following.

    // 1. Get IDs of users the current user is following.
    const { data: followingData, error: followingError } = await supabase
        .from('follows')
        .select('followed_id')
        .eq('follower_id', userId);

    if (followingError) {
        console.error('Error fetching following list for suggestions:', followingError.message);
        return [];
    }

    // Create a list of user IDs to exclude from suggestions (followed users + the user themselves).
    const followingIds = followingData.map(f => f.followed_id);
    const excludeIds = [...followingIds, userId];

    // 2. Fetch a few recent profiles, excluding the ones in the `excludeIds` list.
    const { data: suggestionsData, error: suggestionsError } = await supabase
        .from('profiles')
        .select('id, username, avatar_url, is_verified')
        .not('id', 'in', `(${excludeIds.join(',')})`)
        .order('created_at', { ascending: false })
        .limit(5);

    if (suggestionsError) {
        console.error('Error fetching user suggestions:', suggestionsError.message);
        return [];
    }

    // 3. Map the fetched profile data to the structure expected by the UserSuggestions component.
    // The 'mutual_followers' field is set to 0 as this simplified query does not calculate them.
    return (suggestionsData || []).map(profile => ({
        suggested_user_id: profile.id,
        username: profile.username,
        avatar_url: profile.avatar_url,
        is_verified: profile.is_verified,
        mutual_followers: 0,
    }));
}

// =========================================================
// Chat / Messages
// =========================================================
export const getChatListUsers = async (userId: string): Promise<SimpleUser[]> => {
    try {
        // Get all messages involving the user, ordered by most recent.
        const { data: messages, error: messagesError } = await supabase
            .from('messages')
            .select('sender_id, receiver_id, created_at')
            .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
            .order('created_at', { ascending: false });

        if (messagesError) throw messagesError;

        // Get unique partner IDs and store the timestamp of their latest message
        const latestMessageTimestamps = new Map<string, string>();
        const partnerIds = new Set<string>();

        for (const message of messages) {
            const partnerId = message.sender_id === userId ? message.receiver_id : message.sender_id;
            if (!latestMessageTimestamps.has(partnerId)) {
                latestMessageTimestamps.set(partnerId, message.created_at);
            }
            partnerIds.add(partnerId);
        }

        if (partnerIds.size === 0) {
            return [];
        }

        // Fetch profiles for the unique partner IDs
        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, full_name, username, avatar_url, is_verified')
            .in('id', Array.from(partnerIds));
        
        if (profilesError) {
            throw profilesError;
        }

        // Map profiles to SimpleUser objects
        const users: SimpleUser[] = (profiles || []).map((u: any) => ({
            id: u.id,
            name: u.full_name,
            username: u.username,
            avatar: u.avatar_url,
            isVerified: u.is_verified,
        }));

        // Sort users based on the timestamp of their last message
        users.sort((a, b) => {
            // FIX: Using a fallback of 0 for `new Date()` ensures a valid timestamp (the Unix epoch) if a message time is not found, preventing `NaN` results from invalid date subtractions which was causing the arithmetic operation error.
            const timeA = new Date(latestMessageTimestamps.get(a.id) || 0).getTime();
            const timeB = new Date(latestMessageTimestamps.get(b.id) || 0).getTime();
            return timeB - timeA;
        });

        return users;

    } catch (error) {
        // Log the full error object for better debugging.
        console.error("Error fetching chat list users:", error);
        return [];
    }
};

export const sendMessage = async (
    { sender_id, receiver_id, text, post, user, replied_story_id, reply_to }: 
    { sender_id: string, receiver_id: string, text?: string | null, post?: Post | null, user?: SimpleUser | null, replied_story_id?: string | null, reply_to?: string | null }
): Promise<Message> => {
    let type: Message['type'] = 'text';
    if(post) type = 'post_share';
    if(user) type = 'profile_share';
    if(replied_story_id) type = 'story_reply';
    
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
            reply_to
        })
        .select()
        .single();

    if (error) throw error;
    return data as Message;
};

export const markMessagesAsRead = async (receiverId: string, senderId: string): Promise<boolean> => {
    const { error } = await supabase
        .from('messages')
        .update({ seen: true })
        .match({ receiver_id: receiverId, sender_id: senderId, seen: false });
    return !error;
};

export const deleteChatHistory = async (userId1: string, userId2: string): Promise<void> => {
    const { error } = await supabase.rpc('delete_chat_history', { user_id_1: userId1, user_id_2: userId2 });
    if (error) throw error;
};

export const deleteConversationForBothSides = async (myId: string, otherId: string): Promise<boolean> => {
    const { error } = await supabase.rpc("delete_conversation", {
        user1: myId,
        user2: otherId,
    });
    if (error) {
        console.error("Error deleting conversation:", error);
        return false;
    }
    return true;
};

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
