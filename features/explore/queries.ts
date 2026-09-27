// Read hooks for Explore (ONE-47).

import { useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import { fetchExplorePage, nextExploreCursor } from './api';
import { exploreKeys } from './keys';
import type { ExploreCursor, ExploreItem } from './types';

/**
 * The Explore grid, a page at a time, following the feed's pattern (ONE-12):
 * page state lives in the query. Disabled until there is a viewer — what the
 * grid leaves out depends on who is looking.
 */
export const useExploreQuery = (viewerId: string | undefined, interest: string | null = null) =>
  useInfiniteQuery<ExploreItem[], Error, InfiniteData<ExploreItem[], ExploreCursor>, QueryKey, ExploreCursor>({
    queryKey: exploreKeys.grid(viewerId ?? '', interest),
    queryFn: ({ pageParam }) => fetchExplorePage(pageParam, interest),
    initialPageParam: null as ExploreCursor,
    getNextPageParam: nextExploreCursor,
    enabled: Boolean(viewerId),
  });
