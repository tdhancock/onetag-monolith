//
// target: __tests__/api/follow_requests.test.ts
//
// Following a private profile (ONE-63) against the local stack, through the
// app's own profiles, posts and notifications data layer.

import { actAs } from './support/liveSupabase';
import { sql } from './support/localStack';
import { createAccount, deleteAccounts, type Account } from './support/accounts';
import {
  approveFollowRequest,
  cancelFollowRequest,
  declineFollowRequest,
  fetchFollowRequests,
  followUser,
  getFollowingList,
  getRequestedList,
  requestFollow,
} from '../../features/profiles/api';
import { fetchNotifications } from '../../features/notifications/api';
import { fetchPostById } from '../../features/posts/api';

let owner: Account;
let asker: Account;
let changedMind: Account;
let turnedDown: Account;
let postId: string;

beforeAll(async () => {
  [owner, asker, changedMind, turnedDown] = await Promise.all(
    ['frowner', 'frasker', 'frcancel', 'frdecline'].map(createAccount),
  );
  sql(`UPDATE public.profiles SET is_private = true WHERE id = '${owner.profileId}';`);
  postId = sql(`INSERT INTO public.posts (user_id, content) VALUES ('${owner.profileId}', 'just for followers') RETURNING id;`);
});

afterAll(() => deleteAccounts());

const typesOf = async (account: Account) => (await fetchNotifications(account.profileId)).map((n) => n.type);

describe('following a private profile', () => {
  it("can't be done directly: asking is the way in", async () => {
    actAs(asker.client);
    await expect(followUser(asker.profileId, owner.profileId)).rejects.toBeTruthy();

    await requestFollow(asker.profileId, owner.profileId);
    await requestFollow(asker.profileId, owner.profileId);

    expect(await getRequestedList(asker.profileId)).toEqual([owner.username.toLowerCase()]);
    expect(await fetchPostById(postId, asker.profileId)).toBeUndefined();
  });

  it('the owner sees the request, and is told about it once', async () => {
    actAs(owner.client);
    const requests = await fetchFollowRequests(owner.profileId);

    expect(requests.map((request) => request.requester.username)).toEqual([asker.username]);
    expect((await typesOf(owner)).filter((type) => type === 'follow_request')).toHaveLength(1);
  });

  it('approving it makes the follow, and opens the posts', async () => {
    actAs(owner.client);
    const [request] = await fetchFollowRequests(owner.profileId);
    await approveFollowRequest(request.id);

    expect(await fetchFollowRequests(owner.profileId)).toEqual([]);
    expect(await typesOf(owner)).not.toContain('follow');

    actAs(asker.client);
    expect(await getFollowingList(asker.profileId)).toContain(owner.username.toLowerCase());
    expect(await getRequestedList(asker.profileId)).toEqual([]);
    expect((await fetchPostById(postId, asker.profileId))?.id).toBe(postId);
  });

  it('a request withdrawn leaves nothing behind, notification included', async () => {
    actAs(changedMind.client);
    await requestFollow(changedMind.profileId, owner.profileId);
    await cancelFollowRequest(changedMind.profileId, owner.profileId);

    actAs(owner.client);
    expect(await fetchFollowRequests(owner.profileId)).toEqual([]);
    expect((await fetchNotifications(owner.profileId)).filter((n) => n.sender?.id === changedMind.profileId)).toEqual([]);
  });

  it('a request turned down makes no follow', async () => {
    actAs(turnedDown.client);
    await requestFollow(turnedDown.profileId, owner.profileId);

    actAs(owner.client);
    const [request] = await fetchFollowRequests(owner.profileId);
    await declineFollowRequest(request.id);

    actAs(turnedDown.client);
    expect(await getFollowingList(turnedDown.profileId)).toEqual([]);
    expect(await getRequestedList(turnedDown.profileId)).toEqual([]);
    expect(await fetchPostById(postId, turnedDown.profileId)).toBeUndefined();
  });
});
