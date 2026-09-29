// React Native wiring for TanStack Query: the provider, the AsyncStorage
// persister that lets a warm cache survive a cold start, and what tells
// TanStack the app has come back to the front or gone offline.
//
// The client itself and the persistence policy live in ./queryClient.ts,
// which stays free of native imports so it can be tested directly.

import React from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Network from 'expo-network';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { useReactQueryDevTools } from '@dev-plugins/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { busterFor, CACHE_TIME_MS, isOnline, queryClient, shouldDehydrateQuery } from './queryClient';

/** AsyncStorage key holding the dehydrated cache. */
export const CACHE_KEY = 'onetag-query-cache';

/** Bumping the app version throws the persisted cache away. See `busterFor`. */
export const CACHE_BUSTER = busterFor(Constants.expoConfig?.version);

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: CACHE_KEY,
});

/**
 * Tells TanStack when the app is in front. It is away from going to the
 * background until it is active again, which refetches stale queries. iOS
 * also goes inactive and back around a permission prompt, Face ID or
 * Control Center; that isn't the person coming back, so it doesn't count.
 */
export const listenForAppFocus = (setFocused: (focused?: boolean) => void): (() => void) => {
  let away = false;
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'background') {
      away = true;
      setFocused(false);
    } else if (state === 'active' && away) {
      away = false;
      setFocused(true);
    }
  });
  return () => subscription.remove();
};

/**
 * Tells TanStack whether the phone is online. Offline, queries wait
 * instead of failing through their retries, and a mutation waits to be
 * sent; reconnecting refetches and sends them.
 */
export const listenForNetwork = (setOnline: (online: boolean) => void): (() => void) => {
  Network.getNetworkStateAsync().then((state) => setOnline(isOnline(state)), () => {});
  const subscription = Network.addNetworkStateListener((state) => setOnline(isOnline(state)));
  return () => subscription.remove();
};

focusManager.setEventListener(listenForAppFocus);
onlineManager.setEventListener(listenForNetwork);

export interface QueryProviderProps {
  children: React.ReactNode;
}

const QueryProvider: React.FC<QueryProviderProps> = ({ children }) => {
  // The cache, in Expo's dev tools: press shift+m in `npx expo start` and
  // pick React Query. Does nothing in a production build. The cast is for
  // Jest, which types the plugin against TanStack's CommonJS build and this
  // client against its ES one: the same class, as two declarations.
  useReactQueryDevTools(queryClient as unknown as Parameters<typeof useReactQueryDevTools>[0]);

  return (
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
};

export default QueryProvider;
