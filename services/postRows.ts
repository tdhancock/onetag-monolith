// The post row: what to select, and how to map it onto `Post`.
//
// Moved out of features/posts/api.ts so any feature that embeds a post in its
// own rows — a shared post in a message, a post behind a notification — can
// map it without importing features/posts, which a feature's api.ts may not
// do (features/README.md, rule 1). A service is the shared ground, as with
// profileBootstrap.ts. features/posts re-exports both, unchanged.

import type { Post } from '../types';

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
