// Domain types for notifications.
//
// `Notification` and its `normalizeNotification` helpers stay in the repo-root
// `types.ts` — Supabase returns foreign-key joins as arrays and that helper is
// what flattens them, shared with anything that reads a raw row.

export type { Notification } from '../../types';
