import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useStore } from '@tanstack/react-form';
import { useApp } from '../store/AppContext.native';
import {
  checkUsernameExists,
  useUpdateProfile,
  useUpdateBusinessProfile,
  useUploadAvatar,
  useCurrentProfile,
} from '../features/profiles';
import { cleanHtml } from '../lib/cleanHtml';
import { draftValidator } from '../lib/formErrors';
import { Avatar } from '../components/native/ui';
import KeyboardAvoider from '../components/native/KeyboardAvoider';
import FormScrollView from '../components/native/FormScrollView';
import { useAppForm, useUsernameCheck } from '../components/native/form';
import {
  businessFormValues,
  businessUpdatesFrom,
  editProfileErrors,
  hasBusinessChanges,
  hasProfileChanges,
} from '../lib/screens/profile';
import { color, space, type } from '../theme/tokens';

export default function EditProfileScreen() {
  const router = useRouter();
  const { addToast } = useApp();
  const { profile: userProfile, profileId } = useCurrentProfile();
  const updateProfile = useUpdateProfile(profileId);
  const updateBusiness = useUpdateBusinessProfile(profileId);
  const uploadAvatarMutation = useUploadAvatar();

  // A business profile edits its category, website and location here too
  // (ONE-23). Decided by type, as the profile screen decides what to show.
  const isBusiness = userProfile?.profileType === 'business';
  const originalUsername = userProfile?.username ?? '';

  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  // A new handle is looked up as sign-up's is; the one the profile has is its own.
  const usernameCheck = useUsernameCheck(checkUsernameExists, originalUsername);
  const validate = useMemo(
    () => draftValidator((d: { username: string; website: string }) => editProfileErrors(originalUsername, d, isBusiness)),
    [originalUsername, isBusiness],
  );

  const form = useAppForm({
    defaultValues: {
      name: userProfile?.name ?? '',
      username: originalUsername,
      bio: userProfile?.bio ?? '',
      ...businessFormValues(userProfile),
    },
    validators: { onMount: validate, onChange: validate },
    onSubmit: async ({ value }) => {
      const { name, username, bio, ...business } = value;
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
        if (hasProfileChanges(userProfile, { name, username, bio }, Boolean(avatarUri))) {
          await updateProfile.mutateAsync({
            name,
            username,
            bio: cleanHtml(bio),
            ...(avatarUrl ? { profilePicture: avatarUrl } : {}),
          });
        }
        // The business fields are their own row. The website is stored
        // normalized, scheme included, so it opens when tapped.
        if (isBusiness && hasBusinessChanges(userProfile, business)) {
          await updateBusiness.mutateAsync(businessUpdatesFrom(business));
        }
        router.back();
      } catch {
        // Nothing was applied locally, so there is nothing to revert — the user
        // keeps their edits on screen and can try again.
        addToast('Failed to save profile. Please try again.', 'error');
      }
    },
  });

  // Save waits for a change: a new photo, or a field that differs. A new
  // handle sign-up would refuse, or none at all, cannot be saved; an
  // unchanged one is left alone, so an account older than the rule can still
  // edit its bio.
  const values = useStore(form.store, (state) => state.values);
  const valid = useStore(form.store, (state) => state.canSubmit);
  const saving = useStore(form.store, (state) => state.isSubmitting);
  const { name, username, bio, ...business } = values;
  const dirty =
    hasProfileChanges(userProfile, { name, username, bio }, Boolean(avatarUri)) ||
    (isBusiness && hasBusinessChanges(userProfile, business));
  const canSave = dirty && valid && !saving;

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

  const handleSave = () => {
    if (canSave) void form.handleSubmit();
  };

  return (
    // A modal, declared in app/_layout.tsx. It used to set `presentation`
    // itself, which only takes effect after the screen has been pushed as a
    // card; the native stack cannot convert a pushed screen into a modal in
    // place, and the screen reloaded instead of opening.
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

      <KeyboardAvoider style={styles.fill}>
        <FormScrollView style={styles.fill} contentContainerStyle={styles.scroll}>
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
            <form.AppField name="name">
              {(field) => <field.TextField label="Name" placeholder="Your name" accessibilityLabel="Name" />}
            </form.AppField>
            <form.AppField name="username" validators={usernameCheck.validators}>
              {(field) => (
                <field.UsernameField
                  check={usernameCheck}
                  label="Username"
                  placeholder="username"
                  accessibilityLabel="Username"
                />
              )}
            </form.AppField>
            <View>
              <form.AppField name="bio">
                {(field) => (
                  <field.TextField
                    label="Bio"
                    placeholder="Tell people about yourself"
                    multiline
                    inputStyle={styles.bio}
                    accessibilityLabel="Bio"
                  />
                )}
              </form.AppField>
              {/* A count, not a limit: bios have no maximum (ONE-68). */}
              <Text style={styles.count} accessibilityLabel={`${bio.length} characters`}>
                {bio.length}
              </Text>
            </View>
            {isBusiness ? (
              <>
                <form.AppField name="category">
                  {(field) => (
                    <field.TextField
                      label="Category"
                      placeholder="What kind of business, e.g. Cafe"
                      accessibilityLabel="Category"
                    />
                  )}
                </form.AppField>
                <form.AppField name="website">
                  {(field) => (
                    <field.TextField
                      label="Website"
                      placeholder="example.com"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      textContentType="URL"
                      errorWhileTyping
                      accessibilityLabel="Website"
                    />
                  )}
                </form.AppField>
                <form.AppField name="location">
                  {(field) => (
                    <field.TextField label="Location" placeholder="City, region" accessibilityLabel="Location" />
                  )}
                </form.AppField>
              </>
            ) : null}
          </View>
        </FormScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
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
