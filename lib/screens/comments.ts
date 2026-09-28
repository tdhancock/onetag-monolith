//
// Pure logic for app/comments/[postId].tsx: how a thread's replies show, and
// how a reply starts.

/** A thread shows this many replies before folding the rest behind "View replies". */
export const REPLIES_SHOWN = 2;

/**
 * The replies a thread shows: all of them when there are few or the thread
 * is open, none while a longer one is folded.
 */
export const visibleReplies = <T,>(replies: readonly T[], open: boolean): readonly T[] =>
  open || replies.length <= REPLIES_SHOWN ? replies : [];

/** What a folded thread offers to open, or null when nothing is folded. */
export const hiddenRepliesLabel = (hidden: number): string | null =>
  hidden <= 0 ? null : `View ${hidden} ${hidden === 1 ? 'reply' : 'replies'}`;

/**
 * What a reply starts with: the handle of whoever it answers, so they hear
 * of it wherever in the thread it sits. Nothing when answering yourself.
 */
export const replyPrefill = (username: string, myUsername: string | null | undefined): string =>
  username && username !== myUsername ? `@${username} ` : '';
