// The app's single QueryClient and the policy that goes with it.
//
// Deliberately free of React Native imports: this module is pure
// configuration so it can be asserted in the project's node-environment Jest
// setup without mocking a native module. The RN wiring — the provider, the
// AsyncStorage persister — lives in ./QueryProvider.tsx.
//
// Nothing is migrated onto this yet. It exists so the M2 domain tickets have
// something to migrate onto.

import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query';
import type { Query } from '@tanstack/react-query';

/**
 * How long an unused query stays in the cache: 24 hours.
 *
 * Exported because the persister's `maxAge` has to match `gcTime` — a
 * persisted entry outliving the in-memory one would rehydrate data the client
 * has already decided to forget. One constant, used in both places, so the
 * two cannot drift.
 */
export const CACHE_TIME_MS = 1000 * 60 * 60 * 24;

/**
 * Query-key prefixes that must never be written to disk.
 *
 * `auth` because a persisted session shape is a credential-adjacent artifact
 * with no reason to outlive the process. `messages` because they are realtime
 * and sensitive — showing a stale conversation from a previous launch is
 * worse than showing an empty one for a moment.
 */
export const NEVER_PERSISTED = ['auth', 'messages'] as const;

/**
 * Query-key roots that belong to the account rather than to the profile it
 * is acting as (ONE-24).
 *
 * An account can hold two profiles and switch between them. What it sees
 * while acting as one — its feed, notifications, messages, saved posts, and
 * the like and follow state baked into every cached post and profile —
 * belongs to that profile, and a switch resets all of it. These roots survive
 * a switch: the session, the admin flag, blocks (a person blocks a person),
 * and which profile is active. The account's own list of profiles survives
 * too; `features/profiles` adds that one, since it is a branch of `profiles`.
 *
 * Kept as a list of what survives rather than what resets, so a new domain is
 * reset on a switch by default — stale data under the wrong identity is the
 * failure worth designing out.
 */
export const ACCOUNT_SCOPED_ROOTS = ['auth', 'admin', 'blocks', 'active-profile'] as const;

/** True when a query key sits under one of the account-scoped roots. */
export const isAccountScoped = (queryKey: readonly unknown[]): boolean => {
  const head = queryKey[0];
  return typeof head === 'string' && (ACCOUNT_SCOPED_ROOTS as readonly string[]).includes(head);
};

/** True when a query key is safe to persist. */
export const isPersistable = (queryKey: readonly unknown[]): boolean => {
  const head = queryKey[0];
  if (typeof head !== 'string') return true;
  return !(NEVER_PERSISTED as readonly string[]).includes(head);
};

/**
 * Persist a query only if TanStack would have persisted it anyway — its own
 * default keeps to successful queries — *and* its key is not on the excluded
 * list. Replacing the default outright rather than composing with it would
 * quietly start persisting failed and pending queries.
 */
export const shouldDehydrateQuery = (query: Query): boolean =>
  defaultShouldDehydrateQuery(query) && isPersistable(query.queryKey);

/**
 * The persisted cache's buster string for a given app version.
 *
 * A release can change the shape of what a query returns, and a rehydrated
 * cache from the previous build would hand that old shape to new code. Tying
 * the buster to the version makes every release a clean slate without anyone
 * having to remember to do it. Falls back to `dev` so a missing version
 * yields a stable string rather than `undefined`.
 */
export const busterFor = (version: string | null | undefined): string =>
  `onetag-v${version ?? 'dev'}`;

/** Exponential backoff, capped so a long outage does not stall a retry forever. */
export const retryDelay = (attemptIndex: number): number =>
  Math.min(1000 * 2 ** attemptIndex, 30_000);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A minute of staleness is fine for the feed and for profiles, and
      // this is the main win over today's refetch-on-every-mount behaviour.
      staleTime: 60_000,

      // Long enough that a persisted cache survives a cold start.
      gcTime: CACHE_TIME_MS,

      // Two retries with exponential backoff. Set explicitly rather than
      // left to the library default so a change to it is a decision.
      retry: 2,
      retryDelay,

      // Misfires on React Native — there is no window to focus, and the
      // shim fires on transitions that are not a real return to the app.
      refetchOnWindowFocus: false,

      // Coming back online is a genuine signal that data may have moved on.
      refetchOnReconnect: true,
    },
  },
});
