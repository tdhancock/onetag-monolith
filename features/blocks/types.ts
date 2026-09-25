// Domain types for blocks.

/** Someone the signed-in user has blocked. */
export interface BlockedUser {
  /** The blocked account's auth user id — what `blocks` is keyed on. */
  userId: string;
  /** The handle shown for the account — its Individual Profile's, when it has one. */
  username: string;
  /**
   * Every handle the account holds. An account can own an Individual and a
   * Business Profile (ONE-21); blocking the person blocks both, so matching
   * by username has to know all of them.
   */
  usernames: string[];
  name: string | null;
  avatarUrl: string | null;
  /** When the block was made, newest first in the list. */
  blockedAt: string;
}
