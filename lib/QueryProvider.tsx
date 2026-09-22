// React Native wiring for TanStack Query: the provider plus the AsyncStorage
// persister that lets a warm cache survive a cold start.
//
// The client itself and the persistence policy live in ./queryClient.ts,
// which stays free of native imports so it can be tested directly.

import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { busterFor, CACHE_TIME_MS, queryClient, shouldDehydrateQuery } from './queryClient';

/** AsyncStorage key holding the dehydrated cache. */
export const CACHE_KEY = 'onetag-query-cache';

/** Bumping the app version throws the persisted cache away. See `busterFor`. */
export const CACHE_BUSTER = busterFor(Constants.expoConfig?.version);

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: CACHE_KEY,
});

export interface QueryProviderProps {
  children: React.ReactNode;
}

const QueryProvider: React.FC<QueryProviderProps> = ({ children }) => (
  <PersistQueryClientProvider
    client={queryClient}
    persistOptions={{
      persister,
      buster: CACHE_BUSTER,
      // Matches gcTime: a persisted entry must not outlive the in-memory one.
      maxAge: CACHE_TIME_MS,
      dehydrateOptions: { shouldDehydrateQuery },
    }}
  >
    {children}
  </PersistQueryClientProvider>
);

export default QueryProvider;
