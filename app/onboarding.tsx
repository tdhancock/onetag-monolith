import React, { useState } from 'react';
import { View, Text } from 'react-native';
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
    <SafeAreaView style={{ flex: 1, backgroundColor: color.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.lg }}>
        <MonoLabel color="textMuted">Almost there</MonoLabel>
        <Text style={{ fontFamily: type.bodyBold, fontSize: 24, color: color.text }}>
          Set up your profile
        </Text>
        <Text style={{ fontFamily: type.body, fontSize: 15, lineHeight: 22, color: color.textMid }}>
          Your account doesn't have a profile yet. Create one to start posting, following and
          messaging.
        </Text>
        {failed && (
          <Text style={{ fontFamily: type.body, fontSize: 14, color: color.heart }}>
            That didn't work. Check your connection and try again.
          </Text>
        )}
        <Button fullWidth onPress={createProfile} disabled={working || status === 'ready'}>
          {working ? 'Creating…' : 'Create my profile'}
        </Button>
        <Button fullWidth variant="outline" onPress={() => supabase.auth.signOut()} disabled={working}>
          Sign out
        </Button>
      </View>
    </SafeAreaView>
  );
}
