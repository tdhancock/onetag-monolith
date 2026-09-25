import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ScrollView,
  Alert,
  StyleSheet,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../store/AppContext.native';
import { useCurrentProfile } from '../features/profiles';
import { useCreatePost } from '../features/posts';
import { MediaUploadError } from '../services/mediaUpload';
import { cleanHtml } from '../lib/cleanHtml';
import {
  pickImageFromLibrary,
  captureImageWithCamera,
  attachmentFromParams,
  mediaAspectRatio,
  buildPostMedia,
  type PickedMedia,
  type MediaPickerResult,
} from '../services/mediaPicker';
import { Avatar, Button, IconButton } from '../components/native/ui';
import ComposeMedia from '../components/native/ComposeMedia';
import CharacterRing from '../components/native/CharacterRing';
import { ImageIcon } from '../components/native/Icons';
import { canPublish } from '../lib/screens/compose';
import { color, space, type } from '../theme/tokens';
import type { Post } from '../types';

/** What PostCard renders when a post carries no ratio. Kept in step with it. */
const FALLBACK_ASPECT_RATIO = 1080 / 1350;

/** A fallback for raising the keyboard if the modal reports no transition end. */
const FOCUS_FALLBACK_MS = 600;

type TransitionListener = (event: { data?: { closing?: boolean } }) => void;
type TransitionNavigation = { addListener: (event: 'transitionEnd', listener: TransitionListener) => () => void };

export default function ComposeScreen() {
  const { mediaUri, mediaType: paramMediaType, mediaWidth, mediaHeight } = useLocalSearchParams<{
    mediaUri?: string;
    mediaType?: string;
    mediaWidth?: string;
    mediaHeight?: string;
  }>();
  const router = useRouter();
  const navigation = useNavigation() as unknown as TransitionNavigation;
  const { addToast } = useApp();
  const { profile: userProfile, profileId } = useCurrentProfile();

  // Publishing is a mutation now (ONE-15). It still rejects when the media
  // could not be uploaded, which is what keeps this screen open with the
  // draft intact (ONE-56).
  const createPost = useCreatePost(profileId);
  const inputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();

  const [content, setContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [keyboardUp, setKeyboardUp] = useState(false);
  const [attachment, setAttachmentState] = useState<PickedMedia | null>(() =>
    attachmentFromParams(mediaUri, paramMediaType, mediaWidth, mediaHeight),
  );

  // A different photo, or none, is a fresh attempt: the failure note was about
  // the one that is gone.
  const setAttachment = (media: PickedMedia | null) => {
    setAttachmentState(media);
    setUploadFailed(false);
  };

  // The keyboard comes up once the modal has finished opening, not with
  // `autoFocus`. Raising it during the opening animation, before the screen had
  // settled, is what once buried the controls below the text; waiting for the
  // transition to end avoids that. The timer covers a presentation that reports
  // no transition end.
  useEffect(() => {
    let focused = false;
    const focus = () => {
      if (focused) return;
      focused = true;
      inputRef.current?.focus();
    };
    const unsubscribe = navigation.addListener?.('transitionEnd', (event) => {
      if (!event?.data?.closing) focus();
    });
    const timer = setTimeout(focus, FOCUS_FALLBACK_MS);
    return () => {
      unsubscribe?.();
      clearTimeout(timer);
    };
  }, [navigation]);

  // The toolbar sits on the keyboard while it is up, and above the home
  // indicator while it is down.
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // The preview frames the photo exactly as the feed will: the same measured
  // and clamped ratio, letterboxed the same way. Before ONE-55 this previewed at
  // 1:1 and published at 4:5, so the author approved a framing nobody else ever
  // saw. PostCard's 4:5 fallback is mirrored here for a photo with no
  // dimensions.
  const previewAspectRatio = mediaAspectRatio(attachment) ?? FALLBACK_ASPECT_RATIO;

  const postable = canPublish(content, Boolean(attachment), isPosting);

  const handlePost = async () => {
    if (!postable || !userProfile) return;
    setIsPosting(true);
    setUploadFailed(false);

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
      };

      await createPost.mutateAsync(newPost);
      setTimeout(() => router.back(), 400);
    } catch (error) {
      console.error('Failed to publish post', error);
      const photoFailed = error instanceof MediaUploadError;
      setUploadFailed(photoFailed);
      addToast(
        photoFailed
          ? 'Your photo could not be uploaded. Nothing was posted.'
          : 'Failed to create post.',
        'error',
      );
      // The draft stays on screen: router.back() only runs on the success
      // path above.
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

  return (
    // Top edge only. Padding the bottom here as well shortens the
    // KeyboardAvoidingView's frame while it still measures the keyboard
    // against the full screen, which is what buried the old footer. The
    // toolbar carries the bottom inset instead.
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Stack.Screen options={{ headerShown: false, presentation: 'modal' }} />

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
          New post
        </Text>
        <View style={[styles.headerSide, styles.headerRight]}>
          <Button size="sm" onPress={handlePost} disabled={!postable && !isPosting} loading={isPosting}>
            Post
          </Button>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        // The modal reaches the bottom of the screen and the root no longer
        // pads that edge, so the view's frame and the keyboard's are measured
        // against the same origin and no offset is needed.
        keyboardVerticalOffset={0}
        style={styles.fill}
      >
        <ScrollView
          style={styles.fill}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={styles.scroll}
        >
          {/* The whole writing area focuses the input, not just its first line. */}
          <Pressable
            onPress={() => inputRef.current?.focus()}
            accessible={false}
            style={styles.body}
          >
            <Avatar
              uri={userProfile?.profilePicture}
              name={userProfile?.name || userProfile?.username}
              size={40}
            />
            <TextInput
              ref={inputRef}
              multiline
              placeholder="What's happening?"
              placeholderTextColor={color.textMuted}
              selectionColor={color.text}
              value={content}
              onChangeText={setContent}
              style={styles.input}
              accessibilityLabel="Post text"
            />
          </Pressable>

          {attachment && (
            <View style={styles.media}>
              <ComposeMedia
                uri={attachment.uri}
                aspectRatio={previewAspectRatio}
                onRemove={() => setAttachment(null)}
                uploadFailed={uploadFailed}
              />
            </View>
          )}
        </ScrollView>

        {/* Pinned above the keyboard. A post carries at most one photo, so
            Photo is offered only while there is none. */}
        <View style={[styles.toolbar, { paddingBottom: keyboardUp ? space.sm : Math.max(insets.bottom, space.sm) }]}>
          <View style={styles.tools}>
            {!attachment && (
              <IconButton
                icon={<ImageIcon color={color.text} size={24} strokeWidth={1.8} />}
                accessibilityLabel="Add a photo"
                onPress={handleAttachMedia}
              />
            )}
          </View>
          {content.length > 0 && <CharacterRing length={content.length} />}
        </View>
      </KeyboardAvoidingView>
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
    minWidth: 72,
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
  scroll: {
    paddingBottom: space.lg,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.lg,
    minHeight: 160,
  },
  input: {
    flex: 1,
    // Grows with the text; the screen scrolls when it outgrows the space.
    minHeight: 40,
    paddingTop: space.sm,
    fontFamily: type.body,
    fontSize: 17,
    lineHeight: 24,
    color: color.text,
    textAlignVertical: 'top',
  },
  media: {
    paddingHorizontal: space.lg,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.xs,
    paddingLeft: space.sm,
    paddingRight: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.bg,
  },
  tools: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
});
