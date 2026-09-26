// Read hooks for the profiles domain.

import { useCallback, useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useAuthUserId } from '../auth';
import {
  fetchMyProfiles,
  getUserProfile,
  getUserPosts,
  getUserPostCount,
  getUserReposts,
  getFollowerUsers,
  getFollowingUsers,
  getFollowerCount,
  getFollowingCount,
  getFollowingList,
  getSmartUserSuggestions,
  searchUsers,
} from './api';
import { activeProfileKeys, profileKeys } from './keys';
import { chooseActiveProfile, readActiveProfileId } from './activeProfile';
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

/**
 * The profile id this account chose to act as on this device, or null for no
 * choice (ONE-24). Read from AsyncStorage once and then held here; the
 * switch writes both. Not trusted on its own — `useCurrentProfile` uses it
 * only when the account owns that profile.
 */
export const useActiveProfileIdQuery = (authUserId: AuthUserId | undefined) =>
  useQuery<string | null>({
    queryKey: activeProfileKeys.forAccount(authUserId ?? ''),
    queryFn: () => readActiveProfileId(authUserId!),
    enabled: Boolean(authUserId),
    // Only this device writes it, and the switch writes the cache directly.
    staleTime: Infinity,
    retry: false,
    // A read of local storage, not the network: it must resolve offline too,
    // or the app would sit in `loading` with no connection.
    networkMode: 'always',
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
 * The profile the signed-in account is acting as — the *active profile*
 * (ONE-24).
 *
 * The account's stored choice when it owns that profile, otherwise its
 * Individual Profile. Every write in the app is attributed to the
 * `profileId` this returns, so it stays `loading` until both the account's
 * profiles and its stored choice have been read: acting as the Individual
 * for the moment before a Business choice loads would be a misattribution,
 * not a flicker.
 */
export const useCurrentProfile = (): CurrentProfile => {
  const authUserId = useAuthUserId();
  const { data: profiles, isPending: profilesPending } = useMyProfilesQuery(authUserId);
  const { data: activeProfileId, isPending: choicePending } = useActiveProfileIdQuery(authUserId);
  const isPending = profilesPending || choicePending;

  return useMemo(
    () => resolveCurrentProfile(authUserId, profiles, isPending, activeProfileId),
    [authUserId, profiles, isPending, activeProfileId],
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
  /** The stored choice, trusted only if `profiles` contains it. */
  activeProfileId?: string | null,
): CurrentProfile => {
  if (!authUserId) {
    return { profile: PLACEHOLDER_PROFILE, profileId: undefined, authUserId: undefined, status: 'signed-out' };
  }
  if (isPending || !profiles) {
    return { profile: PLACEHOLDER_PROFILE, profileId: undefined, authUserId, status: 'loading' };
  }

  const acting = chooseActiveProfile(profiles, activeProfileId);
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

/** How many posts a profile has, for its header's Posts figure. */
export const useProfilePostCountQuery = (userId: string | undefined) =>
  useQuery<number>({
    queryKey: profileKeys.postCount(userId ?? ''),
    queryFn: () => getUserPostCount(userId!),
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

/** A profile a picker offers: either kind, found by its handle. */
export interface ProfileSearchResult {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  isVerified: boolean;
  profileType: 'individual' | 'business';
}

/** The fewest characters a profile search runs on, as sharing a post has it. */
export const PROFILE_SEARCH_MIN_LENGTH = 2;

/**
 * Profiles by handle, through `searchUsers`, for a picker such as a project's
 * contributors (ONE-42). Runs once the search has two characters; the last
 * results stay up while the next search runs.
 */
export const useProfileSearchQuery = (query: string) => {
  const term = query.trim();
  return useQuery<ProfileSearchResult[]>({
    queryKey: profileKeys.search(term),
    queryFn: async () =>
      (await searchUsers(term)).map((row: any) => ({
        id: row.id,
        username: row.username,
        name: row.full_name || row.username,
        avatarUrl: row.avatar_url ?? null,
        isVerified: row.is_verified === true,
        profileType: row.profile_type === 'business' ? 'business' : 'individual',
      })),
    enabled: term.length >= PROFILE_SEARCH_MIN_LENGTH,
    placeholderData: keepPreviousData,
  });
};
