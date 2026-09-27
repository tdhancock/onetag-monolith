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

/** What the results say when nothing matched, with a way to widen it. */
export const noResultsLabel = (query: string): string => `No results for "${query.trim()}"`;

/** The suggestion under "No results": search is every-word, so fewer words find more. */
export const NO_RESULTS_HINT = 'Try fewer words, or a broader one.';

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

// ─── Search results (ONE-48) ────────────────────────────────────────────

export type SearchTab = 'all' | 'profiles' | 'posts' | 'products' | 'projects';

export const SEARCH_TABS: { value: SearchTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'profiles', label: 'Profiles' },
  { value: 'posts', label: 'Posts' },
  { value: 'products', label: 'Products' },
  { value: 'projects', label: 'Projects' },
];

/** How many of each type "All" shows before its "See all" link. */
export const ALL_TAB_PREVIEW = 3;

/** The categories present in a set of results, alphabetical, for the filter sheet. */
export const categoriesOf = (items: readonly { category: string | null }[]): string[] =>
  [...new Set(items.map((i) => i.category?.trim()).filter((c): c is string => Boolean(c)))].sort((a, b) =>
    a.localeCompare(b),
  );

/** The filter button's label: the chosen category, or an invitation to pick one. */
export const categoryFilterLabel = (category: string | null): string => (category ? `Category: ${category}` : 'Category');
