//
// target: __tests__/features/posts/api.test.ts
// The posts domain's Supabase layer — features/posts/api.
//
// The point of ONE-12 is that paging is an argument rather than module-level
// state, so most of what is asserted here is about the cursor: that the first
// page asks for no cursor, that a later page asks for the previous page's
// last timestamp, and that two sequences do not interfere.

jest.mock('../../../services/supabase.native', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

/**
 * What one feed read asked for: the arguments `feed_posts` was called with,
 * which picks the page (ONE-106), and the ids the posts were then read by.
 */
type Call = { args: Record<string, unknown>; pageIds?: string[] };

let calls: Call[] = [];
/** The page `feed_posts` picks: its post ids. */
let pageResult: { data: { id: string }[] | null; error: unknown } = { data: [], error: null };
/** The posts read by those ids. */
let postsResult: { data: unknown[] | null; error: unknown } = { data: [], error: null };

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { supabase } = require('../../../services/supabase.native');

supabase.rpc.mockImplementation((fn: string, args: Record<string, unknown>) => {
  if (fn !== 'feed_posts') throw new Error(`unexpected rpc ${fn}`);
  const call: Call = { args };
  calls.push(call);
  return { select: () => Promise.resolve(pageResult) };
});

supabase.from.mockImplementation((table: string) => {
  if (table !== 'posts') throw new Error(`unexpected table ${table}`);
  const call = calls[calls.length - 1]!;
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: (_col: string, ids: string[]) => {
      call.pageIds = ids;
      return chain;
    },
    order: () => Promise.resolve(postsResult),
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
  pageResult = { data: [{ id: 'p-0' }, { id: 'p-1' }], error: null };
  postsResult = { data: [], error: null };
});

// ─── 1. No module-level state ───────────────────────────────────────────

describe('fetchFeedPage — paging is an argument', () => {
  it('asks for no cursor on the first page, and a page of FEED_PAGE_SIZE', async () => {
    await fetchFeedPage({ userId: 'me', pageParam: null });
    expect(calls[0]!.args).toMatchObject({ p_viewer: 'me', p_before: null, p_limit: FEED_PAGE_SIZE });
  });

  it('asks for posts older than the cursor on a later page', async () => {
    await fetchFeedPage({ userId: 'me', pageParam: '2026-09-21T10:00:00Z' });
    expect(calls[0]!.args.p_before).toBe('2026-09-21T10:00:00Z');
  });

  it('two sequences do not interfere — the second starts from the top', async () => {
    // This is the whole ticket: the old module-level cursor meant a second
    // mount silently continued the first one's pagination.
    await fetchFeedPage({ userId: 'me', pageParam: null });
    await fetchFeedPage({ userId: 'me', pageParam: '2026-09-21T10:00:00Z' });
    await fetchFeedPage({ userId: 'me', pageParam: null });

    expect(calls.map((c) => c.args.p_before)).toEqual([null, '2026-09-21T10:00:00Z', null]);
  });
});

// ─── 2. The page is chosen in the database (ONE-106) ────────────────────

describe('fetchFeedPage — no follow list in the URL (ONE-106)', () => {
  it('sends the reader, not the people they follow', async () => {
    await fetchFeedPage({ userId: 'me', pageParam: null });
    expect(Object.keys(calls[0]!.args).sort()).toEqual(['p_before', 'p_interest', 'p_limit', 'p_viewer']);
  });

  it('reads the posts by the page\'s own ids, never more than a page', async () => {
    await fetchFeedPage({ userId: 'me', pageParam: null });
    expect(calls[0]!.pageIds).toEqual(['p-0', 'p-1']);
  });

  it('reads no posts when the page is empty', async () => {
    pageResult = { data: [], error: null };
    await expect(fetchFeedPage({ userId: 'me', pageParam: null })).resolves.toEqual([]);
    expect(calls[0]!.pageIds).toBeUndefined();
  });
});

describe('fetchFeedPage — the interest filter (ONE-49)', () => {
  it('narrows the page in the database, so a filtered page is still full-length', async () => {
    await fetchFeedPage({ userId: 'me', pageParam: null, interest: 'custom-homes' });
    expect(calls[0]!.args).toMatchObject({ p_interest: 'custom-homes', p_limit: FEED_PAGE_SIZE });
  });

  it('adds no filter for All, so untagged posts appear there', async () => {
    await fetchFeedPage({ userId: 'me', pageParam: null });
    expect(calls[0]!.args.p_interest).toBeNull();
  });
});

describe('fetchFeedPage — errors', () => {
  it('throws rather than returning an empty page', async () => {
    // Swallowing here would take away the query's retry and error state, and
    // make an outage indistinguishable from an empty feed.
    postsResult = { data: null, error: { message: 'boom' } };
    await expect(fetchFeedPage({ userId: 'me', pageParam: null })).rejects.toBeDefined();
  });

  it('propagates a failure choosing the page too', async () => {
    pageResult = { data: null, error: { message: 'nope' } };
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

// ─── 5. Counts come from the stored totals (ONE-109) ────────────────────

describe('mapPostData — counts', () => {
  it('reads likes, comments and reposts from the explore_scores embed', () => {
    const post = mapPostData({ ...row('p-1', '2026-09-21T12:00:00Z'), likes: undefined, comments: undefined, reposts: undefined,
      stats: { likes: 7, comments: 3, reposts: 1 } });
    expect([post.likes, post.replies, post.reposts]).toEqual([7, 3, 1]);
  });

  it('accepts the embed as a one-element array too', () => {
    const post = mapPostData({ ...row('p-1', '2026-09-21T12:00:00Z'), stats: [{ likes: 2, comments: 0, reposts: 5 }] });
    expect([post.likes, post.replies, post.reposts]).toEqual([2, 0, 5]);
  });

  it('prefers the stored totals over counted rows when a row carries both', () => {
    const post = mapPostData({ ...row('p-1', '2026-09-21T12:00:00Z'), stats: { likes: 9, comments: 9, reposts: 9 } });
    expect(post.likes).toBe(9);
  });
});
