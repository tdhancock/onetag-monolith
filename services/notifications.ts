

import * as Notifications from 'expo-notifications';
import type { AuthUserId } from '../types';
import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase.native';

// Expo Go removed support for remote push notifications in SDK 53. Registering
// from Expo Go cannot succeed on either platform regardless of configuration,
// so detect it and skip rather than failing on every launch.
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    return null;
  }

  // See the note on isExpoGo above — this cannot succeed in Expo Go.
  if (isExpoGo) {
    return null;
  }

  // Check existing permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Request if not granted
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  // Android notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#3b82f6',
    });
  }

  // Get Expo push token.
  //
  // projectId is required. Passing undefined does NOT make it auto-infer — it
  // makes expo-notifications look for extra.eas.projectId in the manifest and
  // throw when it isn't there. Read it explicitly so a missing id is a clear
  // warning rather than a stack trace.
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

  if (!projectId) {
    console.warn(
      'Push notifications: no EAS projectId configured. Run `eas init` to add ' +
        'extra.eas.projectId to app.json. Skipping registration.',
    );
    return null;
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data;
  } catch (error) {
    // Not fatal — the app works without push.
    console.warn('Push notifications unavailable:', error);
    return null;
  }
}

/**
 * Register this device's push token for the account. Account-scoped: push
 * registration is per device per account, never per profile (ONE-21), and
 * `push_tokens.user_id` references auth.users.
 */
export async function savePushToken(userId: AuthUserId, token: string): Promise<void> {
  try {
    await supabase
      .from('push_tokens')
      .upsert(
        { user_id: userId, token, platform: Platform.OS, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
  } catch (error) {
    console.error('Failed to save push token:', error);
  }
}

export function addNotificationResponseListener(
  callback: (response: Notifications.NotificationResponse) => void,
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener(callback);
}

export function addNotificationReceivedListener(
  callback: (notification: Notifications.Notification) => void,
): Notifications.EventSubscription {
  return Notifications.addNotificationReceivedListener(callback);
}

export async function setBadgeCount(count: number): Promise<void> {
  await Notifications.setBadgeCountAsync(count);
}
