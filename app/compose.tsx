import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Alert,
  Keyboard,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useApp } from '../store/AppContext.native';
import { cleanHtml } from '../services/apiService';
import {
  pickImageFromLibrary,
  captureImageWithCamera,
  attachmentFromParams,
  buildPostMedia,
  type PickedMedia,
  type MediaPickerResult,
} from '../services/mediaPicker';
import UserAvatar from '../components/native/UserAvatar';
import { ImageIcon, PollIcon, XIcon } from '../components/native/Icons';
import type { Post } from '../types';

const MAX_CHARS = 280;

export default function ComposeScreen() {
  const { mediaUri, mediaType: paramMediaType } = useLocalSearchParams<{
    mediaUri?: string;
    mediaType?: string;
  }>();
  const router = useRouter();
  const { userProfile, addProfilePost, addToast } = useApp();
  const inputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();

  // The toolbar owns the bottom inset, not the root SafeAreaView — see the
  // `edges` note on it below. While the keyboard is up, KeyboardAvoidingView
  // has already lifted the toolbar clear of it and the inset would only leave
  // a gap, so it is applied when the keyboard is down and dropped when it is
  // up.
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    // `keyboardWillShow` fires with the animation on iOS; Android only ever
    // emits the `did` pair.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const [content, setContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [isCreatingPoll, setIsCreatingPoll] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [attachment, setAttachment] = useState<PickedMedia | null>(() =>
    attachmentFromParams(mediaUri, paramMediaType),
  );

  const charCount = content.length;
  const canPost =
    (content.trim().length > 0 || attachment) &&
    !isPosting &&
    charCount <= MAX_CHARS &&
    (!isCreatingPoll || (pollQuestion.trim() && pollOptions.filter(o => o.trim()).length >= 2));

  const handlePost = async () => {
    if (!canPost || !userProfile) return;
    setIsPosting(true);

    try {
      const cleanContent = cleanHtml(content.trim());

      const newPost: Post = {
        id: `temp-${Date.now()}`,
        content: cleanContent,
        username: userProfile.username,
        name: userProfile.name || userProfile.username,
        avatar: userProfile.profilePicture || null,
        timestamp: new Date().toISOString(),
        ...buildPostMedia(attachment),
        likes: 0,
        reposts: 0,
        replies: 0,
        isVerified: userProfile.isVerified || false,
        poll: isCreatingPoll
          ? {
              question: pollQuestion.trim(),
              options: pollOptions
                .filter(o => o.trim())
                .map(o => ({ text: o.trim(), votes: 0 })),
            }
          : undefined,
      };

      await addProfilePost(newPost);
      setTimeout(() => router.back(), 400);
    } catch (error) {
      console.error('Failed to publish post', error);
      addToast('Failed to create post.', 'error');
    } finally {
      setIsPosting(false);
    }
  };

  const adoptResult = async (pick: () => Promise<MediaPickerResult>) => {
    try {
      const result = await pick();
      if (result.status === 'selected') {
        setAttachment(result.media);
      } else if (result.status === 'permission-denied') {
        addToast('Camera access is needed to take a photo.', 'error');
      }
    } catch (error) {
      console.error('Failed to attach media', error);
      addToast('Failed to attach photo.', 'error');
    }
  };

  const handleAttachMedia = () => {
    Alert.alert('Add a photo', 'Where should it come from?', [
      { text: 'Photo Library', onPress: () => adoptResult(pickImageFromLibrary) },
      { text: 'Take Photo', onPress: () => adoptResult(captureImageWithCamera) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleRemoveMedia = () => setAttachment(null);

  const addPollOption = () => {
    if (pollOptions.length < 4) {
      setPollOptions([...pollOptions, '']);
    }
  };

  const removePollOption = (index: number) => {
    if (pollOptions.length > 2) {
      setPollOptions(pollOptions.filter((_, i) => i !== index));
    }
  };

  const updatePollOption = (index: number, value: string) => {
    const updated = [...pollOptions];
    updated[index] = value;
    setPollOptions(updated);
  };

  const charProgress = Math.min(charCount / MAX_CHARS, 1);
  const isNearLimit = charCount > MAX_CHARS * 0.8;
  const isOverLimit = charCount > MAX_CHARS;

  return (
    // Top edge only. Padding the bottom here too would shorten the
    // KeyboardAvoidingView's frame while it still measures the keyboard
    // against the full screen, so the toolbar ended up under the keyboard —
    // buttons could end up out of reach. The primary attach control now sits
    // in the scrollable body, so this only affects the secondary toolbar.
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      <Stack.Screen options={{ headerShown: false, presentation: 'modal' }} />

      {/* Header */}
      <View className="px-4 py-3 flex-row justify-between items-center border-b border-gray-900">
        <Pressable onPress={() => router.back()}>
          <Text className="text-white text-base">Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handlePost}
          disabled={!canPost}
          className={`px-6 py-1.5 rounded-full ${canPost ? 'bg-blue-500' : 'bg-blue-500/40'}`}
        >
          {isPosting ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text className={`font-bold ${canPost ? 'text-white' : 'text-white/60'}`}>
              Share
            </Text>
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        // The modal reaches the bottom of the screen and the root no longer
        // pads that edge, so the view's frame and the keyboard's are measured
        // against the same origin and no offset is needed.
        keyboardVerticalOffset={0}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          // Dragging the composer puts the keyboard away once it is up.
          keyboardDismissMode="interactive"
        >
          {/* Compose area */}
          <View className="p-4 flex-row" style={{ gap: 12 }}>
            <UserAvatar
              username={userProfile?.username || ''}
              avatarUrl={userProfile?.profilePicture}
              size={45}
            />
            <View className="flex-1">
              <TextInput
                ref={inputRef}
                multiline
                // Deliberately not `autoFocus`. It raised the keyboard before
                // the screen had settled, which buried the toolbar and left no
                // way back down — the composer opened effectively text-only.
                // Opening with the keyboard down shows the whole screen first;
                // tapping here still brings it up.
                className="text-white text-lg"
                placeholder="What's happening?"
                placeholderTextColor="#6b7280"
                value={content}
                onChangeText={setContent}
                style={{ textAlignVertical: 'top', minHeight: 100 }}
              />
            </View>
          </View>

          {/* Attach control.
              This is the primary one, and it lives in the scrollable body
              rather than only in the bottom toolbar. The toolbar sits at the
              bottom of a KeyboardAvoidingView inside a modal, where the
              keyboard can cover it; this scrolls with the content, so it
              cannot be hidden however the keyboard behaves. */}
          {!attachment && !isCreatingPoll && (
            <View className="px-4 pb-4">
              <Pressable
                onPress={handleAttachMedia}
                accessibilityRole="button"
                accessibilityLabel="Add a photo"
                className="flex-row items-center justify-center border border-gray-800 rounded-2xl py-3"
                style={{ gap: 8 }}
              >
                <ImageIcon color="#3b82f6" size={20} />
                <Text className="text-blue-500 font-semibold text-base">
                  Add photo
                </Text>
              </Pressable>
            </View>
          )}

          {/* Media preview */}
          {attachment && (
            <View className="px-4 pb-4">
              <View className="rounded-2xl overflow-hidden">
                <Image
                  source={{ uri: attachment.uri }}
                  style={{ width: '100%', aspectRatio: 1 }}
                  contentFit="cover"
                />
                <Pressable
                  onPress={handleRemoveMedia}
                  accessibilityLabel="Remove photo"
                  className="absolute top-2 right-2 bg-black/60 p-2 rounded-full"
                >
                  <XIcon color="white" size={18} />
                </Pressable>
              </View>
            </View>
          )}

          {/* Poll section */}
          {isCreatingPoll && (
            <View className="mx-4 mb-4 border border-gray-800 rounded-2xl p-4">
              <View className="flex-row justify-between items-center mb-3">
                <Text className="text-white font-bold text-base">Poll</Text>
                <Pressable onPress={() => setIsCreatingPoll(false)}>
                  <XIcon color="#6b7280" size={20} />
                </Pressable>
              </View>

              <TextInput
                value={pollQuestion}
                onChangeText={setPollQuestion}
                placeholder="Ask a question..."
                placeholderTextColor="#6b7280"
                className="text-white text-base border-b border-gray-800 pb-3 mb-3"
              />

              {pollOptions.map((option, index) => (
                <View key={index} className="flex-row items-center mb-2" style={{ gap: 8 }}>
                  <TextInput
                    value={option}
                    onChangeText={(val) => updatePollOption(index, val)}
                    placeholder={`Option ${index + 1}`}
                    placeholderTextColor="#6b7280"
                    className="flex-1 text-white bg-gray-800 rounded-xl px-4 py-2.5"
                  />
                  {pollOptions.length > 2 && (
                    <Pressable onPress={() => removePollOption(index)}>
                      <XIcon color="#6b7280" size={18} />
                    </Pressable>
                  )}
                </View>
              ))}

              {pollOptions.length < 4 && (
                <Pressable onPress={addPollOption} className="mt-2">
                  <Text className="text-blue-500 font-semibold">+ Add option</Text>
                </Pressable>
              )}
            </View>
          )}
        </ScrollView>

        {/* Toolbar */}
        <View
          className="border-t border-gray-900 px-4 pt-2 flex-row items-center justify-between"
          style={{ paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 8) }}
        >
          <View className="flex-row items-center" style={{ gap: 16 }}>
            {/* Media and polls are mutually exclusive, as they were before:
                a post carries one or the other, never both. */}
            {!isCreatingPoll && (
              <Pressable
                onPress={handleAttachMedia}
                accessibilityLabel="Add a photo"
                className="p-2"
              >
                <ImageIcon color={attachment ? '#3b82f6' : '#6b7280'} size={22} />
              </Pressable>
            )}
            {!attachment && (
              <Pressable
                onPress={() => setIsCreatingPoll(!isCreatingPoll)}
                className="p-2"
              >
                <PollIcon color={isCreatingPoll ? '#3b82f6' : '#6b7280'} size={22} />
              </Pressable>
            )}
          </View>

          {/* Character counter */}
          {charCount > 0 && (
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Text
                className={`text-sm ${
                  isOverLimit
                    ? 'text-red-500'
                    : isNearLimit
                    ? 'text-yellow-500'
                    : 'text-gray-500'
                }`}
              >
                {MAX_CHARS - charCount}
              </Text>
              {/* Simple progress indicator */}
              <View
                className="w-6 h-6 rounded-full border-2"
                style={{
                  borderColor: isOverLimit
                    ? '#ef4444'
                    : isNearLimit
                    ? '#eab308'
                    : '#3b82f6',
                }}
              >
                <View
                  className="rounded-full"
                  style={{
                    width: `${charProgress * 100}%`,
                    height: '100%',
                    backgroundColor: isOverLimit
                      ? '#ef4444'
                      : isNearLimit
                      ? '#eab308'
                      : '#3b82f6',
                    borderRadius: 999,
                  }}
                />
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
