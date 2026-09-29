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

/**
 * Asked before deleting a comment others have replied to: its replies go
 * with it, as on Instagram, and that is everyone's words, not only yours.
 * Null when it has none, and the comment goes at once.
 */
export const deleteCommentConfirm = (replies: number) =>
  replies <= 0
    ? null
    : {
        title: 'Delete this comment?',
        body: `Its ${replies === 1 ? 'reply' : `${replies} replies`} will be deleted too.`,
        confirm: 'Delete',
      };

/** How long a comment opened from a notification stays marked. */
export const FOCUS_HIGHLIGHT_MS = 2500;

/**
 * Where a comment sits among a post's threads: the index of its thread, and
 * whether it is a reply the thread folds away. Null when it isn't there —
 * deleted since, or hidden by a block.
 */
export const locateComment = (
  threads: readonly { id: string; replies?: readonly { id: string }[] }[],
  commentId: string,
): { index: number; threadId: string; folded: boolean } | null => {
  for (let index = 0; index < threads.length; index += 1) {
    const thread = threads[index]!;
    if (thread.id === commentId) return { index, threadId: thread.id, folded: false };
    const replies = thread.replies ?? [];
    if (replies.some((reply) => reply.id === commentId)) {
      return { index, threadId: thread.id, folded: visibleReplies(replies, false).length === 0 };
    }
  }
  return null;
};
