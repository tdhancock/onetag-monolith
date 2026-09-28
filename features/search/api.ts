// Pure Supabase access for search (ONE-48).
//
// No React, no hooks, no imports from another feature. Each type has its own
// database function, and each is searched the way that suits it — see
// supabase/migrations/*_search.sql:
//
//   * profiles: ILIKE on handle and name, exact-prefix first. A handle is an
//     identifier, not language, so full-text ranking would only get in the way.
//   * posts, products, projects: full text over their tsvector columns,
//     ranked with ts_rank, every word matched as a prefix.
//
// The mismatch is deliberate. Blocks and private projects are filtered in
// the functions, as well as by RLS.

import { supabase } from '../../services/supabase.native';
import type { SearchPost, SearchProduct, SearchProfile, SearchProject } from './types';

/** How many results a full tab shows. "All" shows the first few of each. */
export const SEARCH_RESULT_LIMIT = 30;

const rows = async <T>(fn: string, args: Record<string, unknown>): Promise<T[]> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data ?? []) as T[];
};

export const searchProfiles = async (query: string): Promise<SearchProfile[]> =>
  (await rows<any>('search_profiles', { p_query: query, p_limit: SEARCH_RESULT_LIMIT })).map((r) => ({
    id: r.id,
    username: r.username,
    name: r.full_name || r.username,
    avatarUrl: r.avatar_url ?? null,
    isVerified: r.is_verified === true,
    profileType: r.profile_type === 'business' ? 'business' : 'individual',
    isPrivate: r.is_private === true,
  }));

export const searchPosts = async (query: string): Promise<SearchPost[]> =>
  (await rows<any>('search_posts', { p_query: query, p_limit: SEARCH_RESULT_LIMIT })).map((r) => ({
    id: r.id,
    content: r.content ?? '',
    imageUrl: r.image_url || null,
    mediaType: r.media_type === 'image' && r.image_url ? 'image' : 'text',
    authorUsername: r.author_username,
    authorAvatarUrl: r.author_avatar_url ?? null,
  }));

export const searchProducts = async (query: string, category: string | null = null): Promise<SearchProduct[]> =>
  (await rows<any>('search_products', { p_query: query, p_category: category, p_limit: SEARCH_RESULT_LIMIT })).map(
    (r) => ({
      id: r.id,
      name: r.name,
      category: r.category ?? null,
      imageUrl: r.image_url ?? null,
      businessUsername: r.business_username,
      businessName: r.business_name,
    }),
  );

/**
 * `publicOnly` leaves out even the caller's own private projects — for the
 * composer's tag picker, since a tag may only point at a public project.
 */
export const searchProjects = async (
  query: string,
  category: string | null = null,
  publicOnly = false,
): Promise<SearchProject[]> =>
  (
    await rows<any>('search_projects', {
      p_query: query,
      p_category: category,
      p_limit: SEARCH_RESULT_LIMIT,
      p_public_only: publicOnly,
    })
  ).map(
    (r) => ({
      id: r.id,
      name: r.name,
      category: r.project_type ?? null,
      coverUrl: r.cover_url ?? null,
      ownerUsername: r.owner_username,
    }),
  );
