// Live notifications, through the shared bridge.
//
// The old path was a raw channel in AppContext that re-fetched the whole list
// on every event. This appends the one row that arrived, and only falls back
// to a refetch when it cannot hydrate it.
//
// The cache writes are exported as plain functions so the tests exercise them
// against a real QueryClient without a socket.

import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { fetchNotificationById } from './api';
import { notificationKeys } from './keys';
import type { Notification } from './types';
import { useRealtimeSync, upsertById, type RealtimeRow } from '../../lib/realtimeBridge';
import type { ProfileId } from '../../types';

/**
 * Put a hydrated notification at the top of the cached list, once.
 *
 * `upsertById` is what keeps a notification the user's own action triggered
 * from appearing twice when the insert and a refetch race.
 *
 * No list cached yet means nothing to add to: writing a one-row list would
 * mark it fresh and stop the real fetch from ever running.
 */
export const addNotificationToCache = (
  queryClient: QueryClient,
  userId: string,
  notification: Notification,
): void => {
  queryClient.setQueryData<Notification[] | undefined>(
    notificationKeys.forUser(userId),
    (notifications) => notifications && upsertById(notifications, notification),
  );
};

/**
 * Fold a realtime UPDATE into the cached row.
 *
 * An update is almost always `is_read` flipping, which the row itself carries
 * — no need to re-read the joins. Like the insert, it never creates the list.
 */
export const applyNotificationUpdate = (
  queryClient: QueryClient,
  userId: string,
  row: RealtimeRow,
): boolean => {
  const id = typeof row.id === 'string' ? row.id : undefined;
  if (!id) return false;

  queryClient.setQueryData<Notification[] | undefined>(
    notificationKeys.forUser(userId),
    (notifications) =>
      notifications?.map((notification) =>
        notification.id === id ? { ...notification, ...(row as Partial<Notification>) } : notification,
      ),
  );
  return true;
};

/**
 * Keep the signed-in user's notifications current.
 *
 * A realtime row carries only the `notifications` columns — the sender's
 * username and avatar live behind a foreign key — so an inserted row is
 * re-read by id before it goes into the cache.
 */
export const useNotificationsRealtime = (userId: ProfileId | undefined): void => {
  const queryClient = useQueryClient();
  const listKey = notificationKeys.forUser(userId ?? '');

  useRealtimeSync({
    table: 'notifications',
    filter: `receiver_id=eq.${userId ?? ''}`,
    queryKey: listKey,
    enabled: Boolean(userId),

    onInsert: (row) => {
      const id = typeof row.id === 'string' ? row.id : undefined;
      if (!id || !userId) return false;

      fetchNotificationById(id).then((notification) => {
        if (!notification) {
          queryClient.invalidateQueries({ queryKey: listKey });
          return;
        }
        addNotificationToCache(queryClient, userId, notification);
      });

      return true;
    },

    onUpdate: (row) => (userId ? applyNotificationUpdate(queryClient, userId, row) : false),
  });
};
