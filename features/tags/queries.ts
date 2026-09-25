// Read hooks for the tags domain.

import { useQuery } from '@tanstack/react-query';
import { resolveTag, TagResolutionError } from './api';
import { tagKeys } from './keys';
import type { TagResolution } from './types';

/**
 * What a short code resolves to (ONE-30).
 *
 * Always read fresh. A resolution decides where someone is sent, and a tag
 * paused since it was last read — or one read from the persisted cache on a
 * cold start — must not send them there. The route acts only on a fetch made
 * after it mounted (`isFetchedAfterMount`); these options make sure one runs.
 *
 * `networkMode: 'always'` because nothing tells TanStack when a phone is
 * offline here: the fetch runs, fails with status 0, and the screen says so,
 * rather than the query pausing and the screen resolving forever. An offline
 * failure is not retried — the screen offers Try again — and a server one is
 * retried once.
 */
export const useTagQuery = (shortCode: string) =>
  useQuery<TagResolution, Error>({
    queryKey: tagKeys.resolution(shortCode),
    // Always enabled: an empty or malformed code resolves to not-found
    // without a request, rather than leaving the screen resolving forever.
    queryFn: () => resolveTag(shortCode),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    networkMode: 'always',
    retry: (failureCount, error) =>
      failureCount < 1 && !(error instanceof TagResolutionError && error.reason === 'offline'),
  });
