// Pure Supabase access for Explore (ONE-47).
//
// No React, no hooks, no imports from another feature.

import { supabase } from '../../services/supabase.native';
import type { ExploreCursor, ExploreItem, ExploreItemRow } from './types';

/** Cells per page: twelve rows of the two-column grid. */
export const EXPLORE_PAGE_SIZE = 24;

export const mapExploreRow = (row: ExploreItemRow): ExploreItem => ({
  kind: row.kind,
  id: row.id,
  key: row.item_key,
  ownerProfileId: row.owner_profile_id,
  ownerUsername: row.owner_username,
  title: row.title ?? '',
  imageUrl: typeof row.image_url === 'string' && row.image_url.trim() ? row.image_url : null,
  mediaType: row.media_type === 'text' || (row.kind === 'post' && !row.image_url) ? 'text' : 'image',
  tagCount: Number(row.tag_count) || 0,
  score: Number(row.score),
});

/**
 * One page of the grid, strictly after `cursor`. The ordering, the
 * exclusions (the viewer's own content, blocks both ways, private content)
 * and the paging all live in `explore_items`, so a page is always full-length.
 */
export const fetchExplorePage = async (cursor: ExploreCursor, interest: string | null = null): Promise<ExploreItem[]> => {
  const { data, error } = await supabase.rpc('explore_items', {
    p_after_score: cursor?.score ?? null,
    p_after_key: cursor?.key ?? null,
    p_limit: EXPLORE_PAGE_SIZE,
    // Null for All. A slug narrows the grid in the query itself (ONE-49).
    p_interest: interest,
  });
  if (error) throw error;
  return ((data ?? []) as ExploreItemRow[]).map(mapExploreRow);
};

/** The cursor after a page, or undefined once a short page says there is no more. */
export const nextExploreCursor = (page: ExploreItem[]): ExploreCursor | undefined => {
  if (page.length < EXPLORE_PAGE_SIZE) return undefined;
  const last = page[page.length - 1];
  return { score: last.score, key: last.key };
};

/**
 * Every page's items once, in order. Engagement can move a row between one
 * page's fetch and the next, so the same item could come back twice; the
 * first sighting wins.
 */
export const flattenExplorePages = (pages: ExploreItem[][]): ExploreItem[] => {
  const seen = new Set<string>();
  const items: ExploreItem[] = [];
  for (const page of pages) {
    for (const item of page) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      items.push(item);
    }
  }
  return items;
};
