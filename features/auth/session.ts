// Keeping the query cache in step with the Supabase auth session.
//
// Moved out of AppContext in ONE-20, where it wrote the session into
// component state. It writes into the cache instead, under `authKeys`, which
// is never persisted.
//
// Three events matter:
//   * SIGNED_IN / INITIAL_SESSION / USER_UPDATED — make sure the profile row
//     exists, then record who is signed in. Recording it only after the row
//     exists is what keeps the profile query from racing a brand-new signup.
//   * SIGNED_OUT — everything cached belongs to the previous account, so
//     every query but the session is dropped and the session records null.
//   * TOKEN_REFRESHED — a silent refresh; nothing changes.

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../services/supabase.native';
import { ensureCurrentUserProfile } from '../../services/profileBootstrap';
import { authKeys } from './keys';

const SIGNED_IN_EVENTS = new Set(['SIGNED_IN', 'INITIAL_SESSION', 'USER_UPDATED']);

export interface AuthSessionSyncOptions {
  /** Called when a signed-in session could not be set up. */
  onSyncError?: (error: unknown) => void;
}

/** Subscribe to auth changes for as long as the caller is mounted. Mount once. */
export const useAuthSessionSync = ({ onSyncError }: AuthSessionSyncOptions = {}): void => {
  const queryClient = useQueryClient();

  // Read through a ref so an inline callback does not resubscribe every render.
  const onError = useRef(onSyncError);
  onError.current = onSyncError;

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user && SIGNED_IN_EVENTS.has(event)) {
        try {
          await ensureCurrentUserProfile();
          queryClient.setQueryData(authKeys.session(), session.user.id);
        } catch (error) {
          console.error('Error syncing user data:', error);
          onError.current?.(error);
        }
      } else if (event === 'SIGNED_OUT') {
        // Record the empty session in the query everyone is already watching,
        // then drop every other query. `queryClient.clear()` would remove the
        // session query too, and a value written afterwards lands in a new
        // query the mounted `useAuthUserId` observers are not attached to —
        // the app would keep reporting the previous account.
        queryClient.setQueryData(authKeys.session(), null);
        queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== authKeys.all[0] });
        queryClient.getMutationCache().clear();
      }
    });

    return () => data.subscription.unsubscribe();
  }, [queryClient]);
};
