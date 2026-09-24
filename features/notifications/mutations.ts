// Write hooks for the notifications domain.
//
// Both are optimistic: the rows and the tab badge change the moment the user
// taps, and go back together if the server refuses. A badge that clears and
// then silently returns to 3 is worse than one that takes a moment.
//
// Neither creates the list when it is not cached yet. The screen marks
// everything read as it opens, and writing an empty list there would cancel
// the first fetch and leave the screen blank, marked fresh.
//
// The cycles are plain option builders, like `toggleMutationOptions` in
// lib/optimisticToggle.ts, so the tests drive what ships against a real
// QueryClient without mounting a component.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { markNotificationAsRead, markNotificationsAsRead } from './api';
import { notificationKeys } from './keys';
import type { Notification } from './types';

interface Snapshot {
  previous: Notification[] | undefined;
}

/** Cancel, snapshot and patch the list; hand the snapshot to onError. */
const optimisticallyMark = async (
  queryClient: QueryClient,
  userId: string | undefined,
  isTarget: (notification: Notification) => boolean,
): Promise<Snapshot> => {
  const listKey = notificationKeys.forUser(userId ?? '');

  await queryClient.cancelQueries({ queryKey: listKey });
  const previous = queryClient.getQueryData<Notification[]>(listKey);

  queryClient.setQueryData<Notification[] | undefined>(listKey, (notifications) =>
    notifications?.map((notification) =>
      isTarget(notification) ? { ...notification, is_read: true } : notification,
    ),
  );

  return { previous };
};

const rollback = (queryClient: QueryClient, userId: string | undefined, snapshot?: Snapshot) => {
  if (!snapshot) return;
  queryClient.setQueryData(notificationKeys.forUser(userId ?? ''), snapshot.previous);
};

/** The mark-all-read cycle, as plain mutation options. */
export const markAllReadOptions = (queryClient: QueryClient, userId: string | undefined) => ({
  mutationFn: async (): Promise<void> => {
    if (!userId) throw new Error('You must be signed in.');

    const marked = await markNotificationsAsRead(userId);
    if (!marked) throw new Error('Could not mark notifications as read.');
  },

  onMutate: () => optimisticallyMark(queryClient, userId, () => true),

  onError: (_error: unknown, _variables: void, snapshot?: Snapshot) =>
    rollback(queryClient, userId, snapshot),

  onSettled: () =>
    queryClient.invalidateQueries({ queryKey: notificationKeys.forUser(userId ?? '') }),
});

/** The mark-one-read cycle, as plain mutation options. */
export const markOneReadOptions = (queryClient: QueryClient, userId: string | undefined) => ({
  mutationFn: (notificationId: string) => markNotificationAsRead(notificationId),

  onMutate: (notificationId: string) =>
    optimisticallyMark(queryClient, userId, (notification) => notification.id === notificationId),

  onError: (_error: unknown, _notificationId: string, snapshot?: Snapshot) =>
    rollback(queryClient, userId, snapshot),

  onSettled: () =>
    queryClient.invalidateQueries({ queryKey: notificationKeys.forUser(userId ?? '') }),
});

/** Mark everything read. */
export const useMarkAllRead = (userId: string | undefined) => {
  const queryClient = useQueryClient();
  return useMutation(markAllReadOptions(queryClient, userId));
};

/** Mark one read — what opening it from the list does. */
export const useMarkOneRead = (userId: string | undefined) => {
  const queryClient = useQueryClient();
  return useMutation(markOneReadOptions(queryClient, userId));
};
