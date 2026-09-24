// Pure Supabase access for the posts domain.
//
// No React, no hooks, no imports from another feature, and — the point of
// this ticket — no module-level mutable state. Paging is a parameter, not a
// counter living in this module, so two feeds can page independently and a
// second mount starts from the top without anyone having to reset anything.

import { supabase } from '../../services/supabase.native';
import { notifyPostAuthor } from '../../services/notificationWrites';
import type { Post } from './types';

/** Posts requested per feed page. */
export const FEED_PAGE_SIZE = 20;

export const POST_SELECT_QUERY = `
    id,
    user_id,
    content,
    image_url,
    media_type,
    media_aspect_ratio,
    created_at,
    profiles!user_id(
        username,
        avatar_url,
        full_name,
        is_verified
    ),
    likes:likes(count),
    comments:comments(count),
    reposts:reposts(count),
    viewer_like:likes(user_id),
    viewer_repost:reposts(user_id),
    viewer_save:saved_posts(user_id)
`;

/**
 * Restrict the viewer-scoped embeds to one user's rows.
 *
 * `likes:likes(count)` and `viewer_like:likes(user_id)` are separate aliases
 * over the same table, so filtering the alias leaves the total count alone —
 * verified against a local stack: a post liked by two people, one of them the
 * viewer, comes back with `likes: [{count: 2}]` and a one-row `viewer_like`.
 * The embeds are left joins, so a post the viewer has not touched still
 * appears, with an empty array.
 *
 * Signed out there is no viewer, and an impossible id is cheaper than
 * branching the select: every embed comes back empty, which is the truth.
 */
const NO_VIEWER = '00000000-0000-0000-0000-000000000000';

const scopeToViewer = <T>(query: T, viewerId: string | undefined): T => {
  // Cast through a minimal shape: chaining three `.eq()` calls on the
  // PostgREST builder's own generics makes tsc give up with "type
  // instantiation is excessively deep". The runtime chain is the ordinary
  // one; only the types are being stepped around.
  const viewer = viewerId || NO_VIEWER;
  const builder = query as unknown as { eq: (column: string, value: string) => typeof builder };

  return builder
    .eq('viewer_like.user_id', viewer)
    .eq('viewer_repost.user_id', viewer)
    .eq('viewer_save.user_id', viewer) as unknown as T;
};

const toNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const extractCount = (embedded: unknown, fallback: unknown): number => {
  if (Array.isArray(embedded)) {
    const first = embedded[0] as { count?: unknown } | undefined;
    if (first && typeof first === 'object' && 'count' in first) {
      return toNumber(first.count);
    }
    return embedded.length;
  }
  return toNumber(fallback);
};

const normalizeMediaType = (mediaType: unknown, mediaUrl?: string): Post['media_type'] => {
  if (mediaType === 'text') return 'text';
  return mediaUrl ? 'image' : 'text';
};

/** The author ids whose posts make up a user's feed: everyone they follow, plus themselves. */
export const getFeedUserIds = async (userId: string): Promise<string[]> => {
  const { data: followingData, error: followingError } = await supabase
    .from('follows')
    .select('followed_id')
    .eq('follower_id', userId);

  if (followingError) throw followingError;

  const followingIds = (followingData || []).map((f: { followed_id: string }) => f.followed_id);
  return Array.from(new Set([...followingIds, userId]));
};

/**
 * Build the low-quality preview URL used for the blur-up effect.
 *
 * Only Supabase-hosted media can be transformed; anything else has no
 * preview. Returns undefined rather than throwing on a malformed URL.
 */
const previewUrlFor = (mediaUrl: string | undefined): string | undefined => {
  if (!mediaUrl || !mediaUrl.includes('supabase.co')) return undefined;

  try {
    const url = new URL(mediaUrl);
    // /storage/v1/object/public/… → /storage/v1/render/image/public/…
    const pathParts = url.pathname.split('/');
    const objectIndex = pathParts.indexOf('object');
    if (objectIndex === -1) return undefined;

    pathParts.splice(objectIndex, 1, 'render', 'image');
    url.pathname = pathParts.join('/');
    url.searchParams.set('width', '50');
    url.searchParams.set('quality', '40');
    url.searchParams.set('resize', 'cover');
    return url.toString();
  } catch (e) {
    console.error('Failed to create preview URL for post media', e);
    return undefined;
  }
};

/** Map a raw Supabase post row onto the `Post` shape the UI renders. */
export const mapPostData = (p: any): Post => {
  const mediaUrl =
    typeof p.image_url === 'string' && p.image_url.trim().length > 0 ? p.image_url : undefined;

  const profile = Array.isArray(p.profiles) ? p.profiles[0] || {} : p.profiles || {};

  return {
    id: p.id,
    content: typeof p.content === 'string' ? p.content : '',
    media: mediaUrl,
    media_preview_url: previewUrlFor(mediaUrl),
    media_type: normalizeMediaType(p.media_type, mediaUrl),
    media_aspect_ratio: p.media_aspect_ratio,
    timestamp: p.created_at,
    username: profile.username || 'unknown_user',
    avatar: profile.avatar_url || null,
    name: profile.full_name || profile.username,
    isVerified: Boolean(profile.is_verified),
    likes: extractCount(p.likes, p.likes_count),
    reposts: extractCount(p.reposts, p.reposts_count),
    replies: extractCount(p.comments, p.comments_count),
    // The viewer's own state, carried on the entity rather than in a Set
    // beside it — the toggle helper reads and writes it here (ONE-13).
    isLiked: hasViewerRow(p.viewer_like),
    isReposted: hasViewerRow(p.viewer_repost),
    isSaved: hasViewerRow(p.viewer_save),
  };
};

/** A viewer-scoped embed is an array: one row if the viewer is in it. */
const hasViewerRow = (embedded: unknown): boolean =>
  Array.isArray(embedded) ? embedded.length > 0 : Boolean(embedded);

/**
 * A cursor into the feed: the `created_at` of the last post on the previous
 * page. `null` means "start from the top".
 */
export type FeedCursor = string | null;

export interface FetchFeedPageArgs {
  userId: string;
  pageParam: FeedCursor;
}

/**
 * One page of a user's feed, newest first.
 *
 * Paging is by cursor rather than offset: a post published while the reader
 * is scrolling shifts every offset by one and would make them see a
 * duplicate at the page boundary. Comparing against the previous page's last
 * `created_at` is stable under inserts.
 *
 * Throws on failure. The caller is a query with retry and error state
 * configured on the client, so swallowing the error here would take both
 * away and make an outage indistinguishable from an empty feed.
 */
export const fetchFeedPage = async ({
  userId,
  pageParam,
}: FetchFeedPageArgs): Promise<Post[]> => {
  const userIdsToFetch = await getFeedUserIds(userId);

  let query = scopeToViewer(
    supabase
      .from('posts')
      .select(POST_SELECT_QUERY),
    userId,
  )
    .in('user_id', userIdsToFetch)
    .order('created_at', { ascending: false })
    .limit(FEED_PAGE_SIZE);

  if (pageParam) {
    query = query.lt('created_at', pageParam);
  }

  const { data, error } = await query;

  if (error) throw error;
  return (data || []).map(mapPostData);
};

/**
 * The cursor for the page after this one, or `undefined` when there is none.
 *
 * A short page means the end of the feed. Exported so the rule is testable
 * without standing up a query.
 */
export const nextFeedCursor = (page: Post[]): string | undefined => {
  if (page.length < FEED_PAGE_SIZE) return undefined;
  return page[page.length - 1]?.timestamp ?? undefined;
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

/** Recent posts from everyone, for the Explore grid. */
export const fetchTrendingPosts = async (viewerId?: string): Promise<Post[]> => {
  try {
    const { data, error } = await scopeToViewer(
      supabase.from('posts').select(POST_SELECT_QUERY),
      viewerId,
    )
      .order('created_at', { ascending: false })
      .limit(FEED_PAGE_SIZE + 1);

    if (error) throw error;
    return (data || []).map(mapPostData);
  } catch (error) {
    console.error('Error fetching trending posts:', (error as Error).message || error);
    return [];
  }
};

// ---------------------------------------------------------------------------
// Toggles
// ---------------------------------------------------------------------------
//
// Like, Repost and Save are one operation over three join tables: read the
// viewer's row, delete it if it is there, insert it if it is not. The
// optimistic cache work that wraps them is generic and lives in
// `lib/optimisticToggle.ts`; what varies is only the table and, for two of
// them, the notification.

type JoinTable = 'likes' | 'reposts' | 'saved_posts';

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

/** Like or unlike a post as `userId`. Notifies the author on a new like. */
export const toggleLike = async (postId: string, userId: string): Promise<boolean> => {
  const isOn = await toggleJoinRow('likes', postId, userId);
  if (isOn) await notifyPostAuthor(postId, userId, 'like');
  return isOn;
};

/** Repost or un-repost a post as `userId`. Notifies the author on a new repost. */
export const toggleRepost = async (postId: string, userId: string): Promise<boolean> => {
  const isOn = await toggleJoinRow('reposts', postId, userId);
  if (isOn) await notifyPostAuthor(postId, userId, 'repost');
  return isOn;
};

/**
 * Save or unsave a post as `userId`.
 *
 * No notification: a Save is private to the person who made it, unlike a Like
 * or a Repost.
 */
export const toggleSavePost = async (postId: string, userId: string): Promise<boolean> =>
  toggleJoinRow('saved_posts', postId, userId);

