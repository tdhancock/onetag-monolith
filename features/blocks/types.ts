// Domain types for blocks.

/** Someone the signed-in user has blocked. */
export interface BlockedUser {
  /** The blocked account's auth user id — what `blocks` is keyed on. */
  userId: string;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  /** When the block was made, newest first in the list. */
  blockedAt: string;
}
