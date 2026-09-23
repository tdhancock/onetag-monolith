// Read hooks for the profiles domain.

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../services/supabase.native';
import {
  getUserProfile,
  getUserPosts,
  getUserReposts,
  getFollowerUsers,
  getFollowingUsers,
  getFollowerCount,
  getFollowingCount,
  getFollowingList,
  getSmartUserSuggestions,
  mapProfileRow,
} from './api';
import { profileKeys } from './keys';
import type { Post } from '../posts';
import type { SimpleUser, UserProfile } from './types';

/**
 * The placeholder the app has always started from.
 *
 * `userProfile` is the app's identity object, not merely cached data:
 * `app/_layout.tsx` gates push-notification registration on
 * `userProfile?.id`, and screens across the app branch on it. Consumers read
 * an empty-string id as "not ready yet", so the loading shape keeps `id: ''`
 * rather than becoming `undefined` — see the ONE-15 comment for why that
 * convention was kept rather than changed everywhere at once.
 */
export const PLACEHOLDER_PROFILE: UserProfile = {
  id: '',
  name: 'OneTag User',
  username: 'onetag_user',
  bio: 'Hello, I am using OneTag',
  profilePicture: null,
};

/** The signed-in user's own profile row, by auth id. */
const fetchCurrentUser = async (userId: string): Promise<UserProfile> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ...PLACEHOLDER_PROFILE, id: userId };

  return mapProfileRow(data);
};

/**
 * The signed-in user.
 *
 * Always resolves to a usable object: the placeholder while loading or signed
 * out, the real row once it arrives. Nothing downstream has to handle
 * `undefined`, which is what keeps every existing `userProfile?.id` guard
 * behaving as it did.
 */
export const useCurrentUserQuery = (userId: string | undefined) => {
  const query = useQuery<UserProfile>({
    queryKey: profileKeys.me(userId ?? ''),
    queryFn: () => fetchCurrentUser(userId!),
    enabled: Boolean(userId),
  });

  return {
    ...query,
    userProfile: query.data ?? (userId ? { ...PLACEHOLDER_PROFILE, id: userId } : PLACEHOLDER_PROFILE),
  };
};

/** Someone else's profile, by the username the app navigated with. */
export const useProfileQuery = (username: string | undefined) =>
  useQuery<UserProfile | null>({
    queryKey: profileKeys.byUsername(username ?? ''),
    queryFn: () => getUserProfile(username!),
    enabled: Boolean(username),
  });

/** The posts on a profile screen. */
export const useProfilePostsQuery = (userId: string | undefined) =>
  useQuery<Post[]>({
    queryKey: profileKeys.posts(userId ?? ''),
    queryFn: () => getUserPosts(userId!),
    enabled: Boolean(userId),
  });

/** The reposts tab on a profile screen. */
export const useProfileRepostsQuery = (userId: string | undefined) =>
  useQuery<Post[]>({
    queryKey: profileKeys.reposts(userId ?? ''),
    queryFn: () => getUserReposts(userId!),
    enabled: Boolean(userId),
  });

export const useFollowersQuery = (userId: string | undefined) =>
  useQuery<SimpleUser[]>({
    queryKey: profileKeys.followers(userId ?? ''),
    queryFn: () => getFollowerUsers(userId!),
    enabled: Boolean(userId),
  });

export const useFollowingQuery = (userId: string | undefined) =>
  useQuery<SimpleUser[]>({
    queryKey: profileKeys.following(userId ?? ''),
    queryFn: () => getFollowingUsers(userId!),
    enabled: Boolean(userId),
  });

/** Follower and following counts for one profile. */
export interface FollowCounts {
  followers: number;
  following: number;
}

/**
 * The counts under a profile's name.
 *
 * One query rather than two so the follow toggle has a single cache entry to
 * move optimistically and a single one to roll back.
 */
export const useFollowCountsQuery = (userId: string | undefined) =>
  useQuery<FollowCounts>({
    queryKey: profileKeys.counts(userId ?? ''),
    queryFn: async () => {
      const [followers, following] = await Promise.all([
        getFollowerCount(userId!),
        getFollowingCount(userId!),
      ]);

      return { followers, following };
    },
    enabled: Boolean(userId),
  });

/**
 * The usernames the signed-in user follows, lowercased.
 *
 * This is what follow state is read from — the `followedUsernames` Set in
 * AppContext used to hold the same answer, hydrated once per session and
 * re-fetched by hand after every toggle.
 */
export const useFollowingUsernamesQuery = (userId: string | undefined) =>
  useQuery<string[]>({
    queryKey: profileKeys.followingUsernames(userId ?? ''),
    queryFn: () => getFollowingList(userId!),
    enabled: Boolean(userId),
  });

export const useUserSuggestionsQuery = (userId: string | undefined) =>
  useQuery<SimpleUser[]>({
    queryKey: profileKeys.suggestions(userId ?? ''),
    queryFn: () => getSmartUserSuggestions(userId!),
    enabled: Boolean(userId),
  });

/**
 * Follow state for the signed-in user: the list, and the predicate screens
 * actually call.
 *
 * This is what replaced the `followedUsernames` Set on AppContext — same
 * answer, but fetched once by the query cache, shared by every screen, and
 * updated optimistically by `useToggleFollow` instead of being re-fetched by
 * hand after each toggle.
 *
 * Before it resolves nobody is followed, which renders a Follow button for a
 * moment rather than a wrong Following one.
 */
export const useFollowState = (viewerId: string | undefined) => {
  const query = useFollowingUsernamesQuery(viewerId);
  const followed = query.data;

  const isFollowing = useCallback(
    (username: string) => Boolean(followed?.includes(username.trim().toLowerCase())),
    [followed],
  );

  return { following: followed ?? [], isFollowing, query };
};
