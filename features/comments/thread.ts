// Comments as threads: each comment on a post, with the replies to it.
//
// Threads are one level deep, as the database keeps them (a reply to a reply
// joins the thread of the comment it answers). The list is the post's
// comments newest first, as it always was; the replies under each read
// oldest first, as a conversation does.

import type { Comment } from './types';

/**
 * Nest a post's comments, newest first as they arrive, into threads. A reply
 * whose comment isn't in the list — hidden by a block, or deleted meanwhile —
 * isn't shown on its own.
 */
export const threadComments = (flat: readonly Comment[]): Comment[] => {
  const replies = new Map<string, Comment[]>();
  for (const comment of flat) {
    if (!comment.parentId) continue;
    const thread = replies.get(comment.parentId) ?? [];
    thread.unshift(comment);
    replies.set(comment.parentId, thread);
  }
  return flat.filter((comment) => !comment.parentId).map((comment) => ({ ...comment, replies: replies.get(comment.id) ?? [] }));
};

/** How many comments a thread's opening comment carries with it: itself and its replies. */
const weight = (comment: Comment): number => 1 + (comment.replies?.length ?? 0);

/**
 * Add a comment: a new thread at the top, or a reply at the end of the thread
 * it answers. A reply to a thread that isn't there goes nowhere.
 */
export const addToThreads = (threads: readonly Comment[], comment: Comment, parentId?: string | null): Comment[] => {
  if (!parentId) return [comment, ...threads];
  return threads.map((thread) =>
    thread.id === parentId ? { ...thread, replies: [...(thread.replies ?? []), comment] } : thread,
  );
};

/**
 * Remove a comment. Removing a thread's opening comment removes its replies
 * with it, as the database does. `removed` is how many comments went, for the
 * post's comment count.
 */
export const removeFromThreads = (
  threads: readonly Comment[],
  commentId: string,
): { threads: Comment[]; removed: number } => {
  let removed = 0;
  const next: Comment[] = [];
  for (const thread of threads) {
    if (thread.id === commentId) {
      removed += weight(thread);
      continue;
    }
    const replies = thread.replies ?? [];
    const kept = replies.filter((reply) => reply.id !== commentId);
    removed += replies.length - kept.length;
    next.push(kept.length === replies.length ? thread : { ...thread, replies: kept });
  }
  return { threads: next, removed };
};

/** The comment a reply attaches to: a thread's opening comment, never a reply. */
export const threadIdFor = (comment: Pick<Comment, 'id' | 'parentId'>): string => comment.parentId ?? comment.id;
