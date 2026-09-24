// Read hooks for stories (OneSnaps).

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchLikedStoryIds,
  getMyStories,
  getStories,
  getStoryById,
  getStoryViewCount,
  getStoryViewers,
} from './api';
import { storyKeys } from './keys';
import type { Story, StoryViewer } from './types';

/**
 * How long a list of stories counts as fresh: 10 seconds.
 *
 * Well under the app-wide minute. A story expires 24 hours after it was
 * posted, and a reel held for a minute past that shows something the server
 * would no longer return. The fetch filters by age, so a refetch is what
 * takes an expired story out.
 */
export const STORY_STALE_TIME_MS = 10_000;

/** The reel: live stories from everyone the viewer follows, and their own. */
export const useStoriesQuery = (viewerId: string | undefined) =>
  useQuery<Story[]>({
    queryKey: storyKeys.reel(viewerId ?? ''),
    queryFn: getStories,
    enabled: Boolean(viewerId),
    staleTime: STORY_STALE_TIME_MS,
  });

/** One user's own live stories — "Your story". */
export const useMyStoriesQuery = (userId: string | undefined) =>
  useQuery<Story[]>({
    queryKey: storyKeys.mine(userId ?? ''),
    queryFn: () => getMyStories(userId!),
    enabled: Boolean(userId),
    staleTime: STORY_STALE_TIME_MS,
  });

/** One story, if the viewer may see it. */
export const useStoryQuery = (storyId: string | undefined) =>
  useQuery<Story | null>({
    queryKey: storyKeys.detail(storyId ?? ''),
    queryFn: () => getStoryById(storyId!),
    enabled: Boolean(storyId),
    staleTime: STORY_STALE_TIME_MS,
  });

/** Who has viewed a story. Only its owner should ask. */
export const useStoryViewersQuery = (storyId: string | undefined, enabled = true) =>
  useQuery<StoryViewer[]>({
    queryKey: storyKeys.viewers(storyId ?? ''),
    queryFn: () => getStoryViewers(storyId!),
    enabled: Boolean(storyId) && enabled,
  });

/** How many have viewed a story. Only its owner should ask. */
export const useStoryViewCountQuery = (storyId: string | undefined, enabled = true) =>
  useQuery<number>({
    queryKey: storyKeys.viewCount(storyId ?? ''),
    queryFn: () => getStoryViewCount(storyId!),
    enabled: Boolean(storyId) && enabled,
  });

/** The ids of the stories this user has liked. */
export const useLikedStoryIdsQuery = (userId: string | undefined) =>
  useQuery<string[]>({
    queryKey: storyKeys.liked(userId ?? ''),
    queryFn: () => fetchLikedStoryIds(userId!),
    enabled: Boolean(userId),
  });

/** `isStoryLiked(storyId)`, read from the liked-ids query. */
export const useIsStoryLiked = (userId: string | undefined) => {
  const { data } = useLikedStoryIdsQuery(userId);
  return useCallback((storyId: string) => Boolean(data?.includes(storyId)), [data]);
};

/**
 * Whether any story in a list is one this device has not seen.
 *
 * What `hasNewStory` used to store: derived from the stories and the viewed
 * set instead, so it cannot drift from either.
 */
export const hasUnviewedStory = (
  stories: Story[] | undefined,
  isViewed: (timestamp: string) => boolean,
): boolean => (stories ?? []).some((story) => !isViewed(story.timestamp));
