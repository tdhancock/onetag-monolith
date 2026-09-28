//
// target: __tests__/api/feed.test.ts
//
// The home feed against the local stack, through the app's own fetchFeedPage
// and nextFeedCursor, as the infinite query pages it.

import { actAs } from './support/liveSupabase';
import { sql } from './support/localStack';
import { createAccount, deleteAccounts, type Account } from './support/accounts';
import { FEED_PAGE_SIZE, fetchFeedPage, nextFeedCursor, type FeedCursor } from '../../features/posts/api';
import type { Post } from '../../types';

let reader: Account;
let author: Account;

beforeAll(async () => {
  [reader, author] = await Promise.all([createAccount('feedreader'), createAccount('feedauthor')]);
  sql(`
    INSERT INTO public.follows (follower_id, followed_id) VALUES ('${reader.profileId}', '${author.profileId}');
    -- 25 posts sharing one created_at, as an import might make them.
    INSERT INTO public.posts (user_id, content, created_at)
    SELECT '${author.profileId}', 'tied ' || g, now() - interval '1 hour' FROM generate_series(1, 25) g;
    INSERT INTO public.posts (user_id, content, created_at)
    SELECT '${author.profileId}', 'older ' || g, now() - interval '2 hours' - g * interval '1 minute' FROM generate_series(1, 3) g;
  `);
  actAs(reader.client);
});

afterAll(() => deleteAccounts());

/** Every page, as useFeedQuery would load them scrolling to the end. */
const walkFeed = async (): Promise<Post[][]> => {
  const pages: Post[][] = [];
  let cursor: FeedCursor = null;
  for (;;) {
    const page = await fetchFeedPage({ userId: reader.profileId, pageParam: cursor });
    pages.push(page);
    const next = nextFeedCursor(page);
    if (next === undefined || pages.length > 10) return pages;
    cursor = next;
  }
};

describe('the feed across a tie (ONE-113)', () => {
  it('shows all 25 posts that share a timestamp, 20 at a time, once each', async () => {
    const pages = await walkFeed();
    const posts = pages.flat();
    const tied = posts.filter((post) => post.content.startsWith('tied '));

    expect(pages.map((page) => page.length)).toEqual([FEED_PAGE_SIZE, 8]);
    expect(tied).toHaveLength(25);
    expect(new Set(tied.map((post) => post.id)).size).toBe(25);
    expect(posts.slice(-3).map((post) => post.content)).toEqual(['older 1', 'older 2', 'older 3']);
  });
});
