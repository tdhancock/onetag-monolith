import React, { useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../../store/AppContext.native';
import { useCurrentProfile } from '../../../features/profiles';
import { useMyTagQuery } from '../../../features/tags';
import { Button, EmptyState, MonoLabel } from '../../../components/native/ui';
import TagQRCode from '../../../components/native/TagQRCode';
import {
  copyTagLink,
  qrPngBase64,
  saveTagQrToPhotos,
  shareTagQrImage,
  type QrSvgHandle,
} from '../../../services/tagSharing';
import { buildTagUrl } from '../../../lib/tagLinks';
import { destinationLabel, PHOTOS_DENIED_MESSAGE, TAGS_DASHBOARD_ROUTE, tagTitle } from '../../../lib/screens/tags';
import { color, space, type } from '../../../theme/tokens';

/** The preview's largest width, however wide the screen. */
const MAX_PREVIEW = 320;

/**
 * Export a tag's QR code (ONE-33): the code large, with the tag's name and
 * destination, and the ways to get it off the phone — saved to Photos, shared
 * as an image, or the link copied.
 *
 * The image is drawn from the vector at print resolution, independent of the
 * preview's size on screen: a code captured at screen size prints blurry, and
 * a printed code that won't scan is found out only after the stickers are
 * paid for.
 */
export default function ExportTagScreen() {
  const router = useRouter();
  const { addToast } = useApp();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const tagId = typeof params.id === 'string' ? params.id : '';
  const { profileId } = useCurrentProfile();
  const { data: tag, isPending, isError, refetch } = useMyTagQuery(profileId, tagId);

  const svg = useRef<QrSvgHandle | null>(null);
  const [busy, setBusy] = useState<'save' | 'share' | null>(null);
  const [photosDenied, setPhotosDenied] = useState(false);

  const header = <Stack.Screen options={{ headerShown: true, title: 'Export QR code' }} />;

  if (isPending) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <ActivityIndicator style={styles.loading} color={color.textMuted} accessibilityLabel="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !tag) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <EmptyState
          title={isError ? "Couldn't load this tag" : 'Tag not found'}
          body={isError ? 'Check your connection and try again.' : "This profile doesn't own a tag with that id."}
          action={
            isError
              ? { label: 'Try again', onPress: () => void refetch() }
              : { label: 'Your tags', onPress: () => router.replace(TAGS_DASHBOARD_ROUTE) }
          }
        />
      </SafeAreaView>
    );
  }

  const exportPng = async (): Promise<string> => {
    if (!svg.current) throw new Error('The QR code has not rendered yet.');
    return qrPngBase64(svg.current);
  };

  const handleSave = async () => {
    setBusy('save');
    try {
      // Permission is asked for here, on the tap, never on mount.
      const result = await saveTagQrToPhotos(await exportPng(), tag.shortCode);
      setPhotosDenied(result === 'denied');
      if (result === 'saved') addToast('Saved to Photos.', 'success');
    } catch {
      addToast("Couldn't save the QR code. Try again, or use Share.", 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleShare = async () => {
    setBusy('share');
    try {
      await shareTagQrImage(await exportPng(), tag.shortCode);
    } catch {
      addToast("Couldn't share the QR code.", 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = () =>
    copyTagLink(tag.shortCode).then(
      () => addToast('Link copied.', 'success'),
      () => addToast("Couldn't copy the link.", 'error'),
    );

  const url = buildTagUrl(tag.shortCode);
  const previewSize = Math.min(width - space.xl * 2, MAX_PREVIEW);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      {header}
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          {tagTitle(tag)}
        </Text>
        <Text style={styles.destination}>{destinationLabel(tag.destination)}</Text>
        {tag.active ? null : (
          <MonoLabel color="text" style={styles.inactive}>
            Inactive: scanning this shows it is no longer active
          </MonoLabel>
        )}

        <View style={styles.qr}>
          <TagQRCode
            shortCode={tag.shortCode}
            size={previewSize}
            getRef={(ref) => {
              svg.current = ref as QrSvgHandle | null;
            }}
          />
        </View>

        <View style={styles.actions}>
          <Button fullWidth onPress={handleSave} loading={busy === 'save'} disabled={busy !== null}>
            Save to Photos
          </Button>
          <Button fullWidth variant="outline" onPress={handleShare} loading={busy === 'share'} disabled={busy !== null}>
            Share
          </Button>
        </View>

        {photosDenied ? (
          <View style={styles.notice} accessibilityLiveRegion="polite">
            <Text style={styles.noticeText}>{PHOTOS_DENIED_MESSAGE}</Text>
            <Button size="sm" variant="outline" onPress={() => void Linking.openSettings()} style={styles.noticeAction}>
              Open Settings
            </Button>
          </View>
        ) : null}

        <MonoLabel color="textMuted" style={styles.linkLabel}>
          Tag link
        </MonoLabel>
        <Text style={styles.link} selectable accessibilityLabel={`Tag link, ${url}`}>
          {url}
        </Text>
        <Button variant="outline" onPress={handleCopy} style={styles.copy}>
          Copy link
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
  },
  loading: {
    marginTop: space.xxl,
  },
  content: {
    padding: space.xl,
    paddingBottom: space.xxl,
  },
  title: {
    fontFamily: type.bodyBold,
    fontSize: 22,
    lineHeight: 28,
    color: color.text,
  },
  destination: {
    marginTop: space.xs,
    fontFamily: type.body,
    fontSize: 14,
    color: color.textMid,
  },
  inactive: {
    marginTop: space.sm,
  },
  qr: {
    marginTop: space.xl,
    alignItems: 'center',
  },
  actions: {
    marginTop: space.xl,
    gap: space.md,
  },
  notice: {
    marginTop: space.lg,
    padding: space.md,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.bgSub,
  },
  noticeText: {
    fontFamily: type.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.text,
  },
  noticeAction: {
    marginTop: space.md,
    alignSelf: 'flex-start',
  },
  linkLabel: {
    marginTop: space.xl,
  },
  link: {
    marginTop: space.sm,
    padding: space.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.bgSub,
    fontFamily: type.mono,
    fontSize: 14,
    color: color.text,
  },
  copy: {
    marginTop: space.md,
  },
});
