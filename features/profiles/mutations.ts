// Write hooks for the profiles domain.
//
// Follow is the fourth instance of the like/repost/save shape, so it is a
// configuration of `lib/optimisticToggle.ts` rather than a fourth rollback.
// Like blocking, what it flips is membership of a list — the usernames the
// viewer follows — so the cached list is the entity and the id passed to the
// selectors is the username.
//
// The follower *count* on the target's profile is a second cache entry, and
// the ticket is explicit that both must move together and roll back together.
// The helper snapshots one entity, so the count is moved inside `apply`'s
// sibling callbacks below and restored by the same failure path.
//
// A private profile is followed by request (ONE-63). Asking is a second
// toggle of the same shape over a second list — the usernames asked for — and
// moves no count, since a request isn't a follow.

import { useCallback, useRef } from 'react';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuthUserId } from '../auth';
import {
  createProfile,
  fetchMyProfiles,
  followUser,
  unfollowUser,
  requestFollow,
  cancelFollowRequest,
  approveFollowRequest,
  declineFollowRequest,
  updateBusinessProfile,
  updateUserProfileData,
  uploadAvatar,
  type NewProfile,
} from './api';
import { activeProfileKeys, profileKeys } from './keys';
import { writeActiveProfileId } from './activeProfile';
import { asProfileId } from './types';
import type { FollowCounts } from './queries';
import type {
  AuthUserId,
  BusinessProfileUpdates,
  FollowRequest,
  ProfileId,
  ProfileUpdates,
  UserProfile,
} from './types';
import { useOptimisticToggle } from '../../lib/optimisticToggle';

/** What a screen needs to follow someone. */
export interface FollowTarget {
  userId: string;
  username: string;
  /**
   * `profiles.is_private` (ONE-63). Required, so every Follow button says:
   * a private profile the viewer doesn't follow is asked, not followed.
   */
  isPrivate: boolean;
}

export interface FollowToggle {
  toggle: (target: FollowTarget) => void;
  isPending: boolean;
}

const normalize = (username: string) => username.trim().toLowerCase();

/**
 * Which toggle a tap on Follow drives (ONE-63): the follow itself, or the
 * request. A follow is undone as a follow, private or not. A pending request
 * is withdrawn, even if the profile has since gone public — the server
 * promoted it already if so, and the refetch says Following. Otherwise a
 * private profile is asked and a public one followed.
 */
export const followToggleKind = ({
  following,
  requested,
  isPrivate,
}: {
  following: boolean;
  requested: boolean;
  isPrivate: boolean;
}): 'follow' | 'request' => (!following && (requested || isPrivate) ? 'request' : 'follow');

/**
 * Follow or unfollow, optimistically — or, for a private profile, ask and
 * withdraw the ask (ONE-63).
 *
 * The button reads from the same cached list this writes to, so it flips the
 * moment it is tapped; the target's follower count moves with it and, on
 * failure, both are put back. Unfollowing a private profile is an ordinary
 * unfollow; a pending request, whatever the profile's privacy now, is
 * withdrawn rather than turned into a follow.
 */
export const useToggleFollow = (viewerId: ProfileId | undefined): FollowToggle => {
  const queryClient = useQueryClient();
  const listKey = profileKeys.followingUsernames(viewerId ?? '');

  // The helper is keyed on the toggled id — here the username. The target's
  // user id is what the follower count is cached under, so the pairing is
  // parked on the way in. A ref, not a plain Map: a new Map each render would
  // be empty by the time the mutation reads it.
  const targetsRef = useRef(new Map<string, FollowTarget>());
  const targets = targetsRef.current;

  /** Move the target's follower count, and the viewer's following count. */
  const moveCounts = (target: FollowTarget, delta: number) => {
    queryClient.setQueryData<FollowCounts>(profileKeys.counts(target.userId), (counts) =>
      counts ? { ...counts, followers: Math.max(0, counts.followers + delta) } : counts,
    );

    if (viewerId) {
      queryClient.setQueryData<FollowCounts>(profileKeys.counts(viewerId), (counts) =>
        counts ? { ...counts, following: Math.max(0, counts.following + delta) } : counts,
      );
    }
  };

  const mutation = useOptimisticToggle<string[]>({
    entityKey: () => listKey,
    listKey: profileKeys.all,
    entityId: () => '',

    isOn: (usernames, username) => usernames.includes(normalize(username)),
    count: (usernames) => usernames.length,
    apply: (usernames, next, username) => {
      const name = normalize(username);
      const target = targets.get(name);

      // The counts ride along with the list so a failure restores the list
      // and leaves the counts to be put back by the same error path below.
      if (target) moveCounts(target, next.isOn ? 1 : -1);

      return next.isOn
        ? [...usernames, name]
        : usernames.filter((existing) => existing !== name);
    },

    mutationFn: async (username: string) => {
      if (!viewerId) throw new Error('You must be signed in to follow someone.');

      const target = targets.get(normalize(username));
      if (!target) throw new Error(`No user id known for @${username}.`);

      // onMutate has already flipped the list, so what it says now is the
      // state being asked for.
      const shouldFollow = (queryClient.getQueryData<string[]>(listKey) ?? []).includes(
        normalize(username),
      );

      try {
        return shouldFollow
          ? await followUser(viewerId, target.userId)
          : await unfollowUser(viewerId, target.userId);
      } catch (error) {
        // Put the counts back before rethrowing; the helper restores the list.
        moveCounts(target, shouldFollow ? -1 : 1);
        throw error;
      }
    },
  });

  const requestedKey = profileKeys.requestedUsernames(viewerId ?? '');

  const request = useOptimisticToggle<string[]>({
    entityKey: () => requestedKey,
    listKey: profileKeys.all,
    entityId: () => '',

    isOn: (usernames, username) => usernames.includes(normalize(username)),
    count: (usernames) => usernames.length,
    apply: (usernames, next, username) => {
      const name = normalize(username);
      return next.isOn ? [...usernames, name] : usernames.filter((existing) => existing !== name);
    },

    mutationFn: async (username: string) => {
      if (!viewerId) throw new Error('You must be signed in to follow someone.');

      const target = targets.get(normalize(username));
      if (!target) throw new Error(`No user id known for @${username}.`);

      const shouldRequest = (queryClient.getQueryData<string[]>(requestedKey) ?? []).includes(
        normalize(username),
      );

      return shouldRequest
        ? requestFollow(viewerId, target.userId)
        : cancelFollowRequest(viewerId, target.userId);
    },
  });

  const { mutate } = mutation;
  const { mutate: mutateRequest } = request;

  return {
    toggle: useCallback(
      (target: FollowTarget) => {
        // Signed out, or following yourself — neither is worth a round trip.
        if (!viewerId || target.userId === viewerId) return;

        const name = normalize(target.username);
        targets.set(name, target);

        const kind = followToggleKind({
          following: (queryClient.getQueryData<string[]>(listKey) ?? []).includes(name),
          requested: (queryClient.getQueryData<string[]>(requestedKey) ?? []).includes(name),
          isPrivate: target.isPrivate,
        });

        if (kind === 'request') mutateRequest(target.username);
        else mutate(target.username);
      },
      [viewerId, targets, mutate, mutateRequest, queryClient, listKey, requestedKey],
    ),
    isPending: mutation.isPending || request.isPending,
  };
};

/**
 * Take a request off the owner's list at once, and put it back if the server
 * refuses. Approving and declining differ only in the call.
 */
const useAnswerFollowRequest = (
  profileId: ProfileId | undefined,
  answer: (requestId: string) => Promise<void>,
) => {
  const queryClient = useQueryClient();
  const listKey = profileKeys.followRequests(profileId ?? '');

  return useMutation({
    mutationFn: answer,
    onMutate: async (requestId: string) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<FollowRequest[]>(listKey);
      queryClient.setQueryData<FollowRequest[]>(listKey, (requests) =>
        requests?.filter((request) => request.id !== requestId),
      );
      return { previous };
    },
    onError: (_error, _requestId, context) => {
      queryClient.setQueryData(listKey, context?.previous);
    },
    onSettled: () => {
      if (!profileId) return;
      void queryClient.invalidateQueries({ queryKey: listKey });
      // Approving adds a follower; the counts and the list of them catch up.
      void queryClient.invalidateQueries({ queryKey: profileKeys.counts(profileId) });
      void queryClient.invalidateQueries({ queryKey: profileKeys.followers(profileId) });
    },
  });
};

/** Let a requester follow the active profile (ONE-63). `mutate(requestId)`. */
export const useApproveFollowRequest = (profileId: ProfileId | undefined) =>
  useAnswerFollowRequest(profileId, approveFollowRequest);

/** Turn a request to the active profile down (ONE-63). `mutate(requestId)`. */
export const useDeclineFollowRequest = (profileId: ProfileId | undefined) =>
  useAnswerFollowRequest(profileId, declineFollowRequest);

/**
 * Save profile edits.
 *
 * Edits the profile being acted as, by its profile id. Invalidates every
 * cached copy of this person — the account's own list reads
 * `profileKeys.mine`, everyone else's screens read `profileKeys.byUsername` —
 * so a rename or a new bio shows up wherever they appear.
 */
export const useUpdateProfile = (profileId: ProfileId | undefined) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: ProfileUpdates): Promise<boolean> => {
      if (!profileId) throw new Error('You must be signed in.');
      const saved = await updateUserProfileData(profileId, updates);
      if (!saved) throw new Error('Could not save your profile.');
      return saved;
    },
    onSuccess: (_saved, updates) => {
      // Write through so the screen that submitted does not flash the old
      // values while the refetch is in flight.
      queryClient.setQueriesData<UserProfile[]>({ queryKey: profileKeys.allMine() }, (profiles) =>
        profiles?.map((profile) => (profile.id === profileId ? { ...profile, ...updates } : profile)),
      );

      queryClient.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
};

/**
 * Save a business profile's category, website, location or logo (ONE-23).
 *
 * The same cache treatment as `useUpdateProfile`: written through to the
 * account's own list so the edit screen's caller shows the new values at
 * once, then every profile query is invalidated so other screens catch up.
 */
export const useUpdateBusinessProfile = (profileId: ProfileId | undefined) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: BusinessProfileUpdates): Promise<void> => {
      if (!profileId) throw new Error('You must be signed in.');
      await updateBusinessProfile(profileId, updates);
    },
    onSuccess: (_saved, updates) => {
      queryClient.setQueriesData<UserProfile[]>({ queryKey: profileKeys.allMine() }, (profiles) =>
        profiles?.map((profile) =>
          profile.id === profileId
            ? {
                ...profile,
                business: {
                  category: null,
                  website: null,
                  location: null,
                  ...profile.business,
                  ...updates,
                },
              }
            : profile,
        ),
      );

      queryClient.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
};

/** Upload a new avatar and hand back its public URL for the profile save. */
export const useUploadAvatar = () =>
  useMutation({
    mutationFn: async (localUri: string): Promise<string> => {
      const url = await uploadAvatar(localUri);
      if (!url) throw new Error('Could not upload that image.');
      return url;
    },
  });

// ─── The active profile (ONE-24) ──────────────────────────────────────

/**
 * Make one of the account's profiles the one it acts as — the switch itself,
 * outside the hook so it can be driven directly.
 *
 * Refuses a profile the account does not own. Remembers the choice for the
 * next launch, then updates the cached choice, which moves
 * `useCurrentProfile()` — and with it every write's attribution — at once.
 * Push tokens are untouched: they belong to the account and the device.
 */
export const setActiveProfile = async (
  queryClient: QueryClient,
  authUserId: AuthUserId | undefined,
  profileId: ProfileId,
): Promise<void> => {
  if (!authUserId) throw new Error('You must be signed in.');

  const mineKey = profileKeys.mine(authUserId);
  const owns = (profiles: UserProfile[] | undefined) => Boolean(profiles?.some(profile => profile.id === profileId));

  // A profile created a moment ago may not be in the cached list yet, so
  // read the list afresh before refusing.
  if (!owns(queryClient.getQueryData<UserProfile[]>(mineKey))) {
    const fresh = await queryClient.fetchQuery({
      queryKey: mineKey,
      queryFn: () => fetchMyProfiles(authUserId),
      staleTime: 0,
    });
    if (!owns(fresh)) throw new Error('That profile does not belong to this account.');
  }

  const choiceKey = activeProfileKeys.forAccount(authUserId);
  // A read of the stored choice still in flight would land after this and
  // put the old one back.
  await queryClient.cancelQueries({ queryKey: choiceKey });
  await writeActiveProfileId(authUserId, profileId);
  queryClient.setQueryData<string | null>(choiceKey, profileId);
};

/**
 * Switch the profile the account acts as, as a single call — what the
 * switcher and the create-profile flow drive: `mutate(profileId)`.
 *
 * The previous profile's cached feed, notifications and messages are reset
 * by `useProfileSwitchReset`, which AppProvider mounts, once the screens have
 * re-rendered as the new profile — see activeProfile.ts for why it waits.
 */
export const useSetActiveProfile = () => {
  const queryClient = useQueryClient();
  const authUserId = useAuthUserId();

  return useMutation({
    mutationFn: (profileId: ProfileId) => setActiveProfile(queryClient, authUserId, profileId),
  });
};

// ─── Adding a profile (ONE-26) ────────────────────────────────────────

/**
 * Add a profile to the account and make it the one being acted as.
 *
 * Someone who has just created a business profile wants to be in it, so on
 * success the account's list is refetched — the new profile must be in it
 * before the switch will accept it — and the switch follows. Rejects with a
 * `CreateProfileError` naming a taken handle or kind.
 */
export const useCreateProfile = () => {
  const queryClient = useQueryClient();
  const authUserId = useAuthUserId();

  return useMutation({
    mutationFn: async (input: NewProfile): Promise<UserProfile> => {
      if (!authUserId) throw new Error('You must be signed in.');
      const created = await createProfile(input);

      await queryClient.invalidateQueries({ queryKey: profileKeys.mine(authUserId) });
      await setActiveProfile(queryClient, authUserId, asProfileId(created.id));
      return created;
    },
  });
};
