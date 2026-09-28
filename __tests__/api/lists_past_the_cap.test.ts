//
// target: __tests__/api/lists_past_the_cap.test.ts
//
// ONE-110 against the local stack: the API returns at most 1,000 rows to a
// request, and these lists run past that. Each check drives the app's own
// data layer, signed in as the account it reads for.

import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { actAs } from './support/liveSupabase';
import { admin, sql } from './support/localStack';
import { createAccount, deleteAccounts, seedProfiles, type Account } from './support/accounts';
import { fetchThread, getChatListUsers, THREAD_PAGE_SIZE } from '../../features/messages/api';
import { messageKeys } from '../../features/messages/keys';
import { loadOlderMessagesOptions } from '../../features/messages/mutations';
import { loadedDepth } from '../../features/messages/queries';
import { getFollowingList, getRequestedList } from '../../features/profiles/api';
import { fetchSavedItems, fetchSaves } from '../../features/saves/api';
import type { Message, ProfileId } from '../../types';

let reader: Account;
let friend: Account;
let oldFriend: Account;
let latest: Account;
let privateOne: Account;
let crowd: ProfileId[];

beforeAll(async () => {
  [reader, friend, oldFriend, latest, privateOne] = await Promise.all(
    ['reader', 'friend', 'oldfriend', 'latest', 'private'].map(createAccount),
  );
  crowd = seedProfiles('crowd', 3000);

  sql(`
    -- 5,000 messages between reader and friend over the last day, a second
    -- apart; message 5, 15, … shares its second with the one before. The
    -- newest stands alone, so which is newest never depends on random ids.
    INSERT INTO public.messages (sender_id, receiver_id, text, created_at)
    SELECT CASE WHEN g % 2 = 0 THEN '${reader.profileId}'::uuid ELSE '${friend.profileId}'::uuid END,
           CASE WHEN g % 2 = 0 THEN '${friend.profileId}'::uuid ELSE '${reader.profileId}'::uuid END,
           'message ' || g,
           now() - interval '1 day' + (g - CASE WHEN g % 10 = 5 THEN 1 ELSE 0 END) * interval '1 second'
    FROM generate_series(1, 5000) g;
    -- A conversation from a month ago, older than every one of those.
    INSERT INTO public.messages (sender_id, receiver_id, text, created_at)
    VALUES ('${oldFriend.profileId}', '${reader.profileId}', 'long time ago', now() - interval '30 days'),
           ('${reader.profileId}', '${latest.profileId}', 'just now', now());

    -- The reader follows and saves all 3,000 of the crowd.
    INSERT INTO public.follows (follower_id, followed_id)
    SELECT '${reader.profileId}', id FROM public.profiles WHERE id = ANY ('{${crowd.join(',')}}'::uuid[]);
    INSERT INTO public.saves (profile_id, saved_profile_id, saved_at)
    SELECT '${reader.profileId}', c.id, now() - c.n * interval '1 second'
    FROM unnest('{${crowd.join(',')}}'::uuid[]) WITH ORDINALITY AS c(id, n);

    UPDATE public.profiles SET is_private = true WHERE id = '${privateOne.profileId}';
    INSERT INTO public.follow_requests (requester_profile_id, target_profile_id)
    VALUES ('${reader.profileId}', '${privateOne.profileId}');
  `);

  actAs(reader.client);
}, 180_000);

afterAll(() => deleteAccounts());

describe('the cap is real on this stack', () => {
  it('a plain read of 3,000 follows stops at 1,000', async () => {
    const { data } = await reader.client.from('follows').select('followed_id').eq('follower_id', reader.profileId);
    expect(data).toHaveLength(1000);
  });
});

describe('a 5,000-message thread', () => {
  it('opens on its newest messages', async () => {
    const thread = await fetchThread(reader.profileId, friend.profileId);

    expect(thread).toHaveLength(THREAD_PAGE_SIZE);
    expect(thread[thread.length - 1].text).toBe('message 5000');
    expect(thread[0].text).toBe('message 4901');
  });

  it('scrolls back to the first, every message once and in order', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const key = messageKeys.thread(reader.profileId, friend.profileId);
    client.setQueryData(key, await fetchThread(reader.profileId, friend.profileId));

    for (let pages = 0; pages < 100; pages++) {
      const observer = new MutationObserver(client, loadOlderMessagesOptions(client, reader.profileId));
      const older = (await observer.mutate(friend.profileId)) as Message[];
      if (older.length < THREAD_PAGE_SIZE) break;
    }

    const thread = client.getQueryData<Message[]>(key)!;
    // The thread's order is the database's: by time, then id where two share a second.
    const expected = sql(`
      SELECT id FROM public.messages
      WHERE sender_id IN ('${reader.profileId}', '${friend.profileId}')
        AND receiver_id IN ('${reader.profileId}', '${friend.profileId}')
      ORDER BY created_at, id;
    `).split('\n');
    expect(thread).toHaveLength(5000);
    expect(new Set(thread.map((m) => m.id)).size).toBe(5000);
    expect(thread.map((m) => m.id)).toEqual(expected);
    expect(thread[0].text).toBe('message 1');

    // A refetch reads back as far as the thread has scrolled.
    const refetched = await fetchThread(reader.profileId, friend.profileId, loadedDepth(thread));
    expect(refetched.map((m) => m.id)).toEqual(thread.map((m) => m.id));
  });

  it("is someone else's to read only if they're in it", async () => {
    actAs(latest.client);
    try {
      await expect(fetchThread(reader.profileId, friend.profileId)).resolves.toEqual([]);
    } finally {
      actAs(reader.client);
    }
  });
});

describe('the Messages list', () => {
  it('keeps a conversation older than 5,000 newer messages, in its place', async () => {
    const list = await getChatListUsers(reader.profileId);

    expect(list.map((person) => person.username)).toEqual([latest.username, friend.username, oldFriend.username]);
  });
});

describe('follow state', () => {
  it('is right for someone following 3,000 accounts', async () => {
    const following = await getFollowingList(reader.profileId);
    const { data: last } = await admin.from('profiles').select('username').eq('id', crowd[2999]).single();

    expect(following).toHaveLength(3000);
    expect(following).toContain(last!.username.toLowerCase());
    expect(following).not.toContain(privateOne.username.toLowerCase());
  });

  it('knows the request waiting on a private profile', async () => {
    await expect(getRequestedList(reader.profileId)).resolves.toEqual([privateOne.username.toLowerCase()]);
  });
});

describe('the Saves tab', () => {
  it('lists all 3,000 saves, newest first', async () => {
    const saves = await fetchSaves(reader.profileId);

    expect(saves).toHaveLength(3000);
    expect(saves.map((save) => save.target.id)).toEqual(crowd);
  });

  it('shows every one of them', async () => {
    const items = await fetchSavedItems(reader.profileId);

    expect(items).toHaveLength(3000);
    expect(items.every((item) => item.kind === 'profile')).toBe(true);
  });
});
