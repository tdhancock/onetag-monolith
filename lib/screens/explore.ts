//
// Pure logic extracted from app/(tabs)/search.tsx (the Explore tab) so the
// grid's geometry and the search results' filtering can be tested without
// mounting the screen.

import type { Hashtag } from '../../types';
import type { ExploreItem, ExploreKind } from '../../features/explore';
import { productRoute } from './products';
import { projectRoute } from './projects';

/** The discovery grid: two columns of square cells (ONE-47). */
export const EXPLORE_COLUMNS = 2;
/** A 1pt white rule between tiles, both ways. */
export const EXPLORE_GRID_GAP = 1;

/** The side of one square tile on a screen `width` points wide. */
export const exploreTileSize = (width: number): number =>
  (width - EXPLORE_GRID_GAP * (EXPLORE_COLUMNS - 1)) / EXPLORE_COLUMNS;

/** The right-hand gap after the tile at `index`: none at the end of a row. */
export const exploreTileGapRight = (index: number): number =>
  index % EXPLORE_COLUMNS === EXPLORE_COLUMNS - 1 ? 0 : EXPLORE_GRID_GAP;

/** Hashtags whose tag contains the query, case-insensitively, as before. */
export const matchingHashtags = (hashtags: readonly Hashtag[], query: string): Hashtag[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return hashtags.filter(h => h.tag.toLowerCase().includes(needle));
};

/** "1 post", "12 posts", "1,204 posts". */
export const hashtagPostCount = (count: number): string =>
  `${count.toLocaleString('en-US')} ${count === 1 ? 'post' : 'posts'}`;

/** What the results say when neither section found anything. */
export const noResultsLabel = (query: string): string => `No results for "${query.trim()}"`;

// ─── The discovery grid (ONE-47) ────────────────────────────────────────

const KIND_LABELS: Record<ExploreKind, string> = { post: 'Post', product: 'Product', project: 'Project' };

/** What a cell says it is, so a tap is never a surprise. */
export const exploreKindLabel = (kind: ExploreKind): string => KIND_LABELS[kind];

/** Each cell opens its item's own screen, never an in-grid preview. */
export const exploreRoute = (item: Pick<ExploreItem, 'kind' | 'id'>): string => {
  switch (item.kind) {
    case 'post':
      return `/post/${encodeURIComponent(item.id)}`;
    case 'product':
      return productRoute(item.id);
    case 'project':
      return projectRoute(item.id);
  }
};

/** What a screen reader announces for a cell. */
export const exploreCellLabel = (item: Pick<ExploreItem, 'kind' | 'title' | 'ownerUsername' | 'tagCount'>): string => {
  const what = item.kind === 'post' ? `Post by @${item.ownerUsername}` : `${exploreKindLabel(item.kind)}: ${item.title}`;
  return item.tagCount > 0 ? `${what}, ${item.tagCount} tagged` : what;
};
