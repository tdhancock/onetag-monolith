//
// target: __tests__/api/feed.test.ts
//
// The home feed against the local stack, through the app's own fetchFeedPage
// and nextFeedCursor, as the infinite query pages it.

import { actAs } from './support/liveSupabase';
import { sql } from './support/localStack';
import { createAccount, deleteAccounts, type Account } from './support/accounts';
import { FEED_PAGE_SIZE, fetchFeedPage, fetchNewestFeedPost, nextFeedCursor, type FeedCursor } from '../../features/posts/api';
import type { Post } from '../../types';

let reader: Account;
let author: Account;
let quiet: Account;
let loner: Account;

beforeAll(async () => {
  [reader, author, quiet, loner] = await Promise.all(
    ['feedreader', 'feedauthor', 'feedquiet', 'feedloner'].map(createAccount),
  );
  sql(`
    INSERT INTO public.follows (follower_id, followed_id)
    VALUES ('${reader.profileId}', '${author.profileId}'), ('${reader.profileId}', '${quiet.profileId}');
    -- 25 posts sharing one created_at, as an import might make them.
    INSERT INTO public.posts (user_id, content, created_at)
    SELECT '${author.profileId}', 'tied ' || g, now() - interval '1 hour' FROM generate_series(1, 25) g;
    INSERT INTO public.posts (user_id, content, created_at)
    SELECT '${author.profileId}', 'older ' || g, now() - interval '2 hours' - g * interval '1 minute' FROM generate_series(1, 3) g;
    -- An account that went quiet months ago.
    INSERT INTO public.posts (user_id, content, created_at)
    SELECT '${quiet.profileId}', 'quiet ' || g, now() - interval '200 days' - g * interval '1 day' FROM generate_series(1, 2) g;
    -- Someone who follows nobody, with posts of their own.
    INSERT INTO public.posts (user_id, content, created_at)
    SELECT '${loner.profileId}', 'mine ' || g, now() - g * interval '1 day' FROM generate_series(1, 2) g;
  `);
});

afterAll(() => deleteAccounts());

/** Every page, as useFeedQuery would load them scrolling to the end. */
const walkFeed = async (account: Account): Promise<Post[][]> => {
  actAs(account.client);
  const pages: Post[][] = [];
  let cursor: FeedCursor = null;
  for (;;) {
    const page = await fetchFeedPage({ userId: account.profileId, pageParam: cursor });
    pages.push(page);
    const next = nextFeedCursor(page);
    if (next === undefined || pages.length > 10) return pages;
    cursor = next;
  }
};

describe('the feed across a tie (ONE-113)', () => {
  it('shows all 25 posts that share a timestamp, 20 at a time, once each', async () => {
    const pages = await walkFeed(reader);
    const posts = pages.flat();
    const tied = posts.filter((post) => post.content.startsWith('tied '));

    expect(pages.map((page) => page.length)).toEqual([FEED_PAGE_SIZE, 10]);
    expect(tied).toHaveLength(25);
    expect(new Set(tied.map((post) => post.id)).size).toBe(25);
    expect(posts.slice(-5).map((post) => post.content)).toEqual(['older 1', 'older 2', 'older 3', 'quiet 1', 'quiet 2']);
  });
});

describe('a feed chosen from the follow list (ONE-116)', () => {
  it('reaches a quiet account\'s months-old posts at the end of the feed', async () => {
    const posts = (await walkFeed(reader)).flat();
    expect(posts.filter((post) => post.content.startsWith('quiet '))).toHaveLength(2);
  });

  it('shows someone who follows nobody their own posts', async () => {
    const pages = await walkFeed(loner);
    expect(pages.flat().map((post) => post.content)).toEqual(['mine 1', 'mine 2']);
  });

  it("returns nobody else's feed", async () => {
    actAs(loner.client);
    await expect(fetchFeedPage({ userId: reader.profileId, pageParam: null })).resolves.toEqual([]);
  });

  // What the home feed's "New posts" check asks, instead of listening to
  // every post published anywhere.
  it('names the post the feed would open on as its newest, and nothing for an empty feed', async () => {
    actAs(reader.client);
    const [first] = await fetchFeedPage({ userId: reader.profileId, pageParam: null });
    await expect(fetchNewestFeedPost(reader.profileId)).resolves.toEqual({ id: first!.id, createdAt: expect.any(String) });

    const stranger = await createAccount('feednone');
    actAs(stranger.client);
    await expect(fetchNewestFeedPost(stranger.profileId)).resolves.toBeNull();
  });
});
