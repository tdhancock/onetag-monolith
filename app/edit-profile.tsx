

import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '../store/AppContext.native';
import { cleanHtml, uploadAvatar, updateUserProfileData } from '../services/apiService';
import UserAvatar from '../components/native/UserAvatar';
export default function EditProfileScreen() {
  const router = useRouter();
  const { userProfile, updateProfile, addToast } = useApp();

  const [name, setName] = useState(userProfile?.name ?? '');
  const [username, setUsername] = useState(userProfile?.username ?? '');
  const [bio, setBio] = useState(userProfile?.bio ?? '');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    if (saving) return;
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
        avatarUrl = await uploadAvatar(avatarUri);
        if (!avatarUrl) {
          throw new Error('Avatar upload failed');
        }
      }

      const saved = await updateUserProfileData({
        name,
        username,
        bio: cleanedBio,
        ...(avatarUrl ? { profilePicture: avatarUrl } : {}),
      });

      if (!saved) {
        throw new Error('Profile update failed');
      }

      updateProfile({
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
      <Stack.Screen
        options={{
          presentation: 'modal',
          headerShown: false,
        }}
      />
      <SafeAreaView className="flex-1 bg-black">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1"
        >
          {/* Header */}
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-800">
            <Pressable onPress={() => router.back()}>
              <Text className="text-white text-base">Cancel</Text>
            </Pressable>
            <Text className="text-white text-lg font-semibold">Edit Profile</Text>
            <Pressable
              onPress={handleSave}
              disabled={saving}
              className="bg-blue-500 rounded-full px-5 py-1.5 min-w-[70px] items-center"
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-white font-semibold text-sm">Save</Text>
              )}
            </Pressable>
          </View>

          <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
            {/* Avatar Section */}
            <View className="items-center py-6">
              <UserAvatar
                username={userProfile?.username || ''}
                avatarUrl={avatarUri ?? userProfile?.profilePicture}
                size={90}
              />
              <Pressable onPress={pickImage} className="mt-3">
                <Text className="text-blue-500 text-base font-medium">Change Photo</Text>
              </Pressable>
            </View>

            {/* Form Fields */}
            <View className="px-4 gap-5">
              {/* Name */}
              <View>
                <Text className="text-gray-400 text-sm mb-1.5">Name</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name"
                  placeholderTextColor="#6b7280"
                  className="bg-gray-800 text-white rounded-lg px-4 py-3 text-base border border-gray-700"
                />
              </View>

              {/* Username */}
              <View>
                <Text className="text-gray-400 text-sm mb-1.5">Username</Text>
                <View className="flex-row items-center bg-gray-800 rounded-lg border border-gray-700">
                  <View className="pl-4 pr-1 py-3">
                    <Text className="text-gray-400 text-base">@</Text>
                  </View>
                  <TextInput
                    value={username}
                    onChangeText={setUsername}
                    placeholder="username"
                    placeholderTextColor="#6b7280"
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="flex-1 text-white px-2 py-3 text-base"
                  />
                </View>
              </View>

              {/* Bio */}
              <View>
                <Text className="text-gray-400 text-sm mb-1.5">Bio</Text>
                <View className="relative">
                  <TextInput
                    value={bio}
                    onChangeText={setBio}
                    placeholder="Tell us about yourself"
                    placeholderTextColor="#6b7280"
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                    className="bg-gray-800 text-white rounded-lg px-4 py-3 text-base border border-gray-700 min-h-[110px]"
                  />
                </View>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}
