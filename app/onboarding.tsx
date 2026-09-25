import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Button, MonoLabel } from '../components/native/ui';
import { profileKeys, useCurrentProfile } from '../features/profiles';
import { ensureCurrentUserProfile } from '../services/profileBootstrap';
import { supabase } from '../services/supabase.native';
import { color, space, type } from '../theme/tokens';

/**
 * Where a signed-in account with no profile lands (ONE-22).
 *
 * The signup trigger creates every account's Individual Profile, and the
 * session sync backfills one if it is missing, so this is rare: a trigger
 * that failed, or a profile row that was deleted. Without it, every query
 * keyed on the acting profile would run with an undefined id. Here the
 * account can create its profile, or sign out.
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status } = useCurrentProfile();
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  const createProfile = async () => {
    setWorking(true);
    setFailed(false);
    try {
      const created = await ensureCurrentUserProfile();
      if (!created) throw new Error('Profile was not created.');
      await queryClient.invalidateQueries({ queryKey: profileKeys.all });
      router.replace('/(tabs)');
    } catch (error) {
      console.error('Could not create a profile', error);
      setFailed(true);
    } finally {
      setWorking(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.body}>
        <MonoLabel color="textMuted">Almost there</MonoLabel>
        <Text style={styles.title} accessibilityRole="header">
          Set up your profile
        </Text>
        <Text style={styles.copy}>
          Your account doesn't have a profile yet. Create one to start posting, following and
          messaging.
        </Text>
        {/* A form-level error, as on the sign-in screens: once, above the action. */}
        {failed && (
          <View style={styles.error} accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>That didn't work. Check your connection and try again.</Text>
          </View>
        )}
        <View style={styles.actions}>
          <Button fullWidth onPress={createProfile} loading={working} disabled={status === 'ready'}>
            Create my profile
          </Button>
          <Button fullWidth variant="outline" onPress={() => supabase.auth.signOut()} disabled={working}>
            Sign out
          </Button>
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
  error: {
    marginTop: space.lg,
    padding: space.md,
    backgroundColor: color.bgPanel,
  },
  errorText: {
    fontFamily: type.body,
    fontSize: 13,
    lineHeight: 18,
    color: color.heart,
  },
  actions: {
    marginTop: space.xl,
    gap: space.md,
  },
});
