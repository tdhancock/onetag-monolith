//
// target: __tests__/lib/pushRoute.test.ts
//
// Where tapping a push opens (lib/screens/notifications), from the data
// send-push puts on it.

import { buildPush } from '../../supabase/functions/send-push/handler';
import { pushRoute } from '../../lib/screens/notifications';

const receiver = { authUserId: 'a-1', username: 'ana', profileType: 'individual' as const };
const dataFor = (event: Parameters<typeof buildPush>[0]) => buildPush(event)!.data;

describe('pushRoute', () => {
  it("opens a new follower's profile", () => {
    expect(pushRoute(dataFor({ kind: 'notification', type: 'follow', senderUsername: 'bo', receiver, postId: null }))).toBe('/user/bo');
  });

  it('opens the requests for a follow request', () => {
    expect(pushRoute(dataFor({ kind: 'notification', type: 'follow_request', senderUsername: 'bo', receiver, postId: null }))).toBe('/follow-requests');
  });

  it('opens the thread with whoever messaged', () => {
    expect(pushRoute(dataFor({ kind: 'message', senderUsername: 'bo', receiver }))).toBe('/messages?chatWith=bo');
  });

  it('opens the comment a comment, reply or mention is about', () => {
    for (const type of ['comment', 'reply', 'mention']) {
      const data = dataFor({ kind: 'notification', type, senderUsername: 'bo', receiver, postId: 'post-1', commentId: 'c-1' });
      expect(pushRoute(data)).toBe('/comments/post-1?commentId=c-1');
    }
  });

  it('opens the post a mention in a post is in', () => {
    expect(pushRoute(dataFor({ kind: 'notification', type: 'mention', senderUsername: 'bo', receiver, postId: 'post-1' }))).toBe(
      '/post/post-1',
    );
  });

  it('opens Notifications for anything else', () => {
    expect(pushRoute(undefined)).toBe('/notifications');
    expect(pushRoute({ type: 'mention' })).toBe('/notifications');
  });
});
