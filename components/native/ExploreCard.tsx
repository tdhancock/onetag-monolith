import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { MonoLabel, Pressable } from './ui';
import TaggedBadge from './TaggedBadge';
import { exploreCellLabel, exploreKindLabel } from '../../lib/screens/explore';
import { color, space, type, withAlpha } from '../../theme/tokens';
import type { ExploreItem } from '../../features/explore';

// One square cell of the Explore grid (ONE-47): the picture cropped to cover,
// or a text post's first lines on `bgPanel`; the kind in a MonoLabel at the
// top, so a tap is never a surprise; and a post's tag count at the bottom.

export interface ExploreCardProps {
  item: ExploreItem;
  size: number;
  /** The gap to the right of this cell: none at the end of a row. */
  gapRight: number;
  gapBottom: number;
  onPress: () => void;
}

const ExploreCard: React.FC<ExploreCardProps> = React.memo(({ item, size, gapRight, gapBottom, onPress }) => {
  const showsPicture = item.mediaType === 'image' && Boolean(item.imageUrl);

  return (
    <Pressable
      testID={`explore-cell-${item.key}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={exploreCellLabel(item)}
      style={({ pressed }) => [
        styles.cell,
        { width: size, height: size, marginRight: gapRight, marginBottom: gapBottom },
        pressed && styles.pressed,
      ]}
    >
      {showsPicture ? (
        <Image source={{ uri: item.imageUrl! }} style={styles.fill} contentFit="cover" transition={200} />
      ) : (
        <View style={styles.textCell}>
          <Text style={styles.textCopy} numberOfLines={item.kind === 'post' ? 6 : 3}>
            {item.title}
          </Text>
        </View>
      )}

      <View style={[styles.kind, showsPicture && styles.kindOverPicture]} pointerEvents="none">
        <MonoLabel color={showsPicture ? 'inverse' : 'textMid'} size={9}>
          {exploreKindLabel(item.kind)}
        </MonoLabel>
      </View>

      <TaggedBadge count={item.tagCount} compact />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  cell: {
    backgroundColor: color.bgPanel,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.85,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  textCell: {
    flex: 1,
    padding: space.md,
    paddingTop: space.xl,
    justifyContent: 'center',
  },
  textCopy: {
    fontFamily: type.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
    color: color.text,
  },
  kind: {
    position: 'absolute',
    top: space.xs,
    left: space.xs,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
  },
  kindOverPicture: {
    // A scrim, so the white label reads over any picture.
    backgroundColor: withAlpha(color.text, 0.55),
  },
});

export default ExploreCard;
