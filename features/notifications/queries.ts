// Read hooks for the notifications domain.

import { useQuery } from '@tanstack/react-query';
import { fetchNotifications } from './api';
import { notificationKeys } from './keys';
import type { Notification } from './types';

/** Everything addressed to the signed-in user, newest first. */
export const useNotificationsQuery = (userId: string | undefined) =>
  useQuery<Notification[]>({
    queryKey: notificationKeys.forUser(userId ?? ''),
    queryFn: () => fetchNotifications(userId!),
    enabled: Boolean(userId),
  });

/** How many are unread. */
export const unreadCount = (notifications: Notification[] | undefined): number =>
  (notifications ?? []).filter((notification) => !notification.is_read).length;

/**
 * The number on the tab badge.
 *
 * `select` narrows the subscription to the count, so a notification whose
 * unrelated fields change — a sender's avatar arriving, say — does not
 * re-render the badge. Before this, the badge read the whole array off
 * AppContext and filtered it on every render of the tab layout.
 */
export const useUnreadNotificationCount = (userId: string | undefined): number => {
  const { data } = useQuery<Notification[], Error, number>({
    queryKey: notificationKeys.forUser(userId ?? ''),
    queryFn: () => fetchNotifications(userId!),
    enabled: Boolean(userId),
    select: unreadCount,
  });

  return data ?? 0;
};
