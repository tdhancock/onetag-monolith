import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '../store/AppContext.native';
import { useCurrentProfile } from '../features/profiles';
import { cleanHtml } from '../lib/cleanHtml';
import { useUploadStory } from '../features/stories';
import { Button, IconButton, ListRow, TextField } from '../components/native/ui';
import {
  CameraIcon,
  FlipCameraIcon,
  ImageIcon,
  TypeIcon,
  XIcon,
  ArrowLeftIcon,
} from '../components/native/Icons';
import {
  color,
  oneSnapGradientKeys,
  oneSnapGradients,
  radius,
  space,
  type,
  withAlpha,
  type OneSnapGradientKey,
} from '../theme/tokens';

type ViewState = 'options' | 'camera' | 'preview-image' | 'preview-text';

// Capture and preview stay full-bleed dark for the content's sake: the black
// is the ink token and the controls over it are inverse.
const MEDIA_GROUND = color.text;
const CONTROL_FILL = withAlpha(color.text, 0.4);
const TEXT_PLACEHOLDER = withAlpha(color.inverse, 0.5);

/** The square tile an option row leads with. */
const OptionIcon: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <View style={styles.optionIcon}>{children}</View>
);

export default function StoryCreateScreen() {
  const router = useRouter();
  const {
    addToast,
    triggerHapticFeedback,
  } = useApp();
  const { profile: userProfile, profileId } = useCurrentProfile();
  // The optimistic entry, its replacement by the server copy and its removal
  // on failure all happen inside the mutation (ONE-19).
  const uploadStory = useUploadStory(
    profileId
      ? { id: profileId, username: userProfile.username, avatar: userProfile.profilePicture || null }
      : undefined,
  );
  const cameraRef = useRef<CameraView>(null);

  const [permission, requestPermission] = useCameraPermissions();
  const [view, setView] = useState<ViewState>('options');
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [capturing, setCapturing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Image story
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [caption, setCaption] = useState('');

  // Text story
  const [textContent, setTextContent] = useState('');
  // Stored with the OneSnap as `background`, so readers see what was picked.
  const [gradientKey, setGradientKey] = useState<OneSnapGradientKey>(oneSnapGradientKeys[0]);

  const handleUpload = useCallback(
    async (options: { imageUri?: string; text?: string; background?: OneSnapGradientKey }) => {
      if (!profileId) return;
      setIsUploading(true);

      addToast('Uploading OneSnap…', 'info');

      try {
        if (options.imageUri) {
          await uploadStory.mutateAsync({
            imageUri: options.imageUri,
            caption: caption.trim() || null,
          });
        } else if (options.text) {
          // Text-only story: no media, just the words and their gradient.
          await uploadStory.mutateAsync({ caption: options.text, background: options.background });
        }
      } catch (error) {
        console.error('Story upload failed', error);
        addToast('Failed to upload OneSnap.', 'error');
      } finally {
        setIsUploading(false);
        // Brief delay so success/error toast is visible before navigating away
        setTimeout(() => router.back(), 1200);
      }
    },
    [profileId, uploadStory, addToast, caption, router],
  );

  const takePhoto = useCallback(async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    triggerHapticFeedback('medium');

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) {
        setImageSrc(photo.uri);
        setView('preview-image');
      }
    } catch (error) {
      console.error('Failed to take photo', error);
      addToast('Failed to capture photo.', 'error');
    } finally {
      setCapturing(false);
    }
  }, [capturing, triggerHapticFeedback, addToast]);

  const pickFromGallery = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      allowsEditing: true,
      aspect: [9, 16],
    });

    if (!result.canceled && result.assets[0]?.uri) {
      setImageSrc(result.assets[0].uri);
      setView('preview-image');
    }
  }, []);

  const openCamera = useCallback(async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          'Camera Required',
          'Please enable camera access in your device settings.',
        );
        return;
      }
    }
    setView('camera');
  }, [permission, requestPermission]);

  // ─── Options View ──────────────────────────────
  if (view === 'options') {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: color.bg }]}>
        <Stack.Screen options={{ headerShown: false, presentation: 'modal' }} />
        <StatusBar style="dark" />

        <View style={styles.optionsHeader}>
          <Text style={styles.optionsTitle} accessibilityRole="header">New OneSnap</Text>
          <IconButton
            icon={<XIcon color={color.text} size={22} />}
            accessibilityLabel="Close"
            onPress={() => router.back()}
          />
        </View>

        <View style={styles.options}>
          <ListRow
            title="Camera"
            subtitle="Take a photo now"
            leading={<OptionIcon><CameraIcon color={color.text} size={22} /></OptionIcon>}
            onPress={openCamera}
            accessibilityLabel="Camera, take a photo now"
            divider
          />
          <ListRow
            title="Library"
            subtitle="Choose a photo you already have"
            leading={<OptionIcon><ImageIcon color={color.text} size={22} /></OptionIcon>}
            onPress={pickFromGallery}
            accessibilityLabel="Library, choose a photo you already have"
            divider
          />
          <ListRow
            title="Text"
            subtitle="Write something on a colour"
            leading={<OptionIcon><TypeIcon color={color.text} size={22} /></OptionIcon>}
            onPress={() => setView('preview-text')}
            accessibilityLabel="Text, write something on a colour"
          />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Camera View ──────────────────────────────
  if (view === 'camera') {
    return (
      <View style={[styles.fill, { backgroundColor: MEDIA_GROUND }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar style="light" />

        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} />

        {/* Top */}
        <SafeAreaView edges={['top']} style={styles.cameraTop}>
          <View style={styles.cameraTopRow}>
            <IconButton
              icon={<XIcon color={color.inverse} size={24} />}
              accessibilityLabel="Back to options"
              onPress={() => setView('options')}
              style={styles.cameraControl}
            />
            <IconButton
              icon={<FlipCameraIcon color={color.inverse} size={24} />}
              accessibilityLabel="Flip camera"
              onPress={() => {
                triggerHapticFeedback('light');
                setFacing(prev => (prev === 'back' ? 'front' : 'back'));
              }}
              style={styles.cameraControl}
            />
          </View>
        </SafeAreaView>

        {/* Bottom */}
        <SafeAreaView edges={['bottom']} style={styles.cameraBottom}>
          <View style={styles.cameraBottomRow}>
            <IconButton
              icon={<ImageIcon color={color.inverse} size={26} />}
              accessibilityLabel="Choose from library"
              onPress={pickFromGallery}
              style={styles.cameraControl}
            />
            <Pressable
              onPress={takePhoto}
              disabled={capturing}
              accessibilityRole="button"
              accessibilityLabel="Take photo"
              style={[styles.shutter, capturing && styles.shutterBusy]}
            >
              <View style={styles.shutterFace} />
            </Pressable>
            {/* Balances the row so the shutter stays centred. */}
            <View style={styles.cameraControlSpacer} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ─── Image Preview ─────────────────────────────
  if (view === 'preview-image' && imageSrc) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: MEDIA_GROUND }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar style="light" />

        <View style={styles.previewHeader}>
          <IconButton
            icon={<ArrowLeftIcon color={color.inverse} size={24} />}
            accessibilityLabel="Back"
            onPress={() => {
              setImageSrc(null);
              setCaption('');
              setView('options');
            }}
          />
        </View>

        <View style={styles.previewFrame}>
          <Image source={{ uri: imageSrc }} style={styles.fill} contentFit="cover" />
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.previewFooter}>
            <TextField
              variant="overlay"
              value={caption}
              onChangeText={setCaption}
              placeholder="Add a caption…"
              multiline
              maxLength={200}
            />
            <Button
              variant="inverse"
              fullWidth
              disabled={isUploading}
              onPress={() => handleUpload({ imageUri: imageSrc })}
              style={styles.shareButton}
            >
              {isUploading ? 'Sharing…' : 'Share OneSnap'}
            </Button>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ─── Text Story Preview ────────────────────────
  if (view === 'preview-text') {
    const currentGradient = oneSnapGradients[gradientKey];
    const canShare = !isUploading && Boolean(textContent.trim());

    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: MEDIA_GROUND }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar style="light" />

        <View style={styles.previewHeader}>
          <IconButton
            icon={<ArrowLeftIcon color={color.inverse} size={24} />}
            accessibilityLabel="Back"
            onPress={() => setView('options')}
          />
        </View>

        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.previewFrame}>
            <LinearGradient colors={[...currentGradient]} style={styles.textCanvas}>
              <TextInput
                value={textContent}
                onChangeText={setTextContent}
                placeholder="Say something…"
                placeholderTextColor={TEXT_PLACEHOLDER}
                selectionColor={color.inverse}
                style={styles.textCanvasInput}
                multiline
                maxLength={300}
                autoFocus
              />
            </LinearGradient>
          </View>

          {/* Gradient picker */}
          <View style={styles.swatches}>
            {oneSnapGradientKeys.map((key, i) => (
              <Pressable
                key={key}
                onPress={() => {
                  triggerHapticFeedback('light');
                  setGradientKey(key);
                }}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Background ${i + 1}`}
                accessibilityState={{ selected: key === gradientKey }}
                style={[styles.swatch, key === gradientKey && styles.swatchSelected]}
              >
                <LinearGradient colors={[...oneSnapGradients[key]]} style={styles.fill} />
              </Pressable>
            ))}
          </View>

          <View style={styles.previewFooter}>
            <Button
              variant="inverse"
              fullWidth
              disabled={!canShare}
              onPress={() => {
                if (!textContent.trim()) {
                  addToast('Write something first!', 'error');
                  return;
                }
                handleUpload({ text: cleanHtml(textContent.trim()), background: gradientKey });
              }}
            >
              {isUploading ? 'Sharing…' : 'Share OneSnap'}
            </Button>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // Fallback
  return null;
}

/** The shutter's outer ring. Round, as a camera shutter reads. */
const SHUTTER_SIZE = 76;

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },

  // Options
  optionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingLeft: space.lg,
    paddingRight: space.xs,
  },
  optionsTitle: {
    fontFamily: type.bodyBold,
    fontSize: 17,
    color: color.text,
  },
  options: {
    marginTop: space.sm,
  },
  optionIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.bgPanel,
    borderRadius: radius.none,
  },

  // Camera
  cameraTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  cameraTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  cameraBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  cameraBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: space.lg,
    paddingBottom: space.xl,
  },
  cameraControl: {
    backgroundColor: CONTROL_FILL,
  },
  cameraControlSpacer: {
    width: 44,
  },
  shutter: {
    width: SHUTTER_SIZE,
    height: SHUTTER_SIZE,
    borderRadius: SHUTTER_SIZE / 2,
    borderWidth: 4,
    borderColor: color.inverse,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterBusy: {
    opacity: 0.5,
  },
  shutterFace: {
    width: SHUTTER_SIZE - 16,
    height: SHUTTER_SIZE - 16,
    borderRadius: (SHUTTER_SIZE - 16) / 2,
    backgroundColor: color.inverse,
  },

  // Previews
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xs,
    minHeight: 52,
  },
  previewFrame: {
    flex: 1,
    marginHorizontal: space.lg,
    overflow: 'hidden',
    borderRadius: radius.none,
  },
  previewFooter: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  shareButton: {
    marginTop: space.md,
  },
  textCanvas: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
  },
  textCanvasInput: {
    alignSelf: 'stretch',
    fontFamily: type.bodyBold,
    fontSize: 24,
    lineHeight: 36,
    color: color.inverse,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  swatches: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.md,
    paddingTop: space.lg,
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: radius.none,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  swatchSelected: {
    borderColor: color.inverse,
  },
});
