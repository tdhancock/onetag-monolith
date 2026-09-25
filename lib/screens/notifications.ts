//
// Pure logic for app/notifications.tsx: what each notification says, and how
// the list is grouped by recency. Extracted so the grouping boundaries are
// tested with fixed dates rather than whatever day the suite runs on.

import { startOfDay, subDays } from 'date-fns';
import type { Notification } from '../../types';

/** The sentence after the sender's name, ending in a full stop. */
export const notificationSentence = (type: Notification['type']): string => {
  switch (type) {
    case 'like': return 'liked your post.';
    case 'comment': return 'commented on your post.';
    case 'follow': return 'started following you.';
    case 'comment_like': return 'liked your comment.';
    case 'repost': return 'reposted your post.';
    case 'mention': return 'mentioned you.';
    case 'story_like': return 'liked your OneSnap.';
    default: return 'interacted with you.';
  }
};

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
