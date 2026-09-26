// Read hooks for the tags domain.

import { useQuery } from '@tanstack/react-query';
import { fetchDestinationScanCount, fetchMyTags, resolveTag, TagResolutionError } from './api';
import { tagKeys } from './keys';
import type { OwnedTag, TagResolution } from './types';
import type { ProfileId } from '../../types';

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

/**
 * Every tag the active profile owns, newest first, with scan counts (ONE-34).
 *
 * Keyed by the profile, so a profile switch reads the other profile's tags —
 * and the switch resets this entry with every other profile-scoped query.
 */
export const useMyTagsQuery = (ownerProfileId: ProfileId | undefined) =>
  useQuery<OwnedTag[]>({
    queryKey: tagKeys.mine(ownerProfileId ?? ''),
    queryFn: () => fetchMyTags(ownerProfileId!),
    enabled: Boolean(ownerProfileId),
  });

/**
 * One of the active profile's tags, read out of its list rather than fetched
 * on its own: there is one cached copy of each tag, so pausing it on its
 * detail screen is the same write as pausing it on the dashboard.
 *
 * `data` is undefined while the list loads, and null when this profile owns
 * no such tag.
 */
export const useMyTagQuery = (ownerProfileId: ProfileId | undefined, tagId: string) =>
  useQuery<OwnedTag[], Error, OwnedTag | null>({
    queryKey: tagKeys.mine(ownerProfileId ?? ''),
    queryFn: () => fetchMyTags(ownerProfileId!),
    enabled: Boolean(ownerProfileId),
    select: (tags) => tags.find((tag) => tag.id === tagId) ?? null,
  });

/**
 * How often the owner's tags pointing at a destination were scanned (ONE-41).
 * Asked for only when the viewer is the owner: nobody else sees scan counts,
 * so for anyone else nothing is fetched.
 */
export const useDestinationScanCountQuery = (
  ownerProfileId: ProfileId | undefined,
  destination: { kind: 'profile' | 'product' | 'project'; id: string },
  isOwner: boolean,
) =>
  useQuery<number>({
    queryKey: tagKeys.destinationScans(ownerProfileId ?? '', destination.kind, destination.id),
    queryFn: () => fetchDestinationScanCount(ownerProfileId!, destination),
    enabled: Boolean(ownerProfileId) && isOwner,
  });
