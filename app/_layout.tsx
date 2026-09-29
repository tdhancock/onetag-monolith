

import "../global.css";
import React, { useEffect, useRef } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import { DMMono_500Medium } from '@expo-google-fonts/dm-mono';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { AppProvider } from '../store/AppContext.native';
import { useCurrentProfile } from '../features/profiles';
import { supabase } from '../services/supabase.native';
import {
  registerForPushNotifications,
  savePushToken,
  setBadgeCount,
} from '../services/notifications';
import ToastContainer from '../components/native/Toast';
import { color, type } from '../theme/tokens';
import QueryProvider from '../lib/QueryProvider';
import { opensWithoutSession } from '../lib/screens/auth';
import { pushRoute } from '../lib/screens/notifications';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const { authUserId, status: profileStatus } = useCurrentProfile();
  const segments = useSegments();
  const router = useRouter();
  // The auth listener is registered once; it reads where the app is now.
  const currentSegments = useRef(segments);
  currentSegments.current = segments;

  const [fontsLoaded, fontError] = useFonts({
    DMMono_500Medium,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Auth routing — registered once after fonts load, not on every navigation
  useEffect(() => {
    if (!fontsLoaded) return;

    // Initial session check + redirect
    supabase.auth.getSession().then(({ data: { session } }) => {
      const inAuthGroup = currentSegments.current[0] === '(auth)';
      // Tag Resolution never needs an account (ONE-30): a stranger who
      // opens a scanned sticker's link must land on its Destination, not on
      // the sign-in screen. Nor does a product or project page opened from a
      // shared link (ONE-40, ONE-41).
      const publicRoute = opensWithoutSession(currentSegments.current[0]);
      if (!session && !inAuthGroup && !publicRoute) {
        router.replace('/(auth)/login');
      } else if (session && inAuthGroup) {
        router.replace('/(tabs)');
      }
    });

    // Auth state change listener — registered ONCE
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Signing in from the sign-in or sign-up screens goes home. supabase-js
      // also reports SIGNED_IN as it restores a saved session at launch; that
      // must not replace the screen a tag link or a push opened the app on.
      if (event === 'SIGNED_IN' && currentSegments.current[0] === '(auth)') {
        router.replace('/(tabs)');
      } else if (event === 'SIGNED_OUT') {
        router.replace('/(auth)/login');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [fontsLoaded, router]); // not segments: the listener is stable across navigations

  // Push notifications registration
  // Account-scoped: a device registers for the account, never for one of its
  // profiles (ONE-21), so this keys on the auth user id. The session says
  // which account; the token says which device (ONE-112).
  useEffect(() => {
    if (!authUserId) return;

    registerForPushNotifications().then(async (token) => {
      if (token) {
        await savePushToken(token);
      }
    });

    // Clear badge on app open
    setBadgeCount(0);
  }, [authUserId]);

  // A signed-in account with no profile — a failed signup trigger, or a
  // deleted row — has nothing to act as. Route it to onboarding rather than
  // letting every query run with an undefined id (ONE-22).
  useEffect(() => {
    if (profileStatus === 'missing' && segments[0] !== 'onboarding') {
      router.replace('/onboarding');
    }
  }, [profileStatus, segments, router]);

  // A tapped push opens what it is about (pushRoute). The last response,
  // rather than a listener, so a tap that launched the app is handled too:
  // a listener registers after that tap has been delivered, and the app
  // opened on the home tab instead of the follower's profile or the post.
  // It waits for the navigator, which mounts once the fonts have loaded, and
  // is cleared once handled so a later launch doesn't open it again.
  const lastResponse = Notifications.useLastNotificationResponse();
  const handledResponse = useRef<string | null>(null);
  const navigatorReady = Boolean(fontsLoaded || fontError);
  useEffect(() => {
    if (!navigatorReady || !lastResponse) return;
    if (lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = lastResponse.notification.request.identifier;
    if (handledResponse.current === id) return;
    handledResponse.current = id;

    router.push(pushRoute(lastResponse.notification.request.content.data as Record<string, unknown> | undefined) as never);
    Notifications.clearLastNotificationResponse();
  }, [lastResponse, navigatorReady, router]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: color.bg },
        headerTintColor: color.text,
        headerBackTitle: '',
        headerBackButtonDisplayMode: 'minimal',
        headerTitleStyle: { color: color.text, fontFamily: type.bodyBold, fontSize: 17 },
        // Separation comes from hairlines, not shadows (M1c style guide).
        headerShadowVisible: false,
        // Paint every scene white before its own content mounts, so a pushed
        // screen never flashes the navigator's default background first.
        contentStyle: { backgroundColor: color.bg },
      }}
    >
      <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
      <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
      {/* Notifications and Messages lead on to profiles and posts, so they
          are pushed screens, not modals. On iOS anything opened from a modal
          opens as another modal stacked on it, with no Back: a follow
          notification's profile arrived that way, and the way back was a
          swipe down nobody found. */}
      <Stack.Screen name="notifications" options={{ headerShown: true }} />
      <Stack.Screen name="messages/index" options={{ headerShown: true }} />
      {/* A conversation is its own screen, so Back and the swipe both return
          to the inbox. */}
      <Stack.Screen name="messages/[username]" options={{ headerShown: true }} />
      {/* Every modal is declared here, with whether it shows a header, and
          never from inside the screen. A screen that sets `presentation` on
          itself is first pushed as a card and then asked to become a modal,
          which the native stack cannot do in place; one that changes its
          header's visibility inside a modal is remounted, losing its state.
          A modal never pushes a screen onward, for the reason above. */}
      <Stack.Screen name="share-post" options={{ presentation: 'modal', headerShown: true }} />
      <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
      <Stack.Screen name="edit-profile" options={{ presentation: 'modal' }} />
      <Stack.Screen name="create-profile" options={{ presentation: 'modal' }} />
      <Stack.Screen name="tags/create" options={{ presentation: 'modal' }} />
      <Stack.Screen name="product/create" options={{ presentation: 'modal' }} />
      <Stack.Screen name="product/[id]/edit" options={{ presentation: 'modal' }} />
      <Stack.Screen name="project/create" options={{ presentation: 'modal' }} />
      <Stack.Screen name="project/[id]/edit" options={{ presentation: 'modal' }} />
      <Stack.Screen name="project/[id]/link-product" options={{ presentation: 'modal' }} />
      <Stack.Screen name="project/[id]/add-contributor" options={{ presentation: 'modal' }} />
      <Stack.Screen name="story-viewer" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="story-create" options={{ presentation: 'fullScreenModal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.bg }}>
      <SafeAreaProvider>
        {/* Query sits outside AppProvider: AppContext will consume query
            hooks as the M2 tickets land, so it has to be the inner one. */}
        <QueryProvider>
          <AppProvider>
            <StatusBar style="dark" />
            <RootLayoutNav />
            <ToastContainer />
          </AppProvider>
        </QueryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
