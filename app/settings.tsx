import React from 'react';
import { View, ScrollView, Switch, Alert, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../store/AppContext.native';
import { supabase } from '../services/supabase.native';
import { Button, MonoLabel, SettingsRow, SettingsSection } from '../components/native/ui';
import { useUpdateProfile, useCurrentProfile } from '../features/profiles';
import { PRIVATE_ACCOUNT_LABEL, PRIVATE_ACCOUNT_DESCRIPTION } from '../lib/screens/profile';
import { color, space } from '../theme/tokens';

/** The version line at the foot of the list. */
const VERSION_LABEL = 'OneTag Social Mobile v1.0.0';

export default function SettingsScreen() {
  const { addToast } = useApp();
  const { profile: userProfile, profileId } = useCurrentProfile();
  const router = useRouter();

  // Private account writes `profiles.is_private` through the profile
  // mutation (ONE-58). While the save is in flight the switch shows the value
  // being saved, so it does not snap back until the server answers.
  const updateProfile = useUpdateProfile(profileId);
  const isPrivate = updateProfile.isPending
    ? Boolean(updateProfile.variables?.isPrivate)
    : Boolean(userProfile?.isPrivate);

  const handlePrivateChange = (next: boolean) => {
    updateProfile.mutate(
      { isPrivate: next },
      {
        onSuccess: () => addToast(next ? 'Your account is now private.' : 'Your account is now public.', 'info'),
        onError: () => addToast('Could not update your privacy setting.', 'error'),
      },
    );
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error(error);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Permanently delete your account and all of your content. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Call Supabase Edge Function for full account deletion
              const { data, error } = await supabase.functions.invoke('delete-user-account', {
                method: 'POST',
              });

              if (error || !data?.success) {
                const msg = data?.error || error?.message || 'Unknown error';
                console.error('Delete account failed:', msg);
                addToast('Failed to delete account. Please try again.', 'error');
                return;
              }

              await supabase.auth.signOut();
              addToast('Account permanently deleted. You have been signed out.', 'info');
            } catch (error) {
              console.error(error);
              addToast('Failed to delete account. Please try again.', 'error');
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: 'Settings' }} />

      <ScrollView contentContainerStyle={styles.content}>
        <SettingsSection title="Account">
          <SettingsRow title="Edit profile" onPress={() => router.push('/edit-profile')} />
        </SettingsSection>

        <SettingsSection title="Privacy">
          <SettingsRow
            title={PRIVATE_ACCOUNT_LABEL}
            subtitle={PRIVATE_ACCOUNT_DESCRIPTION}
            divider
            control={
              <Switch
                value={isPrivate}
                onValueChange={handlePrivateChange}
                disabled={!profileId || updateProfile.isPending}
                accessibilityLabel={PRIVATE_ACCOUNT_LABEL}
                trackColor={{ true: color.text, false: color.borderStrong }}
                ios_backgroundColor={color.borderStrong}
                thumbColor={color.inverse}
              />
            }
          />
          <SettingsRow title="Blocked accounts" onPress={() => router.push('/blocked-users')} />
        </SettingsSection>

        <SettingsSection title="About">
          <SettingsRow title="Privacy policy" onPress={() => router.push('/privacy-policy')} divider />
          <SettingsRow title="Terms of service" onPress={() => router.push('/terms')} />
        </SettingsSection>

        {/* Its own group, last, and set apart from the rest. */}
        <SettingsSection>
          <SettingsRow
            title="Delete account"
            subtitle="Permanently delete your account and all content"
            destructive
            onPress={handleDeleteAccount}
          />
        </SettingsSection>

        <View style={styles.logout}>
          <Button variant="outline" fullWidth onPress={handleLogout}>
            Log out
          </Button>
        </View>

        <MonoLabel color="textMuted" style={styles.version}>
          {VERSION_LABEL}
        </MonoLabel>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bgSub,
  },
  content: {
    paddingBottom: space.xxl,
  },
  logout: {
    margin: space.xl,
  },
  version: {
    textAlign: 'center',
  },
});
