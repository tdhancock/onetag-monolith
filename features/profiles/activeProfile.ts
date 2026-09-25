// Which profile an account is acting as (ONE-24).
//
// An account can hold an Individual and a Business Profile. The one it acts
// as — the *active profile* — is what every post, comment, like, follow and
// message is attributed to, so getting it wrong publishes under the wrong
// name to the wrong audience. This file holds the three pieces of that:
//
//   1. The selection, per account, in AsyncStorage. A per-device preference,
//      not server data. It is read into the query cache under
//      `activeProfileKeys` rather than held in AppContext, because AppContext
//      itself acts through `useCurrentProfile()`: a selection living there
//      would make this feature depend on the store that depends on it.
//   2. The rule for trusting it: only a profile the account owns.
//   3. What a switch resets — everything cached for the previous profile.

import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { getJSON, setJSON } from '../../services/storage';
import { isAccountScoped } from '../../lib/queryClient';
import { profileKeys } from './keys';
import type { AuthUserId, ProfileId, UserProfile } from './types';

// ─── 1. The stored selection ──────────────────────────────────────────

/**
 * Where an account's selection is stored. Keyed per account, so signing out
 * and into a different account never inherits the previous one's choice.
 */
export const activeProfileStorageKey = (authUserId: string): string => `onetag-active-profile-${authUserId}`;

/**
 * The profile id this account last chose on this device, or null for none.
 *
 * Never throws: storage that cannot be read is treated as no choice, which
 * falls back to the Individual Profile — never to an error screen.
 */
export const readActiveProfileId = async (authUserId: AuthUserId): Promise<string | null> => {
  try {
    const stored = await getJSON<unknown>(activeProfileStorageKey(authUserId));
    return typeof stored === 'string' && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
};

/** Remember this account's choice, for the next launch. */
export const writeActiveProfileId = (authUserId: AuthUserId, profileId: ProfileId): Promise<void> =>
  setJSON(activeProfileStorageKey(authUserId), profileId);

// ─── 2. Trusting it ───────────────────────────────────────────────────

/**
 * The profile to act as: the stored choice **only if** the account owns it,
 * otherwise the account's Individual Profile, otherwise its first.
 *
 * A stored id for a deleted profile, or one written under another account,
 * is never used. RLS would refuse its writes anyway; failing closed here
 * gives a working app instead of a stream of permission errors.
 */
export const chooseActiveProfile = (
  profiles: UserProfile[],
  storedId: string | null | undefined,
): UserProfile | undefined =>
  (storedId ? profiles.find(profile => profile.id === storedId) : undefined) ??
  profiles.find(profile => profile.profileType === 'individual') ??
  profiles[0];

// ─── 3. What a switch resets ──────────────────────────────────────────

const startsWith = (queryKey: QueryKey, prefix: QueryKey): boolean =>
  prefix.every((part, index) => queryKey[index] === part);

/**
 * True for a cached query that belongs to the profile being acted as: its
 * feed, notifications, messages, OneSnaps, saved posts, follow state, and the
 * like and save state inside every cached post. Everything is, except the
 * account-scoped roots and the account's own list of profiles.
 */
export const isProfileScoped = (queryKey: QueryKey): boolean =>
  !isAccountScoped(queryKey) && !startsWith(queryKey, profileKeys.allMine());

/**
 * Drop everything cached for the previous profile.
 *
 * A reset, not an invalidation: an invalidated query keeps showing its old
 * data while it refetches, which here would be the previous identity's feed
 * under the new one's name. Reset queries go back to pending, so screens show
 * their loading state, and the ones on screen refetch at once.
 */
export const resetProfileScopedQueries = (queryClient: QueryClient): Promise<void> =>
  queryClient.resetQueries({ predicate: query => isProfileScoped(query.queryKey) });

/** Who was acting, as the switch watcher remembers it. */
export interface ActingIdentity {
  authUserId: string | undefined;
  profileId: string | undefined;
}

/**
 * Whether moving from one acting identity to the next is a profile switch.
 *
 * Only a change of profile within one signed-in account is. The first load
 * is not (nothing was cached for anyone else), and neither is signing out or
 * into another account — sign-out already removes every query.
 */
export const isProfileSwitch = (before: ActingIdentity, after: ActingIdentity): boolean =>
  Boolean(
    before.authUserId &&
      before.profileId &&
      after.profileId &&
      before.authUserId === after.authUserId &&
      before.profileId !== after.profileId,
  );

/**
 * Reset the profile-scoped cache whenever the acting profile changes. Mount
 * once, as high as possible — AppProvider.
 *
 * It watches the resolved identity rather than hooking the switch call, so a
 * fallback counts too: a selection that stops resolving (its profile deleted
 * elsewhere) resets like a tap in the switcher does.
 *
 * And it resets from an effect on purpose. TanStack hands each observer its
 * new options — the new viewer id inside every queryFn — in an effect, and
 * effects run child-first; AppProvider's run last. Resetting any earlier
 * would refetch the shared-key queries (a post's detail, its comments) with
 * the previous profile's viewer id still captured.
 */
export const useProfileSwitchReset = (authUserId: string | undefined, profileId: string | undefined): void => {
  const queryClient = useQueryClient();
  const previous = useRef<ActingIdentity>({ authUserId, profileId });

  useEffect(() => {
    const next = { authUserId, profileId };
    const before = previous.current;
    // Remember the last profile actually acted as; a moment with none (a
    // reload of the account's profiles) is not a new identity.
    if (profileId || authUserId !== before.authUserId) previous.current = next;
    if (isProfileSwitch(before, next)) void resetProfileScopedQueries(queryClient);
  }, [authUserId, profileId, queryClient]);
};
