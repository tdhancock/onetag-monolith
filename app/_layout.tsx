

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
import { supabase } from '../services/supabase.native';
import {
  registerForPushNotifications,
  savePushToken,
  addNotificationResponseListener,
  setBadgeCount,
} from '../services/notifications';
import ToastContainer from '../components/native/Toast';
import { color } from '../theme/tokens';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const { userProfile, theme } = useApp();
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
  useEffect(() => {
    if (!userProfile?.id) return;

    registerForPushNotifications().then(async (token) => {
      if (token) {
        await savePushToken(userProfile.id, token);
      }
    });

    // Clear badge on app open
    setBadgeCount(0);
  }, [userProfile?.id]);

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
        headerTitleStyle: { color: color.text, fontWeight: 'bold' },
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
        <AppProvider>
          <StatusBar style="dark" />
          <RootLayoutNav />
          <ToastContainer />
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
