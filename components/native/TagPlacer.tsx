import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { Image } from 'expo-image';
import { IconButton, MonoLabel, Pressable } from './ui';
import { XIcon } from './Icons';
import { useImageContentRect } from './EmbeddedTags';
import { pctForPoint, pointForPct, TAG_HIT_SIZE, TAG_MARKER_SIZE, type Rect } from '../../lib/screens/embeddedTags';
import { tagCountLabel, type DraftTag } from '../../lib/screens/composeTags';
import { destinationTypeLabel } from '../../lib/screens/embeddedTags';
import { color, space, type } from '../../theme/tokens';

// Placing Embedded Tags on the composer's photo (ONE-46). Tap the photo to
// place a tag, drag one to move it, remove one from the list beneath. Every
// position is read against the picture's content rect — the same measurement
// viewers' tags are drawn against (ONE-45) — so what the author sees here is
// what everyone sees.

export interface TagPlacerProps {
  uri: string;
  /** The width-to-height ratio the feed frames the photo at. */
  aspectRatio: number;
  tags: DraftTag[];
  /** A tap on the photo, in percent of its content. */
  onPlace: (xPct: number, yPct: number) => void;
  onMove: (key: string, xPct: number, yPct: number) => void;
  onRemove: (key: string) => void;
  /** Reopen the picker for a placed tag. */
  onChoose: (key: string) => void;
}

/** The instruction over the photo while it is empty of tags. */
export const TAG_PLACER_HINT = 'TAP THE PHOTO TO TAG';

const TagPlacer: React.FC<TagPlacerProps> = ({ uri, aspectRatio, tags, onPlace, onMove, onRemove, onChoose }) => {
  const { contentRect, onLayout, onLoad } = useImageContentRect();

  const handleTap = (event: GestureResponderEvent) => {
    if (!contentRect) return;
    const { locationX, locationY } = event.nativeEvent;
    const { xPct, yPct } = pctForPoint(contentRect, locationX, locationY);
    onPlace(xPct, yPct);
  };

  return (
    <View>
      <View style={[styles.frame, { aspectRatio }]} onLayout={onLayout}>
        <Image source={{ uri }} style={styles.image} contentFit="contain" onLoad={onLoad} accessibilityLabel="Attached photo" />
        <Pressable
          testID="tag-placer-surface"
          style={StyleSheet.absoluteFill}
          onPress={handleTap}
          accessibilityRole="button"
          accessibilityLabel="Tap the photo to place a tag"
        />
        {contentRect &&
          tags.map((tag) => (
            <DraggableMarker key={tag.key} tag={tag} rect={contentRect} onMove={onMove} />
          ))}
        {tags.length === 0 ? (
          <View style={styles.hint} pointerEvents="none">
            <MonoLabel color="inverse">{TAG_PLACER_HINT}</MonoLabel>
          </View>
        ) : null}
      </View>

      <View style={styles.listHeader}>
        <MonoLabel color="textMid">{tagCountLabel(tags.length)}</MonoLabel>
      </View>
      {tags.map((tag, index) => (
        <View key={tag.key} style={styles.row}>
          <Pressable
            style={styles.rowBody}
            onPress={() => onChoose(tag.key)}
            accessibilityRole="button"
            accessibilityLabel={
              tag.destination ? `Tag ${index + 1}: ${tag.destination.name}. Change` : `Tag ${index + 1}: choose what it points to`
            }
          >
            <Text style={styles.rowName} numberOfLines={1}>
              {tag.destination ? tag.destination.name : 'Choose what this tags'}
            </Text>
            {tag.destination ? <MonoLabel color="textMuted">{destinationTypeLabel(tag.destination)}</MonoLabel> : null}
          </Pressable>
          <IconButton
            icon={<XIcon color={color.text} size={16} strokeWidth={2} />}
            accessibilityLabel={`Remove tag ${index + 1}`}
            onPress={() => onRemove(tag.key)}
          />
        </View>
      ))}
    </View>
  );
};

interface DraggableMarkerProps {
  tag: DraftTag;
  rect: Rect;
  onMove: (key: string, xPct: number, yPct: number) => void;
}

/** One placed tag, draggable. It follows the finger and settles, clamped to the picture, on release. */
const DraggableMarker: React.FC<DraggableMarkerProps> = ({ tag, rect, onMove }) => {
  const [offset, setOffset] = useState({ dx: 0, dy: 0 });
  const point = pointForPct(rect, tag.xPct, tag.yPct);
  // The latest values for the responder, which is created once.
  const latest = useRef({ point, rect, key: tag.key, onMove });
  latest.current = { point, rect, key: tag.key, onMove };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (_e, g) => setOffset({ dx: g.dx, dy: g.dy }),
        onPanResponderRelease: (_e, g) => {
          const { point: p, rect: r, key, onMove: move } = latest.current;
          const { xPct, yPct } = pctForPoint(r, p.x + g.dx, p.y + g.dy);
          setOffset({ dx: 0, dy: 0 });
          move(key, xPct, yPct);
        },
        onPanResponderTerminate: () => setOffset({ dx: 0, dy: 0 }),
      }),
    [],
  );

  return (
    <View
      testID={`draft-tag-${tag.key}`}
      {...responder.panHandlers}
      accessibilityLabel={tag.destination ? `Tag on ${tag.destination.name}. Drag to move` : 'New tag'}
      style={[
        styles.hit,
        {
          left: point.x + offset.dx - TAG_HIT_SIZE / 2,
          top: point.y + offset.dy - TAG_HIT_SIZE / 2,
        },
      ]}
    >
      <View style={[styles.marker, !tag.destination && styles.markerPending]} />
    </View>
  );
};

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: color.bgPanel,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  hint: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: space.md,
    alignItems: 'center',
  },
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
  markerPending: {
    backgroundColor: color.inverse,
    borderColor: color.text,
  },
  listHeader: {
    paddingTop: space.md,
    paddingBottom: space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  rowBody: {
    flex: 1,
    gap: 2,
    paddingVertical: space.sm,
  },
  rowName: {
    fontFamily: type.bodyMedium,
    fontSize: 15,
    color: color.text,
  },
});

export default TagPlacer;
