// Pure logic for the tag resolution route, app/t/[shortCode].tsx (ONE-30).
//
// Kept out of the screen so the decisions — where a destination routes,
// which state to show, who a scan is attributed to — are tested without
// mounting anything.

import type { TagDestination, TagResolution, TagResolutionError } from '../../features/tags';
import type { AuthStatus } from '../../features/auth';
import type { CurrentProfileStatus } from '../../features/profiles';
import type { ProfileId } from '../../types';

// ─── Where a destination goes ───────────────────────────────────────────

type RouteBuilders = {
  [K in TagDestination['kind']]: (destination: Extract<TagDestination, { kind: K }>) => string;
};

/**
 * One route per destination kind. Adding M5's Products and Projects is one
 * line each here, beside their member of `TagDestination`.
 */
const DESTINATION_ROUTES: RouteBuilders = {
  profile: ({ username }) => `/user/${encodeURIComponent(username)}`,
};

/** The route a destination lives at, or null for a kind this build cannot route. */
export const routeForDestination = (destination: TagDestination): string | null => {
  const build = (DESTINATION_ROUTES as Record<string, ((d: TagDestination) => string) | undefined>)[destination.kind];
  return build ? build(destination) : null;
};

// ─── Which state the screen is in ───────────────────────────────────────

export type TagFailure = 'not-found' | 'inactive' | 'offline' | 'failed' | 'destination-missing';

export type TagScreen =
  | { kind: 'resolving' }
  | { kind: 'redirect'; tagId: string; route: string }
  | { kind: TagFailure };

export interface TagQueryState {
  data?: TagResolution;
  error?: unknown;
  /** A fetch is in flight — the first one, or a retry. */
  isFetching: boolean;
  /** A fetch has completed since the screen mounted. Cached data alone is never acted on. */
  isFetchedAfterMount: boolean;
}

/**
 * A `TagResolutionError` whose request never reached the server. Read by its
 * `reason` rather than `instanceof`, so this file imports no runtime code
 * from the feature — and with it, no Supabase client.
 */
const isOffline = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as Partial<TagResolutionError>).reason === 'offline';

/**
 * What the screen shows for a query state.
 *
 * Only a fetch made since mounting is acted on: a cached or persisted
 * resolution could send someone to a tag's old destination after its owner
 * paused it.
 */
export const tagScreenFor = (query: TagQueryState): TagScreen => {
  if (query.isFetching || !query.isFetchedAfterMount) return { kind: 'resolving' };

  if (query.error) return { kind: isOffline(query.error) ? 'offline' : 'failed' };

  const resolution = query.data;
  if (!resolution || resolution.status === 'not-found') return { kind: 'not-found' };
  if (resolution.status === 'inactive') return { kind: 'inactive' };

  const route = resolution.destination ? routeForDestination(resolution.destination) : null;
  if (!route) return { kind: 'destination-missing' };
  return { kind: 'redirect', tagId: resolution.tagId, route };
};

// ─── Who a scan is attributed to ────────────────────────────────────────

export type ScanAttribution =
  | { known: false }
  | { known: true; scannerProfileId: ProfileId | null };

/**
 * Who a scan is recorded against: the active profile when signed in, nobody
 * when signed out — and not known yet while either is still loading.
 *
 * A cold start from a scanned sticker is exactly when both are still
 * loading, and reading "not known yet" as signed out would record a
 * signed-in person's scan as anonymous.
 */
export const scanAttributionFor = (
  auth: AuthStatus,
  current: { status: CurrentProfileStatus; profileId: ProfileId | undefined },
): ScanAttribution => {
  if (auth === 'signed-out') return { known: true, scannerProfileId: null };
  if (auth === 'unknown') return { known: false };
  if (current.status === 'ready' && current.profileId) return { known: true, scannerProfileId: current.profileId };
  // Signed in with no profile to act as: onboarding's problem, not the scan's.
  if (current.status === 'missing') return { known: true, scannerProfileId: null };
  return { known: false };
};

/**
 * How long a resolved tag waits for the scanner to be known before it
 * records the scan as anonymous and moves on.
 *
 * Normally both are known well before the tag resolves. This bounds the
 * case where the session never settles — its sync failed — so the person
 * is never held on the resolving screen for it.
 */
export const SCAN_ATTRIBUTION_WAIT_MS = 3000;

// ─── What a failure says, and where it goes next ────────────────────────

export interface FailureCopy {
  label: string;
  title: string;
  body: string;
  /** Whether trying again could help. */
  retry: boolean;
}

export const FAILURE_COPY: Record<TagFailure, FailureCopy> = {
  'not-found': {
    label: 'Unknown tag',
    title: "This tag isn't recognized.",
    body: 'Check the code, or see what else is on OneTag.',
    retry: false,
  },
  inactive: {
    label: 'Tag paused',
    title: 'This tag is no longer active.',
    body: 'Its owner has paused or replaced it.',
    retry: false,
  },
  offline: {
    label: 'Offline',
    title: "You're offline.",
    body: 'Connect to the internet to open this tag.',
    retry: true,
  },
  failed: {
    label: 'Something went wrong',
    title: "This tag didn't open.",
    body: 'OneTag had trouble reading it. Try again in a moment.',
    retry: true,
  },
  'destination-missing': {
    label: 'Destination gone',
    title: 'What this tag pointed to is gone.',
    body: 'It may have been removed. There is still plenty on OneTag.',
    retry: false,
  },
};

export interface OnwardAction {
  label: string;
  route: string;
}

/**
 * Where a failure sends someone next — never a dead end (Waterfall
 * Discovery). Into the app when signed in; to sign up, or in, when not.
 * Someone whose session is still loading is offered the signed-out routes;
 * the auth layout moves a signed-in account on from there.
 */
export const onwardActionsFor = (auth: AuthStatus): { primary: OnwardAction; secondary?: OnwardAction } =>
  auth === 'signed-in'
    ? { primary: { label: 'Go to OneTag', route: '/(tabs)' } }
    : {
        primary: { label: 'Join OneTag', route: '/(auth)/signup' },
        secondary: { label: 'Sign in', route: '/(auth)/login' },
      };
