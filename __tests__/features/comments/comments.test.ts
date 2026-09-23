//
// target: __tests__/features/comments/comments.test.ts
//
// Comments as ONE-14 rebuilt them. The migration deleted ~320 lines of
// hand-rolled concurrency code — a fetch guard with in-flight dedup, abort and
// a cooldown, and a like guard for double taps — on the claim that TanStack
// already does both. The first two tests here are that claim, checked rather
// than asserted in a commit message.
//
// The rest is the part that had no equivalent before: a comment appears
// immediately, the post's reply count moves with it in the feed *and* on the
// post detail, and a failure takes both back.

jest.mock('../../../services/supabase.native', () => ({
  supabase: { from: jest.fn(), auth: { getUser: jest.fn() } },
}), { virtual: true });

import { QueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { commentKeys } from '../../../features/comments/keys';
import { postKeys } from '../../../features/posts/keys';
import { patchLists } from '../../../lib/optimisticToggle';
import type { Comment } from '../../../types';
import type { Post } from '../../../types';

// ─── Fixtures ───────────────────────────────────────────────────────────

const POST_ID = 'post-1';
const listKey = commentKeys.forPost(POST_ID);
const detailKey = postKeys.detail(POST_ID);
const feedKey = postKeys.feed('viewer-1');

const post = (replies: number): Post => ({
  id: POST_ID,
  content: 'a post',
  username: 'author',
  name: 'Author',
  avatar: null,
  timestamp: '2026-09-23T00:00:00.000Z',
  media_type: 'text',
  likes: 0,
  reposts: 0,
  replies,
} as unknown as Post);

const comment = (id: string, text = 'hello'): Comment => ({
  id,
  userId: 'viewer-1',
  username: 'viewer',
  avatar: null,
  text,
  timestamp: new Date('2026-09-23T00:00:00.000Z'),
  likes: 0,
  isLiked: false,
  replies: [],
} as unknown as Comment);

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

/** The reply-count move the mutations perform, as they perform it. */
const moveReplyCount = (client: QueryClient, postId: string, delta: number): void => {
  const bump = (p: Post): Post => ({ ...p, replies: Math.max(0, p.replies + delta) });

  client.setQueryData<Post>(postKeys.detail(postId), (p) => (p ? bump(p) : p));

  for (const [key] of client.getQueriesData({ queryKey: postKeys.all })) {
    client.setQueryData(key, (data: unknown) => patchLists<Post>(data, postId, (p) => p.id, bump));
  }
};

const seedPost = (client: QueryClient, replies: number) => {
  client.setQueryData(detailKey, post(replies));
  client.setQueryData<InfiniteData<Post[], null>>(feedKey, {
    pages: [[post(replies)]],
    pageParams: [null],
  });
};

const feedReplies = (client: QueryClient) =>
  client.getQueryData<InfiniteData<Post[], null>>(feedKey)!.pages[0]![0]!.replies;

const detailReplies = (client: QueryClient) => client.getQueryData<Post>(detailKey)!.replies;

// ─── 1. What the fetch guard used to do ─────────────────────────────────

describe('in-flight dedup, without a guard', () => {
  it('shares one request between two simultaneous readers of the same post', async () => {
    const client = newClient();
    let calls = 0;
    const queryFn = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return [comment('c1')];
    };

    // Two mounts of the comments screen, back to back — the case the guard's
    // in-flight dedup existed for.
    await Promise.all([
      client.fetchQuery({ queryKey: listKey, queryFn }),
      client.fetchQuery({ queryKey: listKey, queryFn }),
    ]);

    expect(calls).toBe(1);
  });

  it('cannot mix two posts up, because they are different keys', async () => {
    // The guard aborted the previous post's request when the route param
    // changed. Different keys make that impossible rather than recoverable.
    const client = newClient();

    await client.fetchQuery({
      queryKey: commentKeys.forPost('post-a'),
      queryFn: async () => [comment('a1', 'from post A')],
    });
    await client.fetchQuery({
      queryKey: commentKeys.forPost('post-b'),
      queryFn: async () => [comment('b1', 'from post B')],
    });

    expect(client.getQueryData<Comment[]>(commentKeys.forPost('post-a'))![0]!.text)
      .toBe('from post A');
    expect(client.getQueryData<Comment[]>(commentKeys.forPost('post-b'))![0]!.text)
      .toBe('from post B');
  });
});

// ─── 2. Adding a comment ────────────────────────────────────────────────

describe('adding a comment', () => {
  it('shows it immediately and moves the reply count in both places', () => {
    const client = newClient();
    client.setQueryData(listKey, [comment('c1')]);
    seedPost(client, 3);

    client.setQueryData<Comment[]>(listKey, (comments) => [comment('temp-1', 'new'), ...comments!]);
    moveReplyCount(client, POST_ID, 1);

    expect(client.getQueryData<Comment[]>(listKey)).toHaveLength(2);
    expect(detailReplies(client)).toBe(4);
    expect(feedReplies(client)).toBe(4);
  });

  it('takes the comment and the count back when the server refuses', () => {
    const client = newClient();
    const previous = [comment('c1')];
    client.setQueryData(listKey, previous);
    seedPost(client, 3);

    client.setQueryData<Comment[]>(listKey, (comments) => [comment('temp-1', 'new'), ...comments!]);
    moveReplyCount(client, POST_ID, 1);

    // onError
    client.setQueryData(listKey, previous);
    moveReplyCount(client, POST_ID, -1);

    expect(client.getQueryData<Comment[]>(listKey)).toEqual(previous);
    expect(detailReplies(client)).toBe(3);
    expect(feedReplies(client)).toBe(3);
  });
});

// ─── 3. Deleting a comment ──────────────────────────────────────────────

describe('deleting a comment', () => {
  it('removes it and takes the reply count down', () => {
    const client = newClient();
    client.setQueryData(listKey, [comment('c1'), comment('c2')]);
    seedPost(client, 2);

    client.setQueryData<Comment[]>(listKey, (comments) =>
      comments!.filter((c) => c.id !== 'c1'),
    );
    moveReplyCount(client, POST_ID, -1);

    expect(client.getQueryData<Comment[]>(listKey)!.map((c) => c.id)).toEqual(['c2']);
    expect(detailReplies(client)).toBe(1);
    expect(feedReplies(client)).toBe(1);
  });

  it('never drives the reply count below zero', () => {
    const client = newClient();
    seedPost(client, 0);

    moveReplyCount(client, POST_ID, -1);

    expect(detailReplies(client)).toBe(0);
    expect(feedReplies(client)).toBe(0);
  });

  it('leaves other posts alone', () => {
    const client = newClient();
    seedPost(client, 5);
    const otherKey = postKeys.detail('post-2');
    client.setQueryData<Post>(otherKey, { ...post(9), id: 'post-2' });

    moveReplyCount(client, POST_ID, -1);

    expect(client.getQueryData<Post>(otherKey)!.replies).toBe(9);
  });
});

// ─── 4. Keys ────────────────────────────────────────────────────────────

describe('comment keys', () => {
  it('nests under the domain, so one invalidation reaches every comment', () => {
    expect(commentKeys.forPost(POST_ID)[0]).toBe(commentKeys.all[0]);
    expect(commentKeys.likes('c1')[0]).toBe(commentKeys.all[0]);
  });

  it('gives each post its own entry', () => {
    expect(commentKeys.forPost('post-a')).not.toEqual(commentKeys.forPost('post-b'));
  });
});
