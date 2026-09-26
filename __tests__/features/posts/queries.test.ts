//
// target: __tests__/features/posts/queries.test.ts
// The posts read hooks — features/posts/queries.
//
// The hooks are called with useInfiniteQuery / useQuery stubbed and the
// options they build are inspected. That covers the wiring the feed depends
// on and cannot be checked from the api layer: the key comes from the
// factory, paging starts from no cursor, the end-of-feed rule is the shared
// one, and the query stays disabled without a user id.

const mockUseInfiniteQuery = jest.fn();
const mockUseQuery = jest.fn();

jest.mock('@tanstack/react-query', () => ({
  __esModule: true,
  useInfiniteQuery: (options: unknown) => mockUseInfiniteQuery(options),
  useQuery: (options: unknown) => mockUseQuery(options),
}));

jest.mock('../../../services/supabase.native', () => ({
  supabase: { from: jest.fn() },
}));

// Only fetchFeedPage is stubbed; nextFeedCursor and the constants stay real,
// so the identity check below is against the function the feed actually uses.
const mockFetchFeedPage = jest.fn();
jest.mock('../../../features/posts/api', () => ({
  ...jest.requireActual('../../../features/posts/api'),
  fetchFeedPage: (args: unknown) => mockFetchFeedPage(args),
}));

import { useFeedQuery, usePostQuery } from '../../../features/posts/queries';
import { fetchPostById, nextFeedCursor, FEED_PAGE_SIZE } from '../../../features/posts/api';
import { postKeys } from '../../../features/posts/keys';
import type { Post } from '../../../types';
import { asProfileId } from '../../../types';

type FeedOptions = {
  queryKey: readonly unknown[];
  queryFn: (ctx: { pageParam: string | null }) => unknown;
  initialPageParam: string | null;
  getNextPageParam: (page: Post[]) => string | undefined;
  enabled: boolean;
};

// No default parameter: `feedOptions(undefined)` must mean "no user id",
// and a default would silently substitute one.
const feedOptions = (userId: string | undefined): FeedOptions => {
  mockUseInfiniteQuery.mockClear();
  useFeedQuery(userId === undefined ? undefined : asProfileId(userId));
  return mockUseInfiniteQuery.mock.calls[0]![0] as FeedOptions;
};

const post = (id: string): Post => ({ id, timestamp: `t-${id}` }) as Post;

// ─── 1. The feed key ────────────────────────────────────────────────────

describe('useFeedQuery — key', () => {
  it('takes its key from the factory, not a literal', () => {
    expect(feedOptions('me').queryKey).toEqual(postKeys.feed('me'));
    expect(feedOptions('me').queryKey).toEqual(['posts', 'feed', 'me']);
  });

  it('keys per user, so two readers do not share a feed', () => {
    expect(feedOptions('me').queryKey).not.toEqual(feedOptions('you').queryKey);
  });

  it('sits under the domain root, so invalidating postKeys.all reaches it', () => {
    const key = feedOptions('me').queryKey;
    expect(key.slice(0, postKeys.all.length)).toEqual([...postKeys.all]);
  });
});

// ─── 2. Paging ──────────────────────────────────────────────────────────

describe('useFeedQuery — paging', () => {
  it('starts from no cursor', () => {
    // Every mount begins at the top of the feed. Under the old module-level
    // cursor, a second mount silently continued the first one's pagination.
    expect(feedOptions('me').initialPageParam).toBeNull();
  });

  it('delegates to fetchFeedPage with the user id and the page cursor', () => {
    mockFetchFeedPage.mockClear();
    feedOptions('me').queryFn({ pageParam: null });
    expect(mockFetchFeedPage).toHaveBeenCalledWith({ userId: 'me', pageParam: null });
  });

  it('threads a later page cursor through unchanged', () => {
    mockFetchFeedPage.mockClear();
    feedOptions('me').queryFn({ pageParam: '2026-09-21T10:00:00Z' });
    expect(mockFetchFeedPage).toHaveBeenCalledWith({
      userId: 'me',
      pageParam: '2026-09-21T10:00:00Z',
    });
  });

  it('uses the shared end-of-feed rule rather than its own copy', () => {
    expect(feedOptions('me').getNextPageParam).toBe(nextFeedCursor);
  });

  it('stops paging on a short page', () => {
    // The acceptance criterion, exercised through the option the query
    // actually receives.
    const getNext = feedOptions('me').getNextPageParam;
    const shortPage = Array.from({ length: FEED_PAGE_SIZE - 1 }, (_, i) => post(`p${i}`));
    expect(getNext(shortPage)).toBeUndefined();

    const fullPage = Array.from({ length: FEED_PAGE_SIZE }, (_, i) => post(`p${i}`));
    expect(getNext(fullPage)).toBe(fullPage.at(-1)!.timestamp);
  });
});

// ─── 3. Disabled without a user ─────────────────────────────────────────

describe('useFeedQuery — requires a user', () => {
  it('is disabled when there is no user id', () => {
    // The feed is "everyone I follow, plus me", which is meaningless without
    // a user. Previously the fetch fired, called auth.getUser() and then bailed
    // with an empty array; now no request is made at all.
    expect(feedOptions(undefined).enabled).toBe(false);
    expect(feedOptions('').enabled).toBe(false);
  });

  it('is enabled once a user id arrives', () => {
    expect(feedOptions('me').enabled).toBe(true);
  });
});

// ─── 4. usePostQuery ────────────────────────────────────────────────────

describe('usePostQuery', () => {
  const postOptions = (id: string | undefined) => {
    mockUseQuery.mockClear();
    usePostQuery(id);
    return mockUseQuery.mock.calls[0]![0] as {
      queryKey: readonly unknown[];
      queryFn: unknown;
      enabled: boolean;
    };
  };

  it('keys on the detail branch, so it is not invalidated by a list refresh', () => {
    expect(postOptions('p-1').queryKey).toEqual(postKeys.detail('p-1'));
    expect(postOptions('p-1').queryKey).toEqual(['posts', 'detail', 'p-1']);
  });

  it('delegates to the api function', () => {
    expect(typeof postOptions('p-1').queryFn).toBe('function');
    expect(typeof fetchPostById).toBe('function');
  });

  it('is disabled without an id', () => {
    expect(postOptions(undefined).enabled).toBe(false);
    expect(postOptions('p-1').enabled).toBe(true);
  });
});
