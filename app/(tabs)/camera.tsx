

import React, { useState, useRef, useCallback } from 'react';
import { View, Text, Pressable, Alert, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useApp } from '../../store/AppContext.native';
import { useUploadStory } from '../../features/stories';
import { pickImageFromLibrary } from '../../services/mediaPicker';
import {
  CameraIcon,
  FlipCameraIcon,
  ImageIcon,
  XIcon,
} from '../../components/native/Icons';

export default function CameraScreen() {
  const router = useRouter();
  const { userProfile, addToast, triggerHapticFeedback } = useApp();
  // The optimistic entry, its replacement by the server copy and its removal
  // on failure all happen inside the mutation (ONE-19).
  const uploadStory = useUploadStory(
    userProfile?.id
      ? { id: userProfile.id, username: userProfile.username, avatar: userProfile.profilePicture || null }
      : undefined,
  );
  const cameraRef = useRef<CameraView>(null);

  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [capturing, setCapturing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const toggleFacing = useCallback(() => {
    triggerHapticFeedback('light');
    setFacing(prev => (prev === 'back' ? 'front' : 'back'));
  }, [triggerHapticFeedback]);

  const handleUploadStory = useCallback(async (uri: string) => {
    if (!userProfile?.id || uploading) return;

    setUploading(true);
    addToast('Uploading story...', 'info');

    try {
      await uploadStory.mutateAsync({ imageUri: uri, caption: null });
    } catch (error) {
      console.error('Story upload failed', error);
      addToast('Failed to upload story.', 'error');
    } finally {
      setUploading(false);
      // Small delay so toast is visible
      setTimeout(() => router.navigate('/(tabs)'), 1000);
    }
  }, [userProfile?.id, uploading, uploadStory, addToast, router]);

  const takePhoto = useCallback(async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    triggerHapticFeedback('medium');

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) {
        Alert.alert('Share as', 'What would you like to do with this photo?', [
          {
            text: 'Story',
            onPress: () => handleUploadStory(photo.uri),
          },
          {
            text: 'Post',
            onPress: () =>
              router.push({
                pathname: '/compose',
                // Dimensions travel with the URI so the composer can measure
                // the aspect ratio at the source rather than from a rendered
                // view — see ONE-55.
                params: {
                  mediaUri: photo.uri,
                  mediaType: 'image',
                  mediaWidth: String(photo.width ?? ''),
                  mediaHeight: String(photo.height ?? ''),
                },
              }),
          },
          { text: 'Cancel', style: 'cancel' },
        ]);
      }
    } catch (error) {
      console.error('Failed to take photo', error);
      addToast('Failed to capture photo.', 'error');
    } finally {
      setCapturing(false);
    }
  }, [capturing, triggerHapticFeedback, handleUploadStory, router, addToast]);

  const pickFromGallery = useCallback(async () => {
    const result = await pickImageFromLibrary();

    if (result.status === 'selected') {
      const { uri, width, height } = result.media;
      Alert.alert('Share as', 'What would you like to do with this photo?', [
        {
          text: 'Story',
          onPress: () => handleUploadStory(uri),
        },
        {
          text: 'Post',
          onPress: () =>
            router.push({
              pathname: '/compose',
              params: {
                mediaUri: uri,
                mediaType: 'image',
                mediaWidth: String(width ?? ''),
                mediaHeight: String(height ?? ''),
              },
            }),
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [handleUploadStory, router]);

  // Permission not determined
  if (!permission) {
    return (
      <SafeAreaView className="flex-1 bg-black justify-center items-center">
        <Text className="text-gray-400">Loading camera...</Text>
      </SafeAreaView>
    );
  }

  // Permission denied
  if (!permission.granted) {
    return (
      <SafeAreaView className="flex-1 bg-black justify-center items-center px-8">
        <CameraIcon color="#6b7280" size={64} />
        <Text className="text-white text-xl font-bold mt-6 mb-2 text-center">
          Camera Access Required
        </Text>
        <Text className="text-gray-400 text-center mb-6">
          Allow camera access to take photos and create stories.
        </Text>
        <Pressable
          onPress={requestPermission}
          className="bg-blue-500 px-8 py-3 rounded-full"
        >
          <Text className="text-white font-bold text-base">Grant Access</Text>
        </Pressable>
        <Pressable onPress={pickFromGallery} className="mt-4">
          <Text className="text-blue-500 font-semibold">Pick from Gallery instead</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
      />

      {/* Uploading overlay */}
      {uploading && (
        <View className="absolute inset-0 bg-black/70 z-20 items-center justify-center">
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text className="text-white mt-4 font-semibold text-lg">Uploading story...</Text>
        </View>
      )}

      {/* Top controls */}
      <SafeAreaView edges={['top']} className="absolute top-0 left-0 right-0 z-10">
        <View className="flex-row justify-between items-center px-4 py-2">
          <Pressable
            onPress={() => router.back()}
            className="bg-black/40 p-2 rounded-full"
          >
            <XIcon color="white" size={24} />
          </Pressable>
          <Pressable
            onPress={toggleFacing}
            className="bg-black/40 p-2 rounded-full"
          >
            <FlipCameraIcon color="white" size={24} />
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Bottom controls */}
      <SafeAreaView edges={['bottom']} className="absolute bottom-0 left-0 right-0 z-10">
        <View className="flex-row justify-around items-center pb-6 pt-4">
          {/* Gallery */}
          <Pressable
            onPress={pickFromGallery}
            className="bg-black/40 p-3 rounded-full"
          >
            <ImageIcon color="white" size={28} />
          </Pressable>

          {/* Capture */}
          <Pressable
            onPress={takePhoto}
            disabled={capturing}
            className="items-center justify-center"
          >
            <View
              className="w-20 h-20 rounded-full border-4 border-white items-center justify-center"
              style={{ opacity: capturing ? 0.5 : 1 }}
            >
              <View className="w-16 h-16 rounded-full bg-white" />
            </View>
          </Pressable>

          {/* Placeholder for symmetry */}
          <View className="w-14" />
        </View>
      </SafeAreaView>
    </View>
  );
}
