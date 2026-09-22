//
// target: __tests__/lib/QueryProvider.test.ts
// The persistence wiring — lib/QueryProvider.
//
// queryClient.test.ts pins the client's defaults. This pins the half that
// only exists once the provider is assembled: the storage key, the buster,
// the maxAge, and the fact that the dehydration predicate is actually
// handed over rather than merely exported.
//
// The provider is invoked as a plain function and the props it builds are
// inspected, so no renderer and no real AsyncStorage are needed.

import React from 'react';

const mockPersisterConfig: Record<string, unknown> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}), { virtual: true });

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.8' } },
}), { virtual: true });

jest.mock('@tanstack/query-async-storage-persister', () => ({
  __esModule: true,
  createAsyncStoragePersister: (config: Record<string, unknown>) => {
    Object.assign(mockPersisterConfig, config);
    return { persisterId: 'stub' };
  },
}));

jest.mock('@tanstack/react-query-persist-client', () => {
  const React = require('react');
  const PersistQueryClientProvider: React.FC<Record<string, unknown>> = (props) =>
    React.createElement('PersistQueryClientProvider', props, props.children as React.ReactNode);
  PersistQueryClientProvider.displayName = 'PersistQueryClientProvider';
  return { __esModule: true, PersistQueryClientProvider };
});

import QueryProvider, { CACHE_KEY, CACHE_BUSTER } from '../../lib/QueryProvider';
import { busterFor, CACHE_TIME_MS, queryClient, shouldDehydrateQuery } from '../../lib/queryClient';

type PersistOptions = {
  persister: unknown;
  buster: string;
  maxAge: number;
  dehydrateOptions: { shouldDehydrateQuery: unknown };
};

type ProviderElement = React.ReactElement<{
  client: unknown;
  persistOptions: PersistOptions;
  children: React.ReactNode;
}>;

const render = (children: React.ReactNode = 'app'): ProviderElement =>
  (QueryProvider as unknown as (p: { children: React.ReactNode }) => ProviderElement)({
    children,
  });

const persistOptions = () => render().props.persistOptions;

// ─── 1. Renders ─────────────────────────────────────────────────────────

describe('QueryProvider — rendering', () => {
  it('renders without crashing', () => {
    expect(() => render()).not.toThrow();
  });

  it('renders its children', () => {
    expect(render('app').props.children).toBe('app');
  });

  it('hands over the shared client, not a fresh one', () => {
    expect(render().props.client).toBe(queryClient);
  });
});

// ─── 2. The persister ───────────────────────────────────────────────────

describe('QueryProvider — persister', () => {
  it('writes under the agreed AsyncStorage key', () => {
    expect(CACHE_KEY).toBe('onetag-query-cache');
    expect(mockPersisterConfig.key).toBe('onetag-query-cache');
  });

  it('reuses the existing AsyncStorage rather than a second storage layer', () => {
    const storage = mockPersisterConfig.storage as Record<string, unknown>;
    expect(typeof storage.getItem).toBe('function');
    expect(typeof storage.setItem).toBe('function');
  });
});

// ─── 3. maxAge cannot drift from gcTime ─────────────────────────────────

describe('QueryProvider — maxAge', () => {
  it('matches gcTime exactly', () => {
    // A persisted entry outliving the in-memory one would rehydrate data the
    // client has already decided to forget.
    expect(persistOptions().maxAge).toBe(CACHE_TIME_MS);
    expect(persistOptions().maxAge).toBe(queryClient.getDefaultOptions().queries!.gcTime);
  });
});

// ─── 4. The buster is tied to the app version ───────────────────────────

describe('QueryProvider — cache buster', () => {
  it('carries the app version, so a release starts from a clean cache', () => {
    expect(CACHE_BUSTER).toBe('onetag-v1.0.8');
    expect(persistOptions().buster).toBe(CACHE_BUSTER);
  });

  it('is derived from the version rather than assembled inline', () => {
    expect(CACHE_BUSTER).toBe(busterFor('1.0.8'));
  });
});

// ─── 5. The exclusion predicate is actually wired in ────────────────────

describe('QueryProvider — dehydration', () => {
  it('passes the shared predicate through to persistOptions', () => {
    // Exporting the predicate but forgetting to hand it over would persist
    // auth and messages while every unit test still passed.
    expect(persistOptions().dehydrateOptions.shouldDehydrateQuery).toBe(shouldDehydrateQuery);
  });
});
