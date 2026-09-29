//
// target: __tests__/api/comment_replies.test.ts
//
// Replies to comments, against the local stack: the app's own write puts a
// reply in its thread, its own read returns the threads, the person replied
// to hears of it on their Notifications screen, and deleting a comment takes
// its replies.

import { actAs } from './support/liveSupabase';
import { sql } from './support/localStack';
import { createAccount, deleteAccounts, type Account } from './support/accounts';
import { addComment, deleteComment, getCommentsForPost, toggleCommentLike } from '../../features/comments/api';
import { fetchNotifications } from '../../features/notifications/api';

let author: Account;
let commenter: Account;
let replier: Account;
let postId: string;

beforeAll(async () => {
  [author, commenter, replier] = await Promise.all(['rpauthor', 'rpcomment', 'rpreply'].map(createAccount));
  postId = sql(`INSERT INTO public.posts (user_id, content) VALUES ('${author.profileId}', 'a post') RETURNING id;`);
});

afterAll(() => deleteAccounts());

describe('comment replies', () => {
  let commentId: string;

  it('a reply, and a reply to it, land in one thread under the comment', async () => {
    actAs(commenter.client);
    commentId = (await addComment(postId, commenter.profileId, 'first')).id;

    actAs(replier.client);
    const reply = await addComment(postId, replier.profileId, `@${commenter.username} agreed`, commentId);
    await addComment(postId, replier.profileId, 'and more', reply.id);

    const threads = await getCommentsForPost(postId);
    expect(threads.map((t) => t.id)).toEqual([commentId]);
    expect(threads[0]!.replies.map((r) => r.text)).toEqual([`@${commenter.username} agreed`, 'and more']);
  });

  it('the one replied to hears of each reply once, as a reply', async () => {
    actAs(commenter.client);
    const told = (await fetchNotifications(commenter.profileId)).filter((n) => n.sender.id === replier.profileId);
    expect(told.map((n) => n.type)).toEqual(['reply', 'reply']);
  });

  it("reads each comment's likes with the comments, as each viewer sees them", async () => {
    actAs(replier.client);
    await toggleCommentLike(commentId, replier.profileId);

    const asLiker = await getCommentsForPost(postId, replier.profileId);
    expect(asLiker[0]).toMatchObject({ id: commentId, likes: 1, isLiked: true });

    actAs(author.client);
    const asAuthor = await getCommentsForPost(postId, author.profileId);
    expect(asAuthor[0]).toMatchObject({ id: commentId, likes: 1, isLiked: false });
    expect(asAuthor[0]!.replies.every((reply) => reply.likes === 0 && !reply.isLiked)).toBe(true);
  });

  it('deleting the comment deletes its replies', async () => {
    actAs(commenter.client);
    await deleteComment(commentId);
    actAs(author.client);
    expect(await getCommentsForPost(postId)).toEqual([]);
  });
});
