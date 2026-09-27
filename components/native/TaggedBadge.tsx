import React from 'react';
import { View, StyleSheet } from 'react-native';
import { MonoLabel } from './ui';
import { taggedBadgeLabel } from '../../lib/screens/embeddedTags';
import { color, space, withAlpha } from '../../theme/tokens';

// The count of Embedded Tags on a piece of media (ONE-45). Its own file, with
// no feature imports, so a grid tile can show it without pulling the tag
// overlay's data layer into its import graph.

export interface TaggedBadgeProps {
  count: number;
  /** A grid thumbnail: the count alone, no "tap to see". */
  compact?: boolean;
}

/**
 * Bottom-left over the image. On a grid thumbnail it is the only sign of
 * tags — markers at that scale are unusable.
 */
const TaggedBadge: React.FC<TaggedBadgeProps> = ({ count, compact = false }) => {
  const label = taggedBadgeLabel(count, compact);
  if (!label) return null;
  return (
    <View style={[styles.badge, compact && styles.badgeCompact]} pointerEvents="none">
      <MonoLabel color="inverse" size={compact ? 8 : 10}>
        {label}
      </MonoLabel>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    left: space.sm,
    bottom: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    // A scrim, so the white label reads over any photo.
    backgroundColor: withAlpha(color.text, 0.72),
  },
  badgeCompact: {
    left: space.xs,
    bottom: space.xs,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
  },
});

export default TaggedBadge;
