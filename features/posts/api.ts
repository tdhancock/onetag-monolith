// Pure Supabase access for the posts domain.
//
// No React, no hooks, no imports from another feature, and — the point of
// this ticket — no module-level mutable state. Paging is a parameter, not a
// counter living in this module, so two feeds can page independently and a
// second mount starts from the top without anyone having to reset anything.

import { supabase } from '../../services/supabase.native';
import { ensureProfileRowForUser } from '../../services/profileBootstrap';
import {
  MediaUploadError,
  assertRemoteMediaUrl,
  isLocalMediaUri,
  uploadMedia,
} from '../../services/mediaUpload';
import { POST_SELECT_QUERY, mapPostData, scopePostsToViewer } from '../../services/postRows';
import type { Post } from './types';
import type { ProfileId, SimpleUser } from '../../types';

// The post select and row mapper live in services/postRows.ts so features
// that render a post inside their own rows — messages, stories — can map it
// without importing this feature (features/README.md, rule 1). Re-exported
// here so the posts surface is unchanged.
export { POST_SELECT_QUERY, mapPostData };

/** Posts requested per feed page. */
export const FEED_PAGE_SIZE = 20;

/** Restrict the viewer-scoped embeds to one profile's rows (services/postRows.ts). */
const scopeToViewer = scopePostsToViewer;

/**
 * A cursor into the feed: the last post on the previous page, by its
 * `created_at` and id. Posts sharing a timestamp are ordered by id, so the
 * next page starts right after that post and none is skipped (ONE-113).
 * `null` means "start from the top".
 */
export type FeedCursor = { createdAt: string; id: string } | null;

export interface FetchFeedPageArgs {
  userId: string;
  pageParam: FeedCursor;
  /** An interest slug, or null for All (ONE-49). */
  interest?: string | null;
}

/**
 * One page of a user's feed, newest first.
 *
 * Paging is by cursor rather than offset: a post published while the reader
 * is scrolling shifts every offset by one and would make them see a
 * duplicate at the page boundary. Comparing against the previous page's last
 * post, by `created_at` then id, is stable under inserts and under ties.
 *
 * Throws on failure. The caller is a query with retry and error state
 * configured on the client, so swallowing the error here would take both
 * away and make an outage indistinguishable from an empty feed.
 *
 * Two steps. `feed_posts` chooses the page — the reader's posts and those of
 * everyone they follow — and hands back its ids. It used to fetch the follow
 * list and send it back as `.in('user_id', …)`, which put every id in the URL
 * and broke at about 200 follows (ONE-106); a page's ids are at most
 * FEED_PAGE_SIZE. Then the page is read from the table as every post list is,
 * scoped to the reader. It isn't read through the function itself: PostgREST
 * 14 fails the viewer-scoped embeds on a function's result.
 *
 * The interest narrows the page in the database, never a fetched page, so a
 * filtered page is still full-length (ONE-49).
 */
export const fetchFeedPage = async ({
  userId,
  pageParam,
  interest = null,
}: FetchFeedPageArgs): Promise<Post[]> => {
  const { data: page, error: pageError } = await supabase
    .rpc('feed_posts', {
      p_viewer: userId,
      p_before: pageParam?.createdAt ?? null,
      p_before_id: pageParam?.id ?? null,
      p_interest: interest || null,
      p_limit: FEED_PAGE_SIZE,
    })
    .select('id');

  if (pageError) throw pageError;
  const ids = ((page || []) as { id: string }[]).map((row) => row.id);
  if (ids.length === 0) return [];

  const { data, error } = await scopeToViewer(
    supabase.from('posts').select(POST_SELECT_QUERY),
    userId,
  )
    .in('id', ids)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (error) throw error;
  return (data || []).map(mapPostData);
};

/**
 * The newest post the reader's feed holds now, or null for an empty feed:
 * one row from the function the feed pages through.
 *
 * The home feed asks this now and then, and offers "New posts" when the
 * answer is newer than its top, rather than listening to every post
 * published anywhere and fetching each one to see whether it belonged.
 */
export const fetchNewestFeedPost = async (userId: string, interest: string | null = null): Promise<FeedCursor> => {
  const { data, error } = await supabase
    .rpc('feed_posts', {
      p_viewer: userId,
      p_before: null,
      p_before_id: null,
      p_interest: interest || null,
      p_limit: 1,
    })
    .select('id, created_at');

  if (error) throw error;
  const row = ((data || []) as { id: string; created_at: string }[])[0];
  return row ? { id: row.id, createdAt: row.created_at } : null;
};

/**
 * The cursor for the page after this one, or `undefined` when there is none.
 *
 * A short page means the end of the feed. Exported so the rule is testable
 * without standing up a query.
 */
export const nextFeedCursor = (page: Post[]): FeedCursor | undefined => {
  if (page.length < FEED_PAGE_SIZE) return undefined;
  const last = page[page.length - 1];
  return last?.timestamp ? { createdAt: last.timestamp, id: last.id } : undefined;
};

/**
 * A single post by id.
 *
 * Returns undefined rather than throwing, which is what every existing
 * caller expects — the post detail, edit, share and message screens all
 * treat a missing post as "not found" rather than as an error to surface.
 */
export const fetchPostById = async (
  postId: string,
  viewerId?: string,
): Promise<Post | undefined> => {
  try {
    const { data, error } = await scopeToViewer(
      supabase.from('posts').select(POST_SELECT_QUERY),
      viewerId,
    )
      .eq('id', postId)
      .single();

    if (error || !data) throw error || new Error('Post not found');
    return mapPostData(data);
  } catch (error) {
    console.error('Error fetching post by ID:', (error as Error).message || error);
    return undefined;
  }
};

// ---------------------------------------------------------------------------
// Toggles
// ---------------------------------------------------------------------------
//
// Like and Repost are one operation over two join tables: read the viewer's
// row, delete it if it is there, insert it if it is not. The optimistic cache
// work that wraps them is generic and lives in `lib/optimisticToggle.ts`;
// what varies is only the table and the notification. Save, the third, is a
// save of a post in features/saves (ONE-39), where posts, products, projects
// and profiles are all saved the same way.

type JoinTable = 'likes' | 'reposts';

/**
 * Flip the viewer's row in a join table. Resolves to the state it left
 * behind, so a caller that is not driving the cache can still tell.
 *
 * Throws on failure — the toggle hooks roll their optimistic write back on a
 * rejection, so swallowing the error here would leave the UI claiming
 * something the database never agreed to.
 */
const toggleJoinRow = async (
  table: JoinTable,
  postId: string,
  userId: string,
): Promise<boolean> => {
  const { data: existing, error: readError } = await supabase
    .from(table)
    .select('post_id')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .maybeSingle();

  if (readError) throw readError;

  if (existing) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId);

    if (error) throw error;
    return false;
  }

  const { error } = await supabase.from(table).insert([{ post_id: postId, user_id: userId }]);
  if (error) throw error;
  return true;
};

/**
 * Like or unlike a post as `userId`. The author's notification is written by
 * the database from the like itself (ONE-107).
 */
export const toggleLike = (postId: string, userId: string): Promise<boolean> =>
  toggleJoinRow('likes', postId, userId);

/** Repost or un-repost a post as `userId`. The database notifies the author (ONE-107). */
export const toggleRepost = (postId: string, userId: string): Promise<boolean> =>
  toggleJoinRow('reposts', postId, userId);

// ---------------------------------------------------------------------------
// Publishing, editing and deleting
// ---------------------------------------------------------------------------
//
// Moved here from the old shared service module, whose re-exports of this
// feature formed an import cycle that crashed the app on boot.

/**
 * Publish a post as `authorId` — the profile being acted as.
 *
 * The auth user is still read, for the one thing that is account-scoped: the
 * storage path the media is uploaded under (storage RLS keys on auth.uid()).
 * Everything attributed goes to the profile.
 */
export const publishPost = async (post: Post, authorId: ProfileId): Promise<Post | null> => {
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
                // Account-scoped: storage RLS keys the path on auth.uid(), not a profile.
                uploadUrl = await uploadMedia(uploadUrl, user.id);
            } catch (uploadError) {
                throw new MediaUploadError('Your photo could not be uploaded, so the post was not published.', uploadError);
            }
        }
        // The last line of defence (ONE-56): nothing only this device can read is
        // ever inserted. uploadMedia throws rather than fall back to a data: URL
        // now (ONE-100), but a guard here costs nothing.
        assertRemoteMediaUrl(uploadUrl);
        // --- END NEW UPLOAD LOGIC ---

        const { data: insertData, error } = await supabase
            .from("posts")
            .insert([
                {
                    user_id: authorId,
                    content: content,
                    image_url: uploadUrl, // This is now the permanent URL if an image was uploaded
                    media_type: mediaType,
                    // Optional: untagged posts appear under All only (ONE-49).
                    interest_slug: post.interestSlug ?? null,
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

        // Anyone the text @mentions is notified by the database, from the post
        // itself (ONE-107).
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

export const adminDeletePost = async (postId: string): Promise<void> => {
    const { error } = await supabase
        .from("posts")
        .delete()
        .eq("id", postId);
    if (error) throw error;
};

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

// ---------------------------------------------------------------------------
// Lists derived from a post: who liked or reposted
// ---------------------------------------------------------------------------
//
// Moved out of the old shared service module in ONE-20, unchanged. A
// profile's saved posts moved on to features/saves (ONE-39).

/** The distinct profiles behind a post's likes or reposts. */
const profilesOnPost = async (table: 'likes' | 'reposts', postId: string): Promise<SimpleUser[]> => {
  const { data, error } = await supabase
    .from(table)
    .select('profiles!user_id(id, username, full_name, avatar_url, is_verified)')
    .eq('post_id', postId);
  if (error || !data) return [];

  const uniqueUsers = new Map<string, SimpleUser>();
  data.forEach((item: any) => {
    const profile = Array.isArray(item?.profiles) ? item.profiles[0] : item?.profiles;
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

/** Everyone who liked a post. */
export const getPostLikers = (postId: string): Promise<SimpleUser[]> => profilesOnPost('likes', postId);

/** Everyone who reposted a post. */
export const getPostReposters = (postId: string): Promise<SimpleUser[]> => profilesOnPost('reposts', postId);
