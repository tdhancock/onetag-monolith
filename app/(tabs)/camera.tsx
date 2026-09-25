import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, ActivityIndicator, Linking, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { BarcodeScanningResult } from 'expo-camera';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile } from '../../features/profiles';
import { useUploadStory } from '../../features/stories';
import { pickImageFromLibrary } from '../../services/mediaPicker';
import { Button, EmptyState, IconButton, MonoLabel, Pressable, Sheet, SheetRow } from '../../components/native/ui';
import { CameraIcon, FlipCameraIcon, GridIcon, ImageIcon, PlusCircleIcon, XIcon } from '../../components/native/Icons';
import { buildTagRoute } from '../../lib/tagLinks';
import { tagToOffer } from '../../lib/screens/cameraScan';
import { color, space, type, withAlpha } from '../../theme/tokens';

/** The shutter's outer ring and inner disc, in points. */
const SHUTTER_RING_SIZE = 72;
const SHUTTER_FILL_SIZE = 58;
/** How far the disc shrinks while the finger is down. */
const SHUTTER_PRESSED_SCALE = 0.9;
const CONTROL_ICON_SIZE = 24;
/** The scanning frame's side, and the length and weight of its corner marks. */
const SCAN_FRAME_SIZE = 220;
const SCAN_CORNER_SIZE = 28;
const SCAN_CORNER_WEIGHT = 3;

/** What the camera looks for: QR only — NFC is deferred (Working Agreement). */
const BARCODE_SETTINGS = { barcodeTypes: ['qr' as const] };

/** A photo waiting for the person to choose what it becomes. */
interface Captured {
  uri: string;
  width?: number | null;
  height?: number | null;
}

/**
 * The shutter: a white ring around a white disc that shrinks under the
 * finger. Round, like an avatar — a control drawn over full-bleed media, not
 * a surface of the square house style.
 */
const Shutter: React.FC<{ onPress: () => void; disabled: boolean }> = ({ onPress, disabled }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel="Take photo"
    accessibilityState={{ disabled }}
    style={[styles.shutterRing, disabled && styles.shutterBusy]}
  >
    {({ pressed }) => (
      <View style={[styles.shutterFill, pressed && { transform: [{ scale: SHUTTER_PRESSED_SCALE }] }]} />
    )}
  </Pressable>
);

/**
 * Tag detection over the live viewfinder (ONE-29).
 *
 * Scanning augments the camera rather than taking it over: a detected Tag is
 * *offered*, never opened, so a QR drifting into frame while someone frames a
 * photo changes nothing until they choose to act on it.
 *
 * `onBarcodeScanned` fires on every frame a code is visible. Refs, not state,
 * guard it — state lags a render behind, and several frames arrive inside
 * one. While an offer is showing, every read is ignored; after one is
 * dismissed, detection re-arms, so the same tag can be offered again. After
 * one is opened, the code stays ignored until the tab regains focus — the
 * person is on their way to it, and it is probably still in frame.
 */
const useTagDetection = (enabled: boolean) => {
  const [offered, setOffered] = useState<string | null>(null);
  const lastOffered = useRef<string | null>(null);
  const offering = useRef(false);

  const onBarcodeScanned = useCallback(({ data }: BarcodeScanningResult) => {
    if (offering.current) return;
    const shortCode = tagToOffer(data, lastOffered.current);
    if (!shortCode) return;
    lastOffered.current = shortCode;
    offering.current = true;
    setOffered(shortCode);
  }, []);

  const dismiss = useCallback(() => {
    offering.current = false;
    lastOffered.current = null;
    setOffered(null);
  }, []);

  const markOpened = useCallback(() => {
    offering.current = false;
    setOffered(null);
  }, []);

  // Back on the tab after opening a tag: re-arm, so it can be scanned again.
  useFocusEffect(
    useCallback(() => {
      if (!offering.current) lastOffered.current = null;
    }, []),
  );

  return {
    offered,
    // Detached entirely while an offer shows, or while a photo is being
    // shared; the ref guard covers frames already on their way.
    onBarcodeScanned: enabled && offered === null ? onBarcodeScanned : undefined,
    dismiss,
    markOpened,
  };
};

/** The viewfinder's scanning affordance: four corner marks and a hint. Never touchable. */
const ScanFrame: React.FC = () => (
  <View style={[StyleSheet.absoluteFill, styles.centred]} pointerEvents="none">
    <View style={styles.scanFrame}>
      <View style={[styles.scanCorner, styles.scanCornerTopLeft]} />
      <View style={[styles.scanCorner, styles.scanCornerTopRight]} />
      <View style={[styles.scanCorner, styles.scanCornerBottomLeft]} />
      <View style={[styles.scanCorner, styles.scanCornerBottomRight]} />
    </View>
    <MonoLabel color="inverse" style={styles.scanHint}>
      Point at a tag to scan
    </MonoLabel>
  </View>
);

/** A detected Tag, offered: its short code, Open, and a way to dismiss it. */
const TagOffer: React.FC<{ shortCode: string; onOpen: () => void; onDismiss: () => void }> = ({
  shortCode,
  onOpen,
  onDismiss,
}) => (
  <SafeAreaView edges={['top']} style={styles.tagOfferArea} pointerEvents="box-none">
    <View style={styles.tagOffer} accessibilityLiveRegion="polite">
      <View style={styles.tagOfferText}>
        <MonoLabel color="textMuted">Tag detected</MonoLabel>
        <Text style={styles.tagOfferCode}>{shortCode}</Text>
      </View>
      <Button size="sm" onPress={onOpen}>
        Open
      </Button>
      <IconButton
        icon={<XIcon color={color.text} size={20} />}
        accessibilityLabel="Dismiss tag"
        onPress={onDismiss}
      />
    </View>
  </SafeAreaView>
);

export default function CameraScreen() {
  const router = useRouter();
  const { addToast, triggerHapticFeedback } = useApp();
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
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [capturing, setCapturing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [captured, setCaptured] = useState<Captured | null>(null);
  const detection = useTagDetection(captured === null && !uploading);
  const { offered, markOpened } = detection;

  useEffect(() => {
    if (offered) triggerHapticFeedback('light');
  }, [offered, triggerHapticFeedback]);

  const openTag = useCallback(() => {
    if (!offered) return;
    markOpened();
    // Pushed, so Back returns here; the resolution route then replaces
    // itself with the Destination.
    router.push(buildTagRoute(offered));
  }, [offered, markOpened, router]);

  const toggleFacing = useCallback(() => {
    triggerHapticFeedback('light');
    setFacing(prev => (prev === 'back' ? 'front' : 'back'));
  }, [triggerHapticFeedback]);

  const handleUploadStory = useCallback(async (uri: string) => {
    if (!profileId || uploading) return;

    setUploading(true);
    addToast('Uploading OneSnap…', 'info');

    try {
      await uploadStory.mutateAsync({ imageUri: uri, caption: null });
    } catch (error) {
      console.error('OneSnap upload failed', error);
      addToast('Failed to upload OneSnap.', 'error');
    } finally {
      setUploading(false);
      // Small delay so toast is visible
      setTimeout(() => router.navigate('/(tabs)'), 1000);
    }
  }, [profileId, uploading, uploadStory, addToast, router]);

  const takePhoto = useCallback(async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    triggerHapticFeedback('medium');

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) {
        setCaptured({ uri: photo.uri, width: photo.width, height: photo.height });
      }
    } catch (error) {
      console.error('Failed to take photo', error);
      addToast('Failed to capture photo.', 'error');
    } finally {
      setCapturing(false);
    }
  }, [capturing, triggerHapticFeedback, addToast]);

  const pickFromGallery = useCallback(async () => {
    const result = await pickImageFromLibrary();

    if (result.status === 'selected') {
      const { uri, width, height } = result.media;
      setCaptured({ uri, width, height });
    }
  }, []);

  // The two choices the old "Share as" Alert offered, unchanged.
  const shareAsOneSnap = () => {
    if (!captured) return;
    setCaptured(null);
    void handleUploadStory(captured.uri);
  };

  const shareAsPost = () => {
    if (!captured) return;
    setCaptured(null);
    router.push({
      pathname: '/compose',
      // Dimensions travel with the URI so the composer can measure the
      // aspect ratio at the source rather than from a rendered view — see
      // ONE-55.
      params: {
        mediaUri: captured.uri,
        mediaType: 'image',
        mediaWidth: String(captured.width ?? ''),
        mediaHeight: String(captured.height ?? ''),
      },
    });
  };

  const shareSheet = (
    <Sheet visible={captured !== null} onClose={() => setCaptured(null)} title="Share as">
      <SheetRow
        label="Share as OneSnap"
        hint="Disappears after 24 hours"
        icon={<PlusCircleIcon color={color.text} size={24} />}
        onPress={shareAsOneSnap}
      />
      <SheetRow
        label="Share as post"
        hint="Add a caption and post it to your profile"
        icon={<GridIcon color={color.text} size={24} />}
        onPress={shareAsPost}
      />
    </Sheet>
  );

  // Permission not determined yet
  if (!permission) {
    return (
      <View style={[styles.lightScreen, styles.centred]}>
        <ActivityIndicator color={color.textMuted} accessibilityLabel="Loading camera" />
      </View>
    );
  }

  // Permission not granted: ask, or send to Settings once the system will
  // no longer show the prompt.
  if (!permission.granted) {
    const canAsk = permission.canAskAgain;
    return (
      <SafeAreaView style={[styles.lightScreen, styles.centred]}>
        <EmptyState
          icon={<CameraIcon color={color.text} size={48} strokeWidth={1.5} />}
          title="Allow camera access"
          body="OneTag uses the camera for photos and OneSnaps"
          action={
            canAsk
              ? { label: 'Allow access', onPress: () => void requestPermission() }
              : { label: 'Open settings', onPress: () => void Linking.openSettings() }
          }
        />
        <Button variant="outline" onPress={pickFromGallery}>
          Choose from library
        </Button>
        {shareSheet}
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.viewfinder}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        barcodeScannerSettings={BARCODE_SETTINGS}
        onBarcodeScanned={detection.onBarcodeScanned}
      />

      {/* The photo being decided on, held under the sheet. */}
      {captured ? (
        <Image source={{ uri: captured.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <ScanFrame />
      )}

      {offered ? <TagOffer shortCode={offered} onOpen={openTag} onDismiss={detection.dismiss} /> : null}

      <SafeAreaView edges={['bottom']} style={styles.controls}>
        <View style={styles.controlRow}>
          <IconButton
            icon={<ImageIcon color={color.inverse} size={CONTROL_ICON_SIZE} />}
            accessibilityLabel="Choose from library"
            onPress={pickFromGallery}
            style={styles.overlayControl}
          />
          <Shutter onPress={takePhoto} disabled={capturing} />
          <IconButton
            icon={<FlipCameraIcon color={color.inverse} size={CONTROL_ICON_SIZE} />}
            accessibilityLabel="Flip camera"
            onPress={toggleFacing}
            style={styles.overlayControl}
          />
        </View>
      </SafeAreaView>

      {uploading ? (
        <View style={[StyleSheet.absoluteFill, styles.centred]} pointerEvents="none">
          <View style={styles.uploadPanel} accessibilityLiveRegion="polite">
            <ActivityIndicator color={color.inverse} />
            <Text style={styles.uploadLabel}>Uploading OneSnap…</Text>
          </View>
        </View>
      ) : null}

      {shareSheet}
    </View>
  );
}

const styles = StyleSheet.create({
  lightScreen: {
    flex: 1,
    backgroundColor: color.bg,
  },
  centred: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Full-bleed content stays black; the black is the ink token.
  viewfinder: {
    flex: 1,
    backgroundColor: color.text,
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.xl,
  },
  overlayControl: {
    backgroundColor: withAlpha(color.text, 0.4),
  },
  shutterRing: {
    width: SHUTTER_RING_SIZE,
    height: SHUTTER_RING_SIZE,
    borderRadius: SHUTTER_RING_SIZE / 2,
    borderWidth: 3,
    borderColor: color.inverse,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterBusy: {
    opacity: 0.5,
  },
  shutterFill: {
    width: SHUTTER_FILL_SIZE,
    height: SHUTTER_FILL_SIZE,
    borderRadius: SHUTTER_FILL_SIZE / 2,
    backgroundColor: color.inverse,
  },
  uploadPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: color.text,
  },
  uploadLabel: {
    fontFamily: type.bodyMedium,
    fontSize: 15,
    color: color.inverse,
  },
  scanFrame: {
    width: SCAN_FRAME_SIZE,
    height: SCAN_FRAME_SIZE,
  },
  scanCorner: {
    position: 'absolute',
    width: SCAN_CORNER_SIZE,
    height: SCAN_CORNER_SIZE,
    borderColor: color.inverse,
  },
  scanCornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: SCAN_CORNER_WEIGHT,
    borderLeftWidth: SCAN_CORNER_WEIGHT,
  },
  scanCornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: SCAN_CORNER_WEIGHT,
    borderRightWidth: SCAN_CORNER_WEIGHT,
  },
  scanCornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: SCAN_CORNER_WEIGHT,
    borderLeftWidth: SCAN_CORNER_WEIGHT,
  },
  scanCornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: SCAN_CORNER_WEIGHT,
    borderRightWidth: SCAN_CORNER_WEIGHT,
  },
  scanHint: {
    marginTop: space.lg,
  },
  // Over the top of the viewfinder, clear of the shutter: an offer never
  // stands between the person and a photo.
  tagOfferArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  tagOffer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.sm,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    paddingVertical: space.sm,
    backgroundColor: color.bg,
  },
  tagOfferText: {
    flex: 1,
  },
  tagOfferCode: {
    marginTop: space.xs,
    fontFamily: type.mono,
    fontSize: 15,
    color: color.text,
  },
});
