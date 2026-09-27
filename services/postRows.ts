// The post row: what to select, and how to map it onto `Post`.
//
// Moved out of features/posts/api.ts so any feature that embeds a post in its
// own rows — a shared post in a message, a post behind a notification — can
// map it without importing features/posts, which a feature's api.ts may not
// do (features/README.md, rule 1). A service is the shared ground, as with
// profileBootstrap.ts. features/posts re-exports both, unchanged.

import type { EmbeddedTag, EmbeddedTagDestination, Post } from '../types';

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
    viewer_save:saves(profile_id),
    embedded_tags:tags!host_post_id(
        id,
        active,
        tag_x_pct,
        tag_y_pct,
        dest_profile_id,
        dest_product_id,
        dest_project_id,
        dest_profile:profiles!dest_profile_id(id, username, full_name, avatar_url, profile_type),
        dest_product:products!dest_product_id(id, name, product_media(url, media_type, sort_order)),
        dest_project:projects!dest_project_id(id, name, cover_url)
    )
`;

/**
 * Restrict the viewer-scoped embeds to one profile's rows.
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
 *
 * Here rather than in features/posts so any feature listing posts — saved
 * posts (features/saves) included — scopes them the same way.
 */
const NO_VIEWER = '00000000-0000-0000-0000-000000000000';

export const scopePostsToViewer = <T>(query: T, viewerId: string | undefined): T => {
  // Cast through a minimal shape: chaining three `.eq()` calls on the
  // PostgREST builder's own generics makes tsc give up with "type
  // instantiation is excessively deep". The runtime chain is the ordinary
  // one; only the types are being stepped around.
  const viewer = viewerId || NO_VIEWER;
  const builder = query as unknown as { eq: (column: string, value: string) => typeof builder };

  return builder
    .eq('viewer_like.user_id', viewer)
    .eq('viewer_repost.user_id', viewer)
    .eq('viewer_save.profile_id', viewer) as unknown as T;
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
    embeddedTags: mapEmbeddedTags(p.embedded_tags),
  };
};

// ─── Embedded Tags (ONE-45) ─────────────────────────────────────────────
//
// Read in POST_SELECT_QUERY beside the counts, so a feed page of twenty posts
// is one request, not twenty-one. `tags!host_post_id` only ever finds embedded
// tags — no other kind has a host post (ONE-44) — and RLS makes each readable
// wherever its post is.

const one = <T>(embed: T | T[] | null | undefined): T | null =>
  Array.isArray(embed) ? embed[0] ?? null : embed ?? null;

/** The first photo by sort order: a product's representative image. */
const productImage = (media: unknown): string | null => {
  if (!Array.isArray(media)) return null;
  const photo = [...media]
    .filter((m: any) => m && m.media_type !== 'video' && typeof m.url === 'string')
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0];
  return photo ? photo.url : null;
};

const embeddedDestination = (row: any): EmbeddedTagDestination | null => {
  const profile = one<any>(row.dest_profile);
  if (row.dest_profile_id && profile) {
    return {
      kind: 'profile',
      profileId: profile.id,
      username: profile.username,
      profileType: profile.profile_type === 'business' ? 'business' : 'individual',
      name: profile.full_name || profile.username,
      imageUrl: profile.avatar_url ?? null,
    };
  }
  const product = one<any>(row.dest_product);
  if (row.dest_product_id && product) {
    return { kind: 'product', productId: product.id, name: product.name, imageUrl: productImage(product.product_media) };
  }
  const project = one<any>(row.dest_project);
  if (row.dest_project_id && project) {
    return { kind: 'project', projectId: project.id, name: project.name, imageUrl: project.cover_url ?? null };
  }
  // Gone, or a project made private since it was tagged: nothing to show.
  return null;
};

/**
 * The live tags on a post that still have somewhere to go. A paused tag, or
 * one whose destination the viewer cannot see, is left off rather than drawn
 * as a tag that leads nowhere.
 */
export const mapEmbeddedTags = (rows: unknown): EmbeddedTag[] => {
  if (!Array.isArray(rows)) return [];
  const tags: EmbeddedTag[] = [];
  for (const row of rows as any[]) {
    if (!row || row.active === false) continue;
    const destination = embeddedDestination(row);
    const xPct = Number(row.tag_x_pct);
    const yPct = Number(row.tag_y_pct);
    if (!destination || !Number.isFinite(xPct) || !Number.isFinite(yPct)) continue;
    tags.push({ id: row.id, xPct, yPct, destination });
  }
  return tags;
};

/** A viewer-scoped embed is an array: one row if the viewer is in it. */
const hasViewerRow = (embedded: unknown): boolean =>
  Array.isArray(embedded) ? embedded.length > 0 : Boolean(embedded);
