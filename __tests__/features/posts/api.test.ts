//
// target: __tests__/features/posts/api.test.ts
// The posts domain's Supabase layer — features/posts/api.
//
// The point of ONE-12 is that paging is an argument rather than module-level
// state, so most of what is asserted here is about the cursor: that the first
// page asks for no cursor, that a later page asks for the previous page's
// last timestamp, and that two sequences do not interfere.

jest.mock('../../../services/supabase.native', () => ({
  supabase: { from: jest.fn() },
}), { virtual: true });

/** Records the chain a query built, so the test can assert on it. */
type Call = { lt?: string; limit?: number; inIds?: string[] };

let calls: Call[] = [];
let postsResult: { data: unknown[] | null; error: unknown } = { data: [], error: null };
let followsResult: { data: unknown[] | null; error: unknown } = { data: [], error: null };

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { supabase } = require('../../../services/supabase.native');

supabase.from.mockImplementation((table: string) => {
  if (table === 'follows') {
    return { select: () => ({ eq: () => Promise.resolve(followsResult) }) };
  }

  const call: Call = {};
  calls.push(call);

  const chain = {
    in: (_col: string, ids: string[]) => {
      call.inIds = ids;
      return chain;
    },
    order: () => chain,
    limit: (n: number) => {
      call.limit = n;
      return Object.assign(Promise.resolve(postsResult), chain);
    },
    lt: (_col: string, cursor: string) => {
      call.lt = cursor;
      return Object.assign(Promise.resolve(postsResult), chain);
    },
    select: () => chain,
    eq: () => chain,
  };
  return chain;
});

import {
  fetchFeedPage,
  nextFeedCursor,
  FEED_PAGE_SIZE,
  mapPostData,
} from '../../../features/posts/api';
import type { Post } from '../../../types';

const row = (id: string, createdAt: string) => ({
  id,
  content: 'hello',
  created_at: createdAt,
  profiles: { username: 'layla', full_name: 'Layla', avatar_url: null, is_verified: true },
  likes: [{ count: 2 }],
  comments: [{ count: 1 }],
  reposts: [{ count: 0 }],
});

/** A page of posts, newest first, one minute apart — as the feed orders them. */
const BASE_MS = Date.UTC(2026, 8, 21, 12, 0, 0);
const page = (n: number): Post[] =>
  Array.from({ length: n }, (_, i) =>
    mapPostData(row(`p-${i}`, new Date(BASE_MS - i * 60_000).toISOString())),
  );

beforeEach(() => {
  calls = [];
  postsResult = { data: [], error: null };
  followsResult = { data: [{ followed_id: 'friend-1' }], error: null };
});

// ─── 1. No module-level state ───────────────────────────────────────────

describe('fetchFeedPage — paging is an argument', () => {
  it('asks for no cursor on the first page', async () => {
    await fetchFeedPage({ userId: 'me', pageParam: null });
    expect(calls[0]!.lt).toBeUndefined();
    expect(calls[0]!.limit).toBe(FEED_PAGE_SIZE);
  });

  it('asks for posts older than the cursor on a later page', async () => {
    await fetchFeedPage({ userId: 'me', pageParam: '2026-09-21T10:00:00Z' });
    expect(calls[0]!.lt).toBe('2026-09-21T10:00:00Z');
  });

  it('two sequences do not interfere — the second starts from the top', async () => {
    // This is the whole ticket: the old module-level cursor meant a second
    // mount silently continued the first one's pagination.
    await fetchFeedPage({ userId: 'me', pageParam: null });
    await fetchFeedPage({ userId: 'me', pageParam: '2026-09-21T10:00:00Z' });
    await fetchFeedPage({ userId: 'me', pageParam: null });

    expect(calls.map((c) => c.lt)).toEqual([undefined, '2026-09-21T10:00:00Z', undefined]);
  });

  it('fetches the feed audience: everyone followed, plus the reader', async () => {
    await fetchFeedPage({ userId: 'me', pageParam: null });
    expect(calls[0]!.inIds).toEqual(['friend-1', 'me']);
  });

  it('does not duplicate the reader when they somehow follow themselves', async () => {
    followsResult = { data: [{ followed_id: 'me' }], error: null };
    await fetchFeedPage({ userId: 'me', pageParam: null });
    expect(calls[0]!.inIds).toEqual(['me']);
  });
});

// ─── 2. Errors reach the query ──────────────────────────────────────────

describe('fetchFeedPage — errors', () => {
  it('throws rather than returning an empty page', async () => {
    // Swallowing here would take away the query's retry and error state, and
    // make an outage indistinguishable from an empty feed.
    postsResult = { data: null, error: { message: 'boom' } };
    await expect(fetchFeedPage({ userId: 'me', pageParam: null })).rejects.toBeDefined();
  });

  it('propagates a follows failure too', async () => {
    followsResult = { data: null, error: { message: 'nope' } };
    await expect(fetchFeedPage({ userId: 'me', pageParam: null })).rejects.toBeDefined();
  });

  it('returns an empty page for no rows without throwing', async () => {
    postsResult = { data: [], error: null };
    await expect(fetchFeedPage({ userId: 'me', pageParam: null })).resolves.toEqual([]);
  });
});

// ─── 3. The end-of-feed rule ────────────────────────────────────────────

describe('nextFeedCursor', () => {
  it('returns undefined when a page comes back short', () => {
    // The acceptance criterion: a short page ends pagination.
    expect(nextFeedCursor(page(FEED_PAGE_SIZE - 1))).toBeUndefined();
    expect(nextFeedCursor([])).toBeUndefined();
  });

  it('returns the last post timestamp on a full page', () => {
    const full = page(FEED_PAGE_SIZE);
    expect(nextFeedCursor(full)).toBe(full[full.length - 1]!.timestamp);
  });

  it('hands back a cursor strictly older than the page it came from', () => {
    // Otherwise the next page would re-fetch the post it started from.
    const full = page(FEED_PAGE_SIZE);
    const cursor = nextFeedCursor(full)!;
    expect(full.filter((p) => String(p.timestamp) < cursor)).toHaveLength(0);
    expect(cursor).toBe(full.at(-1)!.timestamp);
  });
});

// ─── 4. Mapping ─────────────────────────────────────────────────────────

describe('mapPostData', () => {
  it('maps a row onto the Post shape the UI renders', () => {
    const post = mapPostData(row('p-1', '2026-09-21T12:00:00Z'));
    expect(post).toMatchObject({
      id: 'p-1',
      content: 'hello',
      timestamp: '2026-09-21T12:00:00Z',
      username: 'layla',
      name: 'Layla',
      isVerified: true,
      likes: 2,
      replies: 1,
      reposts: 0,
    });
  });

  it('falls back when the author profile is missing', () => {
    const post = mapPostData({ id: 'p', content: null, created_at: 'now', profiles: null });
    expect(post.username).toBe('unknown_user');
    expect(post.content).toBe('');
    expect(post.isVerified).toBe(false);
  });

  it('takes the first row when Supabase embeds the profile as an array', () => {
    const post = mapPostData({
      id: 'p',
      created_at: 'now',
      profiles: [{ username: 'ahmed' }],
    });
    expect(post.username).toBe('ahmed');
  });

  it('builds a blur-up preview only for Supabase-hosted media', () => {
    const hosted = mapPostData({
      id: 'p',
      created_at: 'now',
      image_url: 'https://x.supabase.co/storage/v1/object/public/posts/a.jpg',
      profiles: {},
    });
    expect(hosted.media_preview_url).toContain('/render/image/');
    expect(hosted.media_preview_url).toContain('width=50');

    const elsewhere = mapPostData({
      id: 'p',
      created_at: 'now',
      image_url: 'https://example.test/a.jpg',
      profiles: {},
    });
    expect(elsewhere.media_preview_url).toBeUndefined();
  });

  it('treats a blank image url as no media', () => {
    const post = mapPostData({ id: 'p', created_at: 'now', image_url: '   ', profiles: {} });
    expect(post.media).toBeUndefined();
    expect(post.media_type).toBe('text');
  });
});
