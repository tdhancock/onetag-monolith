// The public surface of the auth session domain. See features/README.md.
//
// No api.ts: the session is pushed by Supabase, never fetched.

export { authKeys } from './keys';
export { useAuthUserId } from './queries';
export { useAuthSessionSync } from './session';
export type { AuthSessionSyncOptions } from './session';
