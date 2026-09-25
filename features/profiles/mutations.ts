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

import { useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { followUser, unfollowUser, updateBusinessProfile, updateUserProfileData, uploadAvatar } from './api';
import { profileKeys } from './keys';
import type { FollowCounts } from './queries';
import type { BusinessProfileUpdates, ProfileId, ProfileUpdates, UserProfile } from './types';
import { useOptimisticToggle } from '../../lib/optimisticToggle';

/** What a screen needs to follow someone. */
export interface FollowTarget {
  userId: string;
  username: string;
}

export interface FollowToggle {
  toggle: (target: FollowTarget) => void;
  isPending: boolean;
}

const normalize = (username: string) => username.trim().toLowerCase();

/**
 * Follow or unfollow, optimistically.
 *
 * The button reads from the same cached list this writes to, so it flips the
 * moment it is tapped; the target's follower count moves with it and, on
 * failure, both are put back.
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

  const { mutate } = mutation;

  return {
    toggle: useCallback(
      (target: FollowTarget) => {
        // Signed out, or following yourself — neither is worth a round trip.
        if (!viewerId || target.userId === viewerId) return;

        targets.set(normalize(target.username), target);
        mutate(target.username);
      },
      [viewerId, targets, mutate],
    ),
    isPending: mutation.isPending,
  };
};

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
                  logoUrl: null,
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
