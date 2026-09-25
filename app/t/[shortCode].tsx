import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, MonoLabel } from '../../components/native/ui';
import { useAuthStatus } from '../../features/auth';
import { useCurrentProfile } from '../../features/profiles';
import { useRecordScan, useTagQuery } from '../../features/tags';
import { isValidShortCode } from '../../lib/tagLinks';
import {
  FAILURE_COPY,
  SCAN_ATTRIBUTION_WAIT_MS,
  onwardActionsFor,
  scanAttributionFor,
  tagScreenFor,
} from '../../lib/screens/tagResolution';
import { color, space, type } from '../../theme/tokens';

/**
 * Tag Resolution (ONE-30): every way a Tag is read — the in-app scanner, a
 * universal link from the camera app, a shared link, a typed URL — arrives
 * here as `/t/<shortCode>`, for the custom scheme and the tag host alike.
 *
 * A transition, not a destination. It resolves the tag, records the Scan
 * without waiting on it, and *replaces* itself with the Destination, so Back
 * never returns to a screen that would only redirect again. Nothing here
 * needs a session: the person scanning a sticker is usually a stranger.
 *
 * Every failure is a real screen with somewhere to go next, because the
 * people who reach them are holding a physical object and have no other
 * context.
 */
export default function TagResolutionScreen() {
  const params = useLocalSearchParams<{ shortCode?: string | string[] }>();
  const shortCode = typeof params.shortCode === 'string' ? params.shortCode : '';
  const router = useRouter();

  const query = useTagQuery(shortCode);
  const auth = useAuthStatus();
  const { status: profileStatus, profileId } = useCurrentProfile();
  const { mutate: recordScan } = useRecordScan();

  const screen = tagScreenFor({
    data: query.data,
    error: query.error,
    isFetching: query.isFetching,
    isFetchedAfterMount: query.isFetchedAfterMount,
  });
  const attribution = scanAttributionFor(auth, { status: profileStatus, profileId });

  // A resolved tag waits a bounded time for the scanner to be known, then
  // goes on as anonymous.
  const [attributionTimedOut, setAttributionTimedOut] = useState(false);
  useEffect(() => {
    if (screen.kind !== 'redirect' || attribution.known) return undefined;
    const timer = setTimeout(() => setAttributionTimedOut(true), SCAN_ATTRIBUTION_WAIT_MS);
    return () => clearTimeout(timer);
  }, [screen.kind, attribution.known]);

  // Once per mount: an effect re-run must never write a second scan.
  const handled = useRef(false);
  const tagId = screen.kind === 'redirect' ? screen.tagId : null;
  const route = screen.kind === 'redirect' ? screen.route : null;
  const scannerKnown = attribution.known || attributionTimedOut;
  const scannerProfileId = attribution.known ? attribution.scannerProfileId : null;
  useEffect(() => {
    if (!tagId || !route || !scannerKnown || handled.current) return;
    handled.current = true;

    // Fire and forget: never awaited, so a slow or failed insert cannot hold
    // anyone back from the Destination.
    recordScan({ tagId, scannerProfileId });
    router.replace(route);
  }, [tagId, route, scannerKnown, scannerProfileId, recordScan, router]);

  const header = <Stack.Screen options={{ headerShown: false, gestureEnabled: true }} />;

  if (screen.kind === 'resolving' || screen.kind === 'redirect') {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <View style={styles.center} accessibilityLiveRegion="polite">
          <ActivityIndicator color={color.text} />
          <MonoLabel color="textMuted" style={styles.resolvingLabel}>
            Opening tag
          </MonoLabel>
          {isValidShortCode(shortCode) ? <Text style={styles.code}>{shortCode}</Text> : null}
        </View>
      </SafeAreaView>
    );
  }

  const copy = FAILURE_COPY[screen.kind];
  const onward = onwardActionsFor(auth);

  return (
    <SafeAreaView style={styles.screen}>
      {header}
      <View style={styles.body}>
        <MonoLabel color="textMuted">
          {isValidShortCode(shortCode) ? `${copy.label} · ${shortCode}` : copy.label}
        </MonoLabel>
        <Text style={styles.title} accessibilityRole="header">
          {copy.title}
        </Text>
        <Text style={styles.copy}>{copy.body}</Text>
        <View style={styles.actions}>
          {copy.retry ? (
            <Button fullWidth onPress={() => query.refetch()}>
              Try again
            </Button>
          ) : null}
          <Button
            fullWidth
            variant={copy.retry ? 'outline' : 'primary'}
            onPress={() => router.replace(onward.primary.route)}
          >
            {onward.primary.label}
          </Button>
          {onward.secondary ? (
            <Button fullWidth variant="outline" onPress={() => router.replace(onward.secondary!.route)}>
              {onward.secondary.label}
            </Button>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  resolvingLabel: {
    marginTop: space.lg,
  },
  code: {
    marginTop: space.xs,
    fontFamily: type.mono,
    fontSize: 15,
    color: color.textMid,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  title: {
    marginTop: space.md,
    fontFamily: type.bodyBold,
    fontSize: 24,
    lineHeight: 30,
    color: color.text,
  },
  copy: {
    marginTop: space.sm,
    fontFamily: type.body,
    fontSize: 15,
    lineHeight: 22,
    color: color.textMid,
  },
  actions: {
    marginTop: space.xl,
    gap: space.md,
  },
});
