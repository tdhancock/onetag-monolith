// The only place profile query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('profiles');

export const profileKeys = {
  ...base,
  /**
   * Every profile the signed-in account owns (ONE-22).
   *
   * Keyed by the auth user id — the account — because that is all the app
   * knows before it knows which profile it is acting as.
   */
  mine: (authUserId: string) => [...base.all, 'mine', authUserId] as const,
  /** Every account's `mine` list — for writes that know the profile, not the account. */
  allMine: () => [...base.all, 'mine'] as const,
  /** Someone's profile, by username — what every screen navigates with. */
  byUsername: (username: string) => [...base.details(), username] as const,
  /** The posts on a profile screen. */
  posts: (userId: string) => [...base.all, 'posts', userId] as const,
  /** The reposts tab. */
  reposts: (userId: string) => [...base.all, 'reposts', userId] as const,
  /** Who follows this user. */
  followers: (userId: string) => [...base.all, 'followers', userId] as const,
  /** Who this user follows, as renderable rows. */
  following: (userId: string) => [...base.all, 'following', userId] as const,
  /**
   * Just the usernames the viewer follows — what follow state is read from.
   *
   * A separate key from `following` on purpose: two queries under one key
   * would be two different shapes in one cache entry, and whichever resolved
   * last would win.
   */
  followingUsernames: (userId: string) => [...base.all, 'following-usernames', userId] as const,
  /** Follower/following counts, which the follow toggle moves optimistically. */
  counts: (userId: string) => [...base.all, 'counts', userId] as const,
  /** Suggested accounts for one viewer. */
  suggestions: (userId: string) => [...base.all, 'suggestions', userId] as const,
};
