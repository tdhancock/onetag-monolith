//
// target: __tests__/features/comments/thread.test.ts
//
// A post's comments as threads (features/comments/thread): the comments
// newest first, each with its replies beneath it, oldest first, one level
// deep as the database keeps them.

import { addToThreads, removeFromThreads, threadComments, threadIdFor } from '../../../features/comments/thread';
import type { Comment } from '../../../types';

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 28, 12, minutes));

const c = (id: string, minutes: number, parentId: string | null = null): Comment => ({
  id,
  username: `u-${id}`,
  avatar: null,
  text: id,
  timestamp: at(minutes),
  likes: 0,
  isLiked: false,
  parentId,
  replies: [],
});

describe('threadComments', () => {
  // As the API returns them: every comment on the post, newest first.
  const flat = [c('r2', 50, 'a'), c('b', 40), c('r1', 30, 'a'), c('a', 10), c('orphan', 5, 'gone')];

  it('keeps the comments newest first, each with its replies oldest first', () => {
    const threads = threadComments(flat);
    expect(threads.map((t) => t.id)).toEqual(['b', 'a']);
    expect(threads[1]!.replies.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(threads[0]!.replies).toEqual([]);
  });

  it("drops a reply whose comment isn't there, hidden by a block or deleted", () => {
    expect(JSON.stringify(threadComments(flat))).not.toContain('orphan');
  });
});

describe('addToThreads', () => {
  const threads = threadComments([c('b', 40), c('r1', 30, 'a'), c('a', 10)]);

  it('puts a new comment at the top', () => {
    expect(addToThreads(threads, c('new', 60)).map((t) => t.id)).toEqual(['new', 'b', 'a']);
  });

  it('puts a reply at the foot of its thread', () => {
    const next = addToThreads(threads, c('r2', 60, 'a'), 'a');
    expect(next.map((t) => t.id)).toEqual(['b', 'a']);
    expect(next[1]!.replies.map((r) => r.id)).toEqual(['r1', 'r2']);
  });
});

describe('removeFromThreads', () => {
  const threads = threadComments([c('b', 40), c('r2', 35, 'a'), c('r1', 30, 'a'), c('a', 10)]);

  it('removes a reply from its thread, counting one', () => {
    const { threads: next, removed } = removeFromThreads(threads, 'r1');
    expect(removed).toBe(1);
    expect(next[1]!.replies.map((r) => r.id)).toEqual(['r2']);
  });

  it('removes a comment with its replies, counting them all, as the database does', () => {
    const { threads: next, removed } = removeFromThreads(threads, 'a');
    expect(removed).toBe(3);
    expect(next.map((t) => t.id)).toEqual(['b']);
  });

  it('counts nothing for a comment that is not there', () => {
    expect(removeFromThreads(threads, 'nope').removed).toBe(0);
  });
});

describe('threadIdFor', () => {
  it('is the comment itself, or for a reply the comment it answers', () => {
    expect(threadIdFor(c('a', 10))).toBe('a');
    expect(threadIdFor(c('r1', 30, 'a'))).toBe('a');
  });
});
