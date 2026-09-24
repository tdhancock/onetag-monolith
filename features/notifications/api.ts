// Pure Supabase access for the notifications domain.
//
// The list fetch was inlined in an AppContext effect and its rows were
// written into `setState`; `markNotificationsAsRead` lived in
// `services/apiService.ts`. Both are here now (ONE-17).
//
// Sending a notification is deliberately *not* here: three other features do
// that, and a feature's api.ts may not import another feature, so the write
// side lives in `services/notificationWrites.ts` where all of them can reach
// it.

import { supabase } from '../../services/supabase.native';
import { normalizeNotifications } from '../../types';
import type { Notification } from './types';

/**
 * The columns a notification row needs to render.
 *
 * Every foreign key comes back as an array from PostgREST, which is what
 * `normalizeNotifications` flattens — reused rather than rewritten, per the
 * ticket.
 */
export const NOTIFICATION_SELECT_QUERY = `
    id, type, is_read, created_at, content, comment_id,
    sender:profiles!notifications_sender_id_fkey(id, username, avatar_url),
    post:posts!notifications_post_id_fkey(id, content, media:image_url, media_type),
    comment:comments!notifications_comment_id_fkey(id, text:content),
    story:stories!notifications_story_id_fkey(id, media_url)
`;

/** Everything addressed to one user, newest first. */
export const fetchNotifications = async (userId: string): Promise<Notification[]> => {
  const { data, error } = await supabase
    .from('notifications')
    .select(NOTIFICATION_SELECT_QUERY)
    .eq('receiver_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return normalizeNotifications(data || []);
};

/** One notification by id, for hydrating a realtime insert. */
export const fetchNotificationById = async (
  notificationId: string,
): Promise<Notification | undefined> => {
  const { data, error } = await supabase
    .from('notifications')
    .select(NOTIFICATION_SELECT_QUERY)
    .eq('id', notificationId)
    .maybeSingle();

  if (error || !data) return undefined;
  return normalizeNotifications([data])[0];
};

/** Mark every unread notification for this user as read. */
export const markNotificationsAsRead = async (userId: string): Promise<boolean> => {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('receiver_id', userId)
    .eq('is_read', false);

  if (error) {
    console.error('Error marking notifications as read:', error.message || error);
    return false;
  }

  return true;
};

/** Mark one notification as read — what opening it from the list does. */
export const markNotificationAsRead = async (notificationId: string): Promise<void> => {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId);

  if (error) throw error;
};
