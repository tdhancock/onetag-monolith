//
// target: __tests__/lib/queryClient.test.ts
// The QueryClient and its persistence policy — lib/queryClient.
//
// Every default here was an explicit decision on ONE-10, so each is pinned:
// a later change should be deliberate, not something that drifts in behind a
// library upgrade or a copy-paste.
//
// lib/queryClient.ts imports no React Native, so this suite needs no native
// mocks — which is the reason the client and the provider are separate files.

import { QueryClient } from '@tanstack/react-query';
import type { Query } from '@tanstack/react-query';

import {
  queryClient,
  busterFor,
  isPersistable,
  shouldDehydrateQuery,
  retryDelay,
  CACHE_TIME_MS,
  NEVER_PERSISTED,
} from '../../lib/queryClient';

const queryDefaults = () => queryClient.getDefaultOptions().queries!;

/** A dehydration candidate: only the fields the predicate actually reads. */
const fakeQuery = (
  queryKey: readonly unknown[],
  status: 'success' | 'error' | 'pending' = 'success',
): Query =>
  ({
    queryKey,
    state: { status, data: status === 'success' ? {} : undefined },
    meta: undefined,
  }) as unknown as Query;

// ─── 1. The defaults ────────────────────────────────────────────────────

describe('queryClient — query defaults', () => {
  it('tolerates a minute of staleness', () => {
    // The main win over the current refetch-on-every-mount behaviour.
    expect(queryDefaults().staleTime).toBe(60_000);
  });

  it('keeps an unused query for 24 hours so a persisted cache survives a cold start', () => {
    expect(queryDefaults().gcTime).toBe(CACHE_TIME_MS);
    expect(CACHE_TIME_MS).toBe(1000 * 60 * 60 * 24);
  });

  it('retries twice', () => {
    expect(queryDefaults().retry).toBe(2);
  });

  it('does not refetch on window focus — it misfires on React Native', () => {
    expect(queryDefaults().refetchOnWindowFocus).toBe(false);
  });

  it('does refetch on reconnect', () => {
    expect(queryDefaults().refetchOnReconnect).toBe(true);
  });

  it('is a singleton — the same instance on every import', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const again = require('../../lib/queryClient').queryClient;
    expect(again).toBe(queryClient);
    expect(queryClient).toBeInstanceOf(QueryClient);
  });
});

// ─── 2. Backoff ─────────────────────────────────────────────────────────

describe('queryClient — retry backoff', () => {
  it('backs off exponentially', () => {
    expect(retryDelay(0)).toBe(1000);
    expect(retryDelay(1)).toBe(2000);
    expect(retryDelay(2)).toBe(4000);
  });

  it('caps the delay so a long outage does not stall a retry forever', () => {
    expect(retryDelay(20)).toBe(30_000);
    expect(retryDelay(100)).toBe(30_000);
  });

  it('is wired into the client, not just exported', () => {
    expect(queryDefaults().retryDelay).toBe(retryDelay);
  });
});

// ─── 3. The cache buster ────────────────────────────────────────────────

describe('queryClient — cache buster', () => {
  it('carries the app version, so a release starts from a clean cache', () => {
    expect(busterFor('1.0.8')).toBe('onetag-v1.0.8');
    expect(busterFor('2.0.0')).toBe('onetag-v2.0.0');
  });

  it('changes when the version changes — that is the whole point', () => {
    expect(busterFor('1.0.8')).not.toBe(busterFor('1.0.9'));
  });

  it('falls back to a stable string rather than undefined', () => {
    expect(busterFor(undefined)).toBe('onetag-vdev');
    expect(busterFor(null)).toBe('onetag-vdev');
  });
});

// ─── 4. What never reaches disk ─────────────────────────────────────────

describe('queryClient — persistence exclusions', () => {
  it('excludes auth and messages', () => {
    expect(NEVER_PERSISTED).toEqual(['auth', 'messages']);
  });

  it('refuses to persist a key beginning messages', () => {
    // The acceptance criterion. A stale persisted conversation is worse than
    // an empty one for a moment.
    expect(isPersistable(['messages'])).toBe(false);
    expect(isPersistable(['messages', 'conversation', 'abc123'])).toBe(false);
    expect(shouldDehydrateQuery(fakeQuery(['messages', 'abc123']))).toBe(false);
  });

  it('refuses to persist a key beginning auth', () => {
    expect(isPersistable(['auth'])).toBe(false);
    expect(isPersistable(['auth', 'session'])).toBe(false);
    expect(shouldDehydrateQuery(fakeQuery(['auth', 'session']))).toBe(false);
  });

  it('persists everything else', () => {
    for (const key of [['feed'], ['profiles', 'layla'], ['comments', 'post-1'], ['tags']]) {
      expect(isPersistable(key)).toBe(true);
      expect(shouldDehydrateQuery(fakeQuery(key))).toBe(true);
    }
  });

  it('only matches the first key segment, not a substring of it', () => {
    // 'messages' must not blacklist 'messagesPreview' by accident, and a
    // nested occurrence is a different query entirely.
    expect(isPersistable(['messagesPreview'])).toBe(true);
    expect(isPersistable(['notifications', 'messages'])).toBe(true);
  });

  it('leaves a non-string first segment alone', () => {
    expect(isPersistable([{ scope: 'feed' }])).toBe(true);
    expect(isPersistable([])).toBe(true);
  });
});

// ─── 5. Composed with the library default, not replacing it ─────────────

describe('queryClient — dehydration keeps the library default', () => {
  it('still refuses failed and pending queries', () => {
    // Overriding shouldDehydrateQuery outright would quietly start writing
    // errored and in-flight queries to disk. It has to compose with
    // defaultShouldDehydrateQuery, not replace it.
    expect(shouldDehydrateQuery(fakeQuery(['feed'], 'error'))).toBe(false);
    expect(shouldDehydrateQuery(fakeQuery(['feed'], 'pending'))).toBe(false);
    expect(shouldDehydrateQuery(fakeQuery(['feed'], 'success'))).toBe(true);
  });
});
