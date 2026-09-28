//
// target: __tests__/api/private_engagement.test.ts
//
// A private account's comments and likes are as private as its posts
// (ONE-109), against the local stack, through the app's own reads.

import { actAs } from './support/liveSupabase';
import { sql } from './support/localStack';
import { createAccount, deleteAccounts, type Account } from './support/accounts';
import { getCommentLikesCount, getCommentsForPost, addComment } from '../../features/comments/api';
import { fetchPostById, toggleLike } from '../../features/posts/api';

let owner: Account;
let follower: Account;
let stranger: Account;
let postId: string;
let commentId: string;

beforeAll(async () => {
  [owner, follower, stranger] = await Promise.all(['pvowner', 'pvfollow', 'pvstrange'].map(createAccount));
  sql(`
    UPDATE public.profiles SET is_private = true WHERE id = '${owner.profileId}';
    INSERT INTO public.follows (follower_id, followed_id) VALUES ('${follower.profileId}', '${owner.profileId}');
  `);
  postId = sql(`INSERT INTO public.posts (user_id, content) VALUES ('${owner.profileId}', 'followers only') RETURNING id;`);

  actAs(follower.client);
  await toggleLike(postId, follower.profileId);
  await addComment(postId, follower.profileId, 'lovely');
  commentId = sql(`SELECT id FROM public.comments WHERE post_id = '${postId}';`);
  sql(`INSERT INTO public.comment_likes (comment_id, user_id) VALUES ('${commentId}', '${owner.profileId}');`);
});

afterAll(() => deleteAccounts());

describe("a private account's post", () => {
  it('shows its comments, likes and counts to a follower', async () => {
    actAs(follower.client);
    expect((await getCommentsForPost(postId)).map((comment) => comment.text)).toEqual(['lovely']);
    expect(await getCommentLikesCount(commentId)).toBe(1);
    expect((await fetchPostById(postId, follower.profileId))?.likes).toBe(1);
  });

  it('shows a stranger nothing: not the post, its comments, or their likes', async () => {
    actAs(stranger.client);
    expect(await fetchPostById(postId, stranger.profileId)).toBeUndefined();
    expect(await getCommentsForPost(postId)).toEqual([]);
    expect(await getCommentLikesCount(commentId)).toBe(0);
  });

  // Known gap, ONE-115: the insert policies never ask whether the writer can
  // see the post, so a stranger's like goes through. `it.failing` holds while
  // it does; once ONE-115 closes the gap this starts failing — make it `it`.
  it.failing("lets a stranger neither like it nor comment on it (ONE-115)", async () => {
    actAs(stranger.client);
    await expect(toggleLike(postId, stranger.profileId)).rejects.toBeTruthy();
    await expect(addComment(postId, stranger.profileId, 'hello')).rejects.toBeTruthy();
  });
});
