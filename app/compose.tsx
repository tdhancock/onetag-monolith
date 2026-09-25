import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Alert,
  StyleSheet,
} from 'react-native';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { Avatar, Button, IconButton, ICON_BUTTON_SIZE, MonoLabel } from '../components/native/ui';
import ComposeMedia from '../components/native/ComposeMedia';
import CharacterRing from '../components/native/CharacterRing';
import KeyboardAvoider from '../components/native/KeyboardAvoider';
import { ImageIcon } from '../components/native/Icons';
import { canPublish } from '../lib/screens/compose';
import { postingAsLabel, profileKindLabel } from '../lib/screens/profile';
import { color, space, type } from '../theme/tokens';
import type { Post } from '../types';

/** What PostCard renders when a post carries no ratio. Kept in step with it. */
const FALLBACK_ASPECT_RATIO = 1080 / 1350;

/** Where the text starts: the page edge, the 40pt avatar, and the gap after it. */
const TEXT_INSET = space.lg + 40 + space.md;

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

  const [content, setContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
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
      // The spinner stays up until the screen has gone. Clearing it here left
      // Post live, over the same draft, for the moment before closing, and a
      // second tap published the post twice.
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
    // The modal's presentation is declared once, in app/_layout.tsx.
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
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

      <KeyboardAvoider style={styles.fill}>
        <ScrollView
          style={styles.fill}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={styles.scroll}
        >
          {/* Which profile this will publish as, before it does (ONE-25). An
              account can hold two, and the moment of posting is when it
              matters. Only once there is a real profile to name: before
              then `userProfile` is the display placeholder. */}
          {profileId ? (
            <View style={styles.postingAs} accessible accessibilityLabel={postingAsLabel(userProfile)}>
              <MonoLabel>Posting as</MonoLabel>
              <Text style={styles.postingAsHandle} numberOfLines={1}>
                @{userProfile.username}
              </Text>
              <MonoLabel color="textMid">{profileKindLabel(userProfile.profileType)}</MonoLabel>
            </View>
          ) : null}

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

          {/* Directly under the draft, so it stays in view above the keyboard
              rather than pinned to the bottom edge beneath it. A post carries
              at most one photo, so Photo is offered only while there is none. */}
          <View style={styles.tools}>
            {!attachment && (
              <IconButton
                icon={<ImageIcon color={color.text} size={24} strokeWidth={1.8} />}
                accessibilityLabel="Add a photo"
                onPress={handleAttachMedia}
              />
            )}
            <View style={styles.fill} />
            {content.length > 0 && <CharacterRing length={content.length} />}
          </View>

          {/* The rest of the page still means "write here". */}
          <Pressable onPress={() => inputRef.current?.focus()} accessible={false} style={styles.fill} />
        </ScrollView>
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
    flexGrow: 1,
  },
  postingAs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  postingAsHandle: {
    flexShrink: 1,
    fontFamily: type.bodyBold,
    fontSize: 13,
    color: color.text,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.lg,
    paddingBottom: space.sm,
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
    paddingBottom: space.sm,
  },
  tools: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: ICON_BUTTON_SIZE,
    // Lines the photo glyph up with the text beside the avatar: the IconButton
    // centres its 24pt glyph in a 44pt box.
    paddingLeft: TEXT_INSET - (ICON_BUTTON_SIZE - 24) / 2,
    paddingRight: space.lg,
  },
});
