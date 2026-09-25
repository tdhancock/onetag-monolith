import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '../store/AppContext.native';
import { useUpdateProfile, useUploadAvatar, useCurrentProfile } from '../features/profiles';
import { cleanHtml } from '../lib/cleanHtml';
import { Avatar, TextField } from '../components/native/ui';
import { hasProfileChanges } from '../lib/screens/profile';
import { color, space, type } from '../theme/tokens';

export default function EditProfileScreen() {
  const router = useRouter();
  const { addToast } = useApp();
  const { profile: userProfile, profileId } = useCurrentProfile();
  const updateProfile = useUpdateProfile(profileId);
  const uploadAvatarMutation = useUploadAvatar();

  const [name, setName] = useState(userProfile?.name ?? '');
  const [username, setUsername] = useState(userProfile?.username ?? '');
  const [bio, setBio] = useState(userProfile?.bio ?? '');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Save waits for a change: a new photo, or a field that differs.
  const dirty = hasProfileChanges(userProfile, { name, username, bio }, Boolean(avatarUri));
  const canSave = dirty && !saving;

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);

    const cleanedBio = cleanHtml(bio);

    // Stay on the screen until the save resolves. The previous version
    // navigated back first, so a failure surfaced as a toast over whatever
    // screen the user had already moved on to, with nothing left to retry on.
    try {
      // The avatar has to reach Storage before the profile row is written —
      // `avatar_url` takes the returned public URL, never the local file:// URI.
      let avatarUrl: string | null = null;
      if (avatarUri) {
        avatarUrl = await uploadAvatarMutation.mutateAsync(avatarUri);
      }

      // One call now: the mutation saves the row and updates every cached
      // copy of this person — their own screen and anywhere else they appear.
      await updateProfile.mutateAsync({
        name,
        username,
        bio: cleanedBio,
        ...(avatarUrl ? { profilePicture: avatarUrl } : {}),
      });
      router.back();
    } catch {
      // Nothing was applied locally, so there is nothing to revert — the user
      // keeps their edits on screen and can try again.
      addToast('Failed to save profile. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ presentation: 'modal', headerShown: false }} />
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            hitSlop={12}
            style={styles.headerSide}
          >
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">
            Edit profile
          </Text>
          <View style={[styles.headerSide, styles.headerRight]}>
            {saving ? (
              <ActivityIndicator size="small" color={color.text} accessibilityLabel="Saving" />
            ) : (
              <Pressable
                onPress={handleSave}
                disabled={!canSave}
                accessibilityRole="button"
                accessibilityLabel="Save"
                accessibilityState={{ disabled: !canSave }}
                hitSlop={12}
              >
                <Text style={[styles.save, !canSave && styles.saveDisabled]}>Save</Text>
              </Pressable>
            )}
          </View>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.fill}
        >
          <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
            <View style={styles.avatar}>
              <Avatar
                uri={avatarUri ?? userProfile?.profilePicture}
                name={name || username}
                size={96}
              />
              <Pressable onPress={pickImage} accessibilityRole="button" hitSlop={8} style={styles.changePhoto}>
                <Text style={styles.changePhotoText}>Change photo</Text>
              </Pressable>
            </View>

            <View style={styles.fields}>
              <TextField
                label="Name"
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                accessibilityLabel="Name"
              />
              <TextField
                label="Username"
                value={username}
                onChangeText={setUsername}
                placeholder="username"
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Username"
              />
              <View>
                <TextField
                  label="Bio"
                  value={bio}
                  onChangeText={setBio}
                  placeholder="Tell people about yourself"
                  multiline
                  inputStyle={styles.bio}
                  accessibilityLabel="Bio"
                />
                {/* A count, not a limit: bios have no maximum (ONE-68). */}
                <Text style={styles.count} accessibilityLabel={`${bio.length} characters`}>
                  {bio.length}
                </Text>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
  },
  fill: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  headerSide: {
    minWidth: 64,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  cancel: {
    fontFamily: type.body,
    fontSize: 16,
    color: color.text,
  },
  title: {
    fontFamily: type.bodyBold,
    fontSize: 17,
    color: color.text,
  },
  save: {
    fontFamily: type.bodyBold,
    fontSize: 16,
    color: color.text,
  },
  saveDisabled: {
    color: color.textMuted,
  },
  scroll: {
    paddingBottom: space.xxl,
  },
  avatar: {
    alignItems: 'center',
    paddingVertical: space.xl,
  },
  changePhoto: {
    marginTop: space.md,
    minHeight: 32,
    justifyContent: 'center',
  },
  changePhotoText: {
    fontFamily: type.bodyBold,
    fontSize: 15,
    color: color.text,
  },
  fields: {
    paddingHorizontal: space.lg,
    gap: space.lg,
  },
  bio: {
    minHeight: 110,
  },
  count: {
    marginTop: space.xs,
    alignSelf: 'flex-end',
    fontFamily: type.body,
    fontSize: 12,
    color: color.textMuted,
  },
});
