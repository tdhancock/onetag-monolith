//
// target: __tests__/api/notifications.test.ts
//
// Notifications come from events, never from clients (ONE-107), against the
// local stack. The app no longer writes any; these check nobody can, and that
// real events reach the Notifications screen's own read.

import { actAs, supabase } from './support/liveSupabase';
import { sql } from './support/localStack';
import { createAccount, deleteAccounts, type Account } from './support/accounts';
import { fetchNotifications } from '../../features/notifications/api';
import { followUser, unfollowUser } from '../../features/profiles/api';
import { toggleLike } from '../../features/posts/api';
import { addComment } from '../../features/comments/api';

let author: Account;
let fan: Account;
let mentioned: Account;
let postId: string;

beforeAll(async () => {
  [author, fan, mentioned] = await Promise.all(['ntauthor', 'ntfan', 'ntmention'].map(createAccount));
  postId = sql(`INSERT INTO public.posts (user_id, content) VALUES ('${author.profileId}', 'a post') RETURNING id;`);
});

afterAll(() => deleteAccounts());

const countOf = async (account: Account, type: string) => {
  actAs(account.client);
  return (await fetchNotifications(account.profileId)).filter((n) => n.type === type && n.sender?.id === fan.profileId).length;
};

describe('notifications', () => {
  it('a client can write none, not even as itself', async () => {
    actAs(fan.client);
    for (const type of ['follow', 'comment', 'mention', 'like', 'follow_request']) {
      const { error } = await supabase
        .from('notifications')
        .insert({ sender_id: fan.profileId, receiver_id: author.profileId, type });
      expect(error?.code).toBe('42501');
    }
    expect(await countOf(author, 'follow')).toBe(0);
  });

  it('real events each tell the right person once', async () => {
    actAs(fan.client);
    await toggleLike(postId, fan.profileId);
    await addComment(postId, fan.profileId, `nice one @${mentioned.username} and again @${mentioned.username}`);
    await followUser(fan.profileId, author.profileId);
    await unfollowUser(fan.profileId, author.profileId);
    await followUser(fan.profileId, author.profileId);

    expect(await countOf(author, 'like')).toBe(1);
    expect(await countOf(author, 'comment')).toBe(1);
    expect(await countOf(author, 'follow')).toBe(1);
    expect(await countOf(mentioned, 'mention')).toBe(1);
  });

  it('they reach the screen with their sender and post, through its select', async () => {
    actAs(author.client);
    const like = (await fetchNotifications(author.profileId)).find((n) => n.type === 'like');
    expect(like?.sender.username).toBe(fan.username);
    expect(like?.post?.id).toBe(postId);
  });
});
