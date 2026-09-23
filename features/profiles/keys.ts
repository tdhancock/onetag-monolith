// The only place profile query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('profiles');

export const profileKeys = {
  ...base,
  /**
   * The signed-in user's own identity row.
   *
   * Separate from `detail`, which is keyed by username: the current user is
   * looked up by auth id, and the app reads it long before it knows what
   * their username is.
   */
  me: (userId: string) => [...base.all, 'me', userId] as const,
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
