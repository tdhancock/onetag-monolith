//
// target: __tests__/api/url_limits.test.ts
//
// ONE-106 against the local stack: reads that used to send every followed,
// saved or messaged id in the URL, and failed as "URI too long" at about 200.
// The reader here has 300 of each. Re-adding an id list fails these.

import { actAs } from './support/liveSupabase';
import { sql } from './support/localStack';
import { createAccount, deleteAccounts, seedProfiles, type Account } from './support/accounts';
import { FEED_PAGE_SIZE, fetchFeedPage } from '../../features/posts/api';
import { getStories } from '../../features/stories/api';
import { fetchSavedItems } from '../../features/saves/api';
import { getChatListUsers } from '../../features/messages/api';
import type { ProfileId } from '../../types';

const CROWD = 300;

let reader: Account;
let crowd: ProfileId[];

beforeAll(async () => {
  reader = await createAccount('urlreader');
  crowd = seedProfiles('url', CROWD);
  const ids = `'{${crowd.join(',')}}'::uuid[]`;
  sql(`
    INSERT INTO public.follows (follower_id, followed_id)
    SELECT '${reader.profileId}', id FROM unnest(${ids}) AS id;
    INSERT INTO public.posts (user_id, content, created_at)
    SELECT c.id, 'post ' || c.n, now() - c.n * interval '1 second' FROM unnest(${ids}) WITH ORDINALITY AS c(id, n);
    INSERT INTO public.stories (user_id, media_url, created_at)
    SELECT c.id, 'https://example.test/s' || c.n || '.jpg', now() - c.n * interval '1 second'
    FROM unnest(${ids}) WITH ORDINALITY AS c(id, n);
    INSERT INTO public.saves (profile_id, saved_post_id)
    SELECT '${reader.profileId}', p.id FROM public.posts p WHERE p.user_id = ANY (${ids});
    INSERT INTO public.messages (sender_id, receiver_id, text)
    SELECT id, '${reader.profileId}', 'hello' FROM unnest(${ids}) AS id;
  `);
  actAs(reader.client);
}, 120_000);

afterAll(() => deleteAccounts());

describe(`reading as someone with ${CROWD} of everything`, () => {
  it('the feed loads a page from the people they follow', async () => {
    const page = await fetchFeedPage({ userId: reader.profileId, pageParam: null });
    expect(page).toHaveLength(FEED_PAGE_SIZE);
    expect(page[0].content).toBe('post 1');
  });

  it('the OneSnap reel has everyone they follow', async () => {
    const reel = await getStories(reader.profileId);
    expect(reel).toHaveLength(CROWD);
  });

  it('the Saves tab shows every saved post', async () => {
    const items = await fetchSavedItems(reader.profileId);
    expect(items).toHaveLength(CROWD);
    expect(items.every((item) => item.kind === 'post')).toBe(true);
  });

  it('the Messages list has every conversation', async () => {
    const list = await getChatListUsers(reader.profileId);
    expect(list).toHaveLength(CROWD);
  });
});
