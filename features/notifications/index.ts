// The public surface of the notifications domain.
//
// Screens and other features import from `features/notifications`, never from
// a file inside it. See features/README.md.

export {
  fetchNotifications,
  fetchNotificationById,
  markNotificationsAsRead,
  markNotificationAsRead,
  NOTIFICATION_SELECT_QUERY,
} from './api';

export { notificationKeys } from './keys';

export { useNotificationsQuery, useUnreadNotificationCount, unreadCount } from './queries';
export { useNotificationsRealtime } from './realtime';

export { useMarkAllRead, useMarkOneRead } from './mutations';

export type { Notification } from './types';
