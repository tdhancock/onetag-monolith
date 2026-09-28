

import * as Notifications from 'expo-notifications';
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

/** The token this device registered, so signing out removes exactly it. */
let registeredToken: string | null = null;

/** How long signing out waits for the device's token to be removed. */
export const REMOVE_TOKEN_TIMEOUT_MS = 3000;

/**
 * Register this device's push token for the signed-in account.
 *
 * Account-scoped: a device registers per account, never per profile (ONE-21).
 * One row per device, keyed by the token, so each device an account is signed
 * in on gets its pushes (ONE-112). `register_push_token` runs as the database
 * because the row may still be another account's, left by one that signed
 * out here while offline; registering moves it to this one.
 */
export async function savePushToken(token: string): Promise<void> {
  try {
    const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
    if (error) throw error;
    registeredToken = token;
  } catch (error) {
    console.error('Failed to save push token:', error);
  }
}

/**
 * Stop this device's pushes for the signed-in account. Call it before signing
 * out, while the session can still delete the row, so a shared device stops
 * showing the last account's pushes.
 *
 * Never throws, and waits at most REMOVE_TOKEN_TIMEOUT_MS, so signing out
 * offline isn't held up. A row left behind moves to whichever account signs in
 * here next.
 */
export async function removePushToken(): Promise<void> {
  const token = registeredToken;
  if (!token) return;
  registeredToken = null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, REMOVE_TOKEN_TIMEOUT_MS);
  });
  const removal = (async () => {
    const { error } = await supabase.from('push_tokens').delete().eq('token', token);
    if (error) throw error;
  })();

  try {
    await Promise.race([removal, timeout]);
  } catch (error) {
    console.error('Failed to remove push token:', error);
  } finally {
    clearTimeout(timer);
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
