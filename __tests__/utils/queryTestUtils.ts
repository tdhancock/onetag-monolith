//
// Shared test helpers for the TanStack Query migration.
//
// ONE-12 asked for a `renderWithQuery` wrapper here. That is not buildable in
// this repo yet: Jest runs on ts-jest in a node environment with no React
// Native preset (`jest.config.js`), `jest-expo` is a devDependency but is not
// wired up, and no suite renders a component — the existing ones invoke
// components as functions and inspect the element tree. A provider wrapper
// needs a renderer, so there is nothing for it to wrap.
//
// What the migration tickets actually need is this: a QueryClient configured
// for tests, so a suite can drive real cache behaviour — invalidation,
// optimistic updates and their rollback — without a renderer. ONE-13's toggle
// helper is the next thing that will want it.
//
// If a renderer is wired up later (see ONE-52, which is already about sharing
// the React Native test shims), `renderWithQuery` belongs in this file.

import { QueryClient } from '@tanstack/react-query';

/**
 * A QueryClient for tests.
 *
 * Retries are off so a deliberately failing query fails once and immediately,
 * instead of taking the app's two retries and their backoff into the test's
 * timeout. Garbage collection is off so a cache entry cannot vanish
 * mid-assertion.
 */
export const createTestQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0 },
      mutations: { retry: false },
    },
  });

/** True when TanStack has marked the query at `key` stale. */
export const isInvalidated = (client: QueryClient, key: readonly unknown[]): boolean =>
  client.getQueryState(key)?.isInvalidated === true;
