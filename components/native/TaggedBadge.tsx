import React from 'react';
import { View, StyleSheet } from 'react-native';
import { MonoLabel, Pressable } from './ui';
import { taggedBadgeLabel } from '../../lib/screens/embeddedTags';
import { color, space, withAlpha } from '../../theme/tokens';

// The count of Embedded Tags on a piece of media (ONE-45). Its own file, with
// no feature imports, so a grid tile can show it without pulling the tag
// overlay's data layer into its import graph.

export interface TaggedBadgeProps {
  count: number;
  /** A grid thumbnail: the count alone, smaller, and not a button. */
  compact?: boolean;
  /**
   * On a post, the badge shows and hides the tags' name labels. Whether they
   * are showing now, and what a tap does.
   */
  labelsShown?: boolean;
  onToggleLabels?: () => void;
}

/**
 * Bottom-left over the image. On a grid thumbnail it is the only sign of
 * tags — markers at that scale are unusable.
 */
const TaggedBadge: React.FC<TaggedBadgeProps> = ({ count, compact = false, labelsShown = false, onToggleLabels }) => {
  const toggles = Boolean(onToggleLabels) && !compact;
  const label = taggedBadgeLabel(count, toggles ? (labelsShown ? 'shown' : 'hidden') : undefined);
  if (!label) return null;

  const text = (
    <MonoLabel color="inverse" size={compact ? 8 : 10}>
      {label}
    </MonoLabel>
  );

  if (!toggles) {
    return (
      <View style={[styles.badge, compact && styles.badgeCompact]} pointerEvents="none">
        {text}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onToggleLabels}
      accessibilityRole="button"
      accessibilityLabel={`${count} tagged. ${labelsShown ? 'Hide' : 'Show'} their names`}
      hitSlop={8}
      style={styles.badge}
    >
      {text}
    </Pressable>
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
