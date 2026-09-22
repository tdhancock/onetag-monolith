// Pure Supabase access for the posts domain.
//
// No React, no hooks, no imports from another feature, and — the point of
// this ticket — no module-level mutable state. Paging is a parameter, not a
// counter living in this module, so two feeds can page independently and a
// second mount starts from the top without anyone having to reset anything.

import { supabase } from '../../services/supabase.native';
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
    reposts:reposts(count)
`;

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
  };
};

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

  let query = supabase
    .from('posts')
    .select(POST_SELECT_QUERY)
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
export const fetchPostById = async (postId: string): Promise<Post | undefined> => {
  try {
    const { data, error } = await supabase
      .from('posts')
      .select(POST_SELECT_QUERY)
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
export const fetchTrendingPosts = async (): Promise<Post[]> => {
  try {
    const { data, error } = await supabase
      .from('posts')
      .select(POST_SELECT_QUERY)
      .order('created_at', { ascending: false })
      .limit(FEED_PAGE_SIZE + 1);

    if (error) throw error;
    return (data || []).map(mapPostData);
  } catch (error) {
    console.error('Error fetching trending posts:', (error as Error).message || error);
    return [];
  }
};
