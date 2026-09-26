import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { Image } from 'expo-image';
import type { ImageLoadEventData } from 'expo-image';
import { router } from 'expo-router';
import { Button, MonoLabel, Pressable, Sheet } from './ui';
import TaggedBadge from './TaggedBadge';
import { useRecordScan } from '../../features/tags';
import { useCurrentProfile } from '../../features/profiles';
import {
  containRect,
  destinationTypeLabel,
  pointForPct,
  tagAccessibilityLabel,
  TAG_HIT_SIZE,
  TAG_MARKER_SIZE,
  type Rect,
} from '../../lib/screens/embeddedTags';
import { routeForDestination } from '../../lib/screens/tagResolution';
import { color, space, type } from '../../theme/tokens';
import type { EmbeddedTag } from '../../types';

// Embedded Tags on a post's image (ONE-45): a marker at each tag's stored
// position, a count badge, and a card when a tag is tapped. The composer's
// preview (ONE-46) renders this same component with `interactive` off.

export interface EmbeddedTagsProps {
  tags: EmbeddedTag[];
  /**
   * Where the picture is drawn inside its view — see `containRect`. Null
   * while the image is loading or unmeasured, and then no marker is drawn:
   * markers floating over a placeholder look broken.
   */
  contentRect: Rect | null;
  /** Off for the composer's preview: markers show, taps do nothing and record nothing. */
  interactive?: boolean;
}

/**
 * The markers, absolutely filling the media view they sit in. Renders the
 * count badge as soon as there are tags, and the markers only once the
 * picture's rect is known.
 */
const EmbeddedTags: React.FC<EmbeddedTagsProps> = ({ tags, contentRect, interactive = true }) => {
  const { profileId } = useCurrentProfile();
  const recordScan = useRecordScan();
  const [open, setOpen] = useState<EmbeddedTag | null>(null);

  const handleTap = useCallback(
    (tag: EmbeddedTag) => {
      // A tap is a Scan (ONE-44) — recorded on the tap, never on render, and
      // fire and forget: the card opens whether or not the write lands.
      recordScan.mutate({ tagId: tag.id, scannerProfileId: profileId ?? null });
      setOpen(tag);
    },
    [recordScan, profileId],
  );

  const handleView = useCallback(() => {
    if (!open) return;
    const route = routeForDestination(open.destination);
    setOpen(null);
    if (route) router.push(route as never);
  }, [open]);

  if (tags.length === 0) return null;

  return (
    <>
      {contentRect &&
        tags.map((tag) => {
          const point = pointForPct(contentRect, tag.xPct, tag.yPct);
          return (
            <Pressable
              key={tag.id}
              testID={`embedded-tag-${tag.id}`}
              onPress={interactive ? () => handleTap(tag) : undefined}
              disabled={!interactive}
              accessibilityRole="button"
              accessibilityLabel={tagAccessibilityLabel(tag.destination)}
              // The hit area is centred on the point; the marker inside it is
              // small. Adjacent hit areas overlap, and the later tag wins
              // where they do — each marker's own centre stays its own.
              style={[
                styles.hit,
                { left: point.x - TAG_HIT_SIZE / 2, top: point.y - TAG_HIT_SIZE / 2 },
              ]}
              hitSlop={0}
            >
              <View style={styles.marker} />
            </Pressable>
          );
        })}

      <TaggedBadge count={tags.length} />

      {interactive && (
        <Sheet visible={open !== null} onClose={() => setOpen(null)}>
          {open && (
            <View style={styles.card}>
              {open.destination.imageUrl ? (
                <Image source={{ uri: open.destination.imageUrl }} style={styles.cardImage} contentFit="cover" />
              ) : (
                <View style={[styles.cardImage, styles.cardImageEmpty]} />
              )}
              <View style={styles.cardBody}>
                <MonoLabel color="textMuted">{destinationTypeLabel(open.destination)}</MonoLabel>
                <Text style={styles.cardName} numberOfLines={2}>
                  {open.destination.name}
                </Text>
              </View>
              <Button
                size="sm"
                onPress={handleView}
                accessibilityLabel={`View ${open.destination.name}`}
              >
                View
              </Button>
            </View>
          )}
        </Sheet>
      )}
    </>
  );
};

/**
 * Measures where a `contentFit="contain"` image is drawn inside its view:
 * spread `onLayout` on the view and `onLoad` on the Image, and read
 * `contentRect`. It stays null until the picture has loaded, which is what
 * keeps tags hidden while it loads. The composer (ONE-46) places tags
 * through the same measurement viewers read them with.
 */
export const useImageContentRect = () => {
  const [container, setContainer] = useState<{ width: number; height: number } | null>(null);
  const [intrinsic, setIntrinsic] = useState<{ width: number; height: number } | null>(null);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContainer((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  const onLoad = useCallback((event: ImageLoadEventData) => {
    const { width, height } = event.source;
    setIntrinsic((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  return { contentRect: containRect(container, intrinsic), onLayout, onLoad };
};

const styles = StyleSheet.create({
  hit: {
    position: 'absolute',
    width: TAG_HIT_SIZE,
    height: TAG_HIT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    width: TAG_MARKER_SIZE,
    height: TAG_MARKER_SIZE,
    backgroundColor: color.text,
    borderWidth: 2,
    borderColor: color.inverse,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  cardImage: {
    width: 56,
    height: 56,
    backgroundColor: color.bgPanel,
  },
  cardImageEmpty: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
  },
  cardBody: {
    flex: 1,
    gap: space.xs,
  },
  cardName: {
    fontFamily: type.bodyMedium,
    fontSize: 16,
    color: color.text,
  },
});

export default EmbeddedTags;
