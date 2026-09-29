//
// Pure logic for app/notifications.tsx: what each notification says, and how
// the list is grouped by recency. Extracted so the grouping boundaries are
// tested with fixed dates rather than whatever day the suite runs on.

import { startOfDay, subDays } from 'date-fns';
import type { Notification } from '../../types';
import { messageThreadRoute } from './messages';

/** The sentence after the sender's name, ending in a full stop. */
export const notificationSentence = (type: Notification['type']): string => {
  switch (type) {
    case 'like': return 'liked your post.';
    case 'comment': return 'commented on your post.';
    case 'reply': return 'replied to your comment.';
    case 'follow': return 'started following you.';
    case 'follow_request': return 'asked to follow you.';
    case 'comment_like': return 'liked your comment.';
    case 'repost': return 'reposted your post.';
    case 'mention': return 'mentioned you.';
    case 'story_like': return 'liked your OneSnap.';
    default: return 'interacted with you.';
  }
};

/**
 * A post's comments, opened on one of them: the screen scrolls to it and
 * marks it for a moment.
 */
export const commentRoute = (postId: string, commentId: string): string =>
  `/comments/${encodeURIComponent(postId)}?commentId=${encodeURIComponent(commentId)}`;

/** A OneSnap, opened on its own in the viewer. */
export const oneSnapRoute = (storyId: string) => ({ pathname: '/story-viewer' as const, params: { storyId } });

/**
 * Where tapping a push opens, from the data send-push puts on it
 * (supabase/functions/send-push/handler.ts): the follower's profile, the
 * requests, the thread with whoever messaged, the comment a comment, reply
 * or mention is about, or the post a mention is in. Anything else opens
 * Notifications.
 */
export const pushRoute = (data: Record<string, unknown> | null | undefined): string => {
  const type = typeof data?.type === 'string' ? data.type : undefined;
  const username = typeof data?.username === 'string' && data.username ? data.username : undefined;
  const postId = typeof data?.postId === 'string' && data.postId ? data.postId : undefined;
  const commentId = typeof data?.commentId === 'string' && data.commentId ? data.commentId : undefined;

  if (type === 'follow' && username) return `/user/${username}`;
  if (type === 'follow_request') return '/follow-requests';
  // send-push names the sender; the thread with them opens (ONE-103).
  if (type === 'message') return username ? messageThreadRoute(username) : '/messages';
  if (postId && commentId) return commentRoute(postId, commentId);
  if (postId) return `/post/${postId}`;
  return '/notifications';
};

/**
 * Where tapping a row on the Notifications screen opens: the same places a
 * push does, and a liked OneSnap in the viewer. Null for a row with nowhere
 * left to go — its post or OneSnap is gone.
 */
export const notificationRoute = (
  n: Pick<Notification, 'type' | 'sender' | 'post' | 'comment' | 'story'>,
): string | ReturnType<typeof oneSnapRoute> | null => {
  if (n.type === 'follow') return `/user/${n.sender.username}`;
  if (n.type === 'follow_request') return '/follow-requests';
  if (n.type === 'story_like') return n.story ? oneSnapRoute(n.story.id) : null;
  if (n.post && n.comment) return commentRoute(n.post.id, n.comment.id);
  if (n.post) return `/post/${n.post.id}`;
  return null;
};

/** The line under Follow requests at the top of Notifications (ONE-63). */
export const followRequestsSummary = (count: number): string =>
  count === 1 ? '1 person is waiting for your approval.' : `${count} people are waiting for your approval.`;

export type NotificationGroupKey = 'today' | 'week' | 'earlier';

export interface NotificationGroup<T> {
  key: NotificationGroupKey;
  /** The MonoLabel heading; MonoLabel sets it in capitals. */
  title: string;
  data: T[];
}

const GROUP_TITLES: Record<NotificationGroupKey, string> = {
  today: 'Today',
  week: 'This week',
  earlier: 'Earlier',
};

/**
 * Which group a timestamp falls in, relative to `now` in local time:
 *
 * - **Today:** since midnight.
 * - **This week:** the six days before that, so today plus this group cover
 *   the last seven calendar days.
 * - **Earlier:** anything older, or a timestamp that cannot be read.
 */
export const notificationGroupFor = (createdAt: string, now: Date = new Date()): NotificationGroupKey => {
  const time = new Date(createdAt).getTime();
  if (!Number.isFinite(time)) return 'earlier';
  const today = startOfDay(now).getTime();
  if (time >= today) return 'today';
  if (time >= subDays(startOfDay(now), 6).getTime()) return 'week';
  return 'earlier';
};

/**
 * The list as sections: Today, This week, Earlier, newest first within each,
 * and only the groups that have something in them.
 */
export const groupNotifications = <T extends Pick<Notification, 'created_at'>>(
  notifications: readonly T[],
  now: Date = new Date(),
): NotificationGroup<T>[] => {
  const byKey: Record<NotificationGroupKey, T[]> = { today: [], week: [], earlier: [] };
  for (const n of notifications) byKey[notificationGroupFor(n.created_at, now)].push(n);

  const newestFirst = (a: T, b: T) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

  return (['today', 'week', 'earlier'] as const)
    .filter(key => byKey[key].length > 0)
    .map(key => ({ key, title: GROUP_TITLES[key], data: [...byKey[key]].sort(newestFirst) }));
};
