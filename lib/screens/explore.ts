//
// Pure logic extracted from app/(tabs)/search.tsx (the Explore tab) so the
// grid's geometry and the search results' filtering can be tested without
// mounting the screen.

import type { Hashtag } from '../../types';

/** The trending grid keeps three columns (M6's ONE-47 rebuilds it). */
export const EXPLORE_COLUMNS = 3;
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
