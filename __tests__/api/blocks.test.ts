//
// target: __tests__/api/blocks.test.ts
//
// Blocking (ONE-108) against the local stack, through the app's own blocks,
// profiles, posts, comments and messages data layer. A block hides each from
// the other and refuses every way of reaching across it, both ways.

import { actAs } from './support/liveSupabase';
import { sql } from './support/localStack';
import { createAccount, deleteAccounts, type Account } from './support/accounts';
import { blockUser, fetchBlocks, isBlockedBy, unblockUser } from '../../features/blocks/api';
import { followUser, getFollowingList, getUserPosts } from '../../features/profiles/api';
import { fetchPostById, toggleLike } from '../../features/posts/api';
import { addComment } from '../../features/comments/api';
import { sendMessage } from '../../features/messages/api';

let blocker: Account;
let blocked: Account;
let blockerPost: string;
let blockedPost: string;

beforeAll(async () => {
  [blocker, blocked] = await Promise.all([createAccount('blocker'), createAccount('blocked')]);
  blockerPost = sql(`INSERT INTO public.posts (user_id, content) VALUES ('${blocker.profileId}', 'blocker''s') RETURNING id;`);
  blockedPost = sql(`INSERT INTO public.posts (user_id, content) VALUES ('${blocked.profileId}', 'blocked''s') RETURNING id;`);
  sql(`INSERT INTO public.follows (follower_id, followed_id) VALUES ('${blocked.profileId}', '${blocker.profileId}');`);

  actAs(blocker.client);
  await blockUser(blocker.userId, blocked.userId);
});

afterAll(() => deleteAccounts());

describe('once blocked', () => {
  it('the blocker sees the block in their list', async () => {
    actAs(blocker.client);
    expect((await fetchBlocks(blocker.userId)).map((block) => block.username)).toEqual([blocked.username]);
  });

  it("the blocked account knows only that it can't see the blocker", async () => {
    actAs(blocked.client);
    expect(await isBlockedBy(blocker.profileId)).toBe(true);
    expect(await fetchPostById(blockerPost, blocked.profileId)).toBeUndefined();
    expect(await getUserPosts(blocker.profileId, blocked.profileId)).toEqual([]);
  });

  it('the follow between them is gone', async () => {
    actAs(blocked.client);
    expect(await getFollowingList(blocked.profileId)).not.toContain(blocker.username.toLowerCase());
  });

  it('the blocked account can reach the blocker no way at all', async () => {
    actAs(blocked.client);
    await expect(followUser(blocked.profileId, blocker.profileId)).rejects.toBeTruthy();
    await expect(sendMessage({ sender_id: blocked.profileId, receiver_id: blocker.profileId, text: 'hi' })).rejects.toBeTruthy();
    await expect(addComment(blockerPost, blocked.profileId, 'hi')).rejects.toBeTruthy();
    await expect(toggleLike(blockerPost, blocked.profileId)).rejects.toBeTruthy();
  });

  it('and it works both ways', async () => {
    actAs(blocker.client);
    expect(await fetchPostById(blockedPost, blocker.profileId)).toBeUndefined();
    await expect(sendMessage({ sender_id: blocker.profileId, receiver_id: blocked.profileId, text: 'hi' })).rejects.toBeTruthy();
  });

  it('unblocking shows them to each other again, without restoring the follow', async () => {
    actAs(blocker.client);
    await unblockUser(blocker.userId, blocked.userId);

    actAs(blocked.client);
    expect(await isBlockedBy(blocker.profileId)).toBe(false);
    expect((await fetchPostById(blockerPost, blocked.profileId))?.id).toBe(blockerPost);
    expect(await getFollowingList(blocked.profileId)).not.toContain(blocker.username.toLowerCase());
  });
});
