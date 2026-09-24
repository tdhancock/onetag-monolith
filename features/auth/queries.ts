// Read hooks for the auth session.

import { useQuery } from '@tanstack/react-query';
import { authKeys } from './keys';

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
export const useAuthUserId = (): string | undefined => {
  const { data } = useQuery<string | null>({
    queryKey: authKeys.session(),
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  });
  return data ?? undefined;
};
