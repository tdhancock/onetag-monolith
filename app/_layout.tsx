

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
import { AppProvider, useApp } from '../store/AppContext.native';
import { useCurrentProfile } from '../features/profiles';
import { supabase } from '../services/supabase.native';
import {
  registerForPushNotifications,
  savePushToken,
  addNotificationResponseListener,
  setBadgeCount,
} from '../services/notifications';
import ToastContainer from '../components/native/Toast';
import { color, type } from '../theme/tokens';
import QueryProvider from '../lib/QueryProvider';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const { theme } = useApp();
  const { authUserId, status: profileStatus } = useCurrentProfile();
  const segments = useSegments();
  const router = useRouter();
  const notificationResponseListener = useRef<Notifications.EventSubscription | null>(null);

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
      const inAuthGroup = segments[0] === '(auth)';
      if (!session && !inAuthGroup) {
        router.replace('/(auth)/login');
      } else if (session && inAuthGroup) {
        router.replace('/(tabs)');
      }
    });

    // Auth state change listener — registered ONCE
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        router.replace('/(tabs)');
      } else if (event === 'SIGNED_OUT') {
        router.replace('/(auth)/login');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [fontsLoaded]); // segments removed — listener is stable across navigations

  // Push notifications registration
  // Account-scoped: a device registers for the account, never for one of its
  // profiles (ONE-21), so this keys on the auth user id.
  useEffect(() => {
    if (!authUserId) return;

    registerForPushNotifications().then(async (token) => {
      if (token) {
        await savePushToken(authUserId, token);
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

  // Notification tap handler — route to relevant screen
  useEffect(() => {
    notificationResponseListener.current = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data as Record<string, string> | undefined;
      if (!data) return;

      if (data.type === 'follow' && data.username) {
        router.push(`/user/${data.username}`);
      } else if (data.type === 'message' && data.conversationId) {
        router.push('/messages');
      } else if (data.postId) {
        router.push(`/post/${data.postId}`);
      } else {
        router.push('/notifications');
      }
    });

    return () => {
      notificationResponseListener.current?.remove();
    };
  }, []);

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
      <Stack.Screen name="notifications" options={{ presentation: 'modal' }} />
      <Stack.Screen name="messages" options={{ presentation: 'modal' }} />
      <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
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
