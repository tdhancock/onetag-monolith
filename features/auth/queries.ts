// Read hooks for the auth session.

import { useQuery } from '@tanstack/react-query';
import { authKeys } from './keys';
// The account id brand lives on shared ground, beside UserProfile.
import type { AuthUserId } from '../../types';

/**
 * The session as the cache holds it: the account's id when signed in, `null`
 * once known to be signed out, and undefined before the first auth event.
 */
const useSessionQuery = () =>
  useQuery<AuthUserId | null>({
    queryKey: authKeys.session(),
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  });

/**
 * The signed-in account's auth user id, or undefined when signed out or not
 * yet known.
 *
 * The session is written into the cache by `useAuthSessionSync` and never
 * fetched: Supabase pushes it through `onAuthStateChange`, which fires
 * INITIAL_SESSION on subscribe, so the listener is the single writer. It used
 * to live in AppContext as `authUserId` (ONE-20).
 *
 * This is the **account**, not a profile. Anything attributed to a person —
 * a post, a like, a follow — wants a profile id instead.
 */
export const useAuthUserId = (): AuthUserId | undefined => {
  const { data } = useSessionQuery();
  return data ?? undefined;
};

/**
 * Whether anyone is signed in — including "not known yet" (ONE-30).
 *
 * `useAuthUserId` is undefined both before the first auth event and when
 * signed out. Most callers need no more than that, but one that acts on the
 * answer — the tag resolution route, attributing a Scan — must not read
 * "not known yet" as "signed out" on a cold start, and record a signed-in
 * person's scan as anonymous.
 */
export type AuthStatus = 'unknown' | 'signed-in' | 'signed-out';

export const useAuthStatus = (): AuthStatus => {
  const { data } = useSessionQuery();
  if (data === undefined) return 'unknown';
  return data === null ? 'signed-out' : 'signed-in';
};
