// Read hooks for the profiles domain.

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthUserId } from '../auth';
import {
  fetchMyProfiles,
  getUserProfile,
  getUserPosts,
  getUserReposts,
  getFollowerUsers,
  getFollowingUsers,
  getFollowerCount,
  getFollowingCount,
  getFollowingList,
  getSmartUserSuggestions,
} from './api';
import { profileKeys } from './keys';
import type { Post } from '../posts';
import { asProfileId } from './types';
import type { AuthUserId, ProfileId, SimpleUser, UserProfile } from './types';

/**
 * What `useCurrentProfile().profile` shows before there is a real profile.
 *
 * Display only. Its `id` is `''`, and since ONE-22 nothing attributes work to
 * it: acting code reads `profileId`, which stays undefined until the real
 * profile has loaded.
 */
export const PLACEHOLDER_PROFILE: UserProfile = {
  id: '',
  name: 'OneTag User',
  username: 'onetag_user',
  bio: 'Hello, I am using OneTag',
  profilePicture: null,
};

/** Every profile the signed-in account owns, the Individual Profile first. */
export const useMyProfilesQuery = (authUserId: AuthUserId | undefined) =>
  useQuery<UserProfile[]>({
    queryKey: profileKeys.mine(authUserId ?? ''),
    queryFn: () => fetchMyProfiles(authUserId!),
    enabled: Boolean(authUserId),
  });

/** Where the current profile is in its lifecycle. */
export type CurrentProfileStatus =
  /** No session. */
  | 'signed-out'
  /** Signed in; the account's profiles have not arrived yet. */
  | 'loading'
  /** Acting as `profile`. */
  | 'ready'
  /**
   * Signed in, but the account owns no profile — a failed signup trigger or a
   * deleted row. The app routes to onboarding rather than querying with an
   * undefined id.
   */
  | 'missing';

export interface CurrentProfile {
  /**
   * The profile being acted as, for display.
   *
   * Never undefined: while not `ready` it is `PLACEHOLDER_PROFILE`, whose
   * `id` is `''`. That keeps rendering code free of null checks — but it is
   * display-only. Anything attributed to a profile must use `profileId`,
   * which is undefined until there really is one.
   */
  profile: UserProfile;
  /** The acting profile's id. Undefined until `status` is `ready`. */
  profileId: ProfileId | undefined;
  /** The account's id, for account-scoped work. Undefined when signed out. */
  authUserId: AuthUserId | undefined;
  status: CurrentProfileStatus;
}

/**
 * The profile the signed-in account is acting as.
 *
 * With one profile per account this is the only one; with two it is the
 * Individual Profile until the switcher lands (ONE-24), which will choose
 * among `useMyProfilesQuery()` behind this same signature — callers do not
 * change when it does.
 */
export const useCurrentProfile = (): CurrentProfile => {
  const authUserId = useAuthUserId();
  const { data: profiles, isPending } = useMyProfilesQuery(authUserId);

  return useMemo(
    () => resolveCurrentProfile(authUserId, profiles, isPending),
    [authUserId, profiles, isPending],
  );
};

/**
 * The decision behind `useCurrentProfile`, pure so it is tested directly:
 * which profile is acted as, and what state the app is in when there is none.
 */
export const resolveCurrentProfile = (
  authUserId: AuthUserId | undefined,
  profiles: UserProfile[] | undefined,
  isPending: boolean,
): CurrentProfile => {
  if (!authUserId) {
    return { profile: PLACEHOLDER_PROFILE, profileId: undefined, authUserId: undefined, status: 'signed-out' };
  }
  if (isPending || !profiles) {
    return { profile: PLACEHOLDER_PROFILE, profileId: undefined, authUserId, status: 'loading' };
  }

  // Profiles arrive Individual first (fetchMyProfiles); the switcher (ONE-24)
  // replaces this choice without changing the signature.
  const acting = profiles[0];
  if (!acting) {
    return { profile: PLACEHOLDER_PROFILE, profileId: undefined, authUserId, status: 'missing' };
  }
  return { profile: acting, profileId: asProfileId(acting.id), authUserId, status: 'ready' };
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
export const useFollowingUsernamesQuery = (userId: ProfileId | undefined) =>
  useQuery<string[]>({
    queryKey: profileKeys.followingUsernames(userId ?? ''),
    queryFn: () => getFollowingList(userId!),
    enabled: Boolean(userId),
  });

export const useUserSuggestionsQuery = (userId: ProfileId | undefined) =>
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
export const useFollowState = (viewerId: ProfileId | undefined) => {
  const query = useFollowingUsernamesQuery(viewerId);
  const followed = query.data;

  const isFollowing = useCallback(
    (username: string) => Boolean(followed?.includes(username.trim().toLowerCase())),
    [followed],
  );

  return { following: followed ?? [], isFollowing, query };
};
