import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import type { ImageStyle } from 'expo-image';
import { color, type } from '../../../theme/tokens';

export interface AvatarProps {
  /** Image URL. When absent, initials derived from `name` are shown instead. */
  uri?: string | null;
  /** Display name the initials are derived from. */
  name?: string | null;
  /** Diameter in points. */
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export const DEFAULT_AVATAR_SIZE = 40;
/** Shown when there is no usable name to derive initials from. */
export const INITIALS_FALLBACK = '?';

/**
 * First letters of the first two whitespace-separated words, uppercased —
 * "Jordan Reeves" becomes "JR", "Jordan" becomes "J". Falls back to "?" when
 * there is nothing to work with, so the badge is never blank.
 */
export const initialsFrom = (name?: string | null): string => {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return INITIALS_FALLBACK;
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
};

/**
 * A circular avatar with an initials fallback.
 *
 * Circular is a deliberate exception to the square-corner house style —
 * avatars stay round. Note that a OneSnap is not an avatar: it renders as a
 * square card and must not use this component.
 */
const Avatar: React.FC<AvatarProps> = ({ uri, name, size = DEFAULT_AVATAR_SIZE, style }) => {
  const circle = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return (
      <Image
        source={{ uri }}
        // ViewStyle and ImageStyle differ only in that ImageStyle has no
        // `overflow: 'scroll'`. Callers style an avatar as a box, so the
        // prop stays ViewStyle and the image branch narrows here.
        style={[circle, style] as StyleProp<ImageStyle>}
        contentFit="cover"
        transition={200}
        accessibilityLabel={name ?? undefined}
      />
    );
  }

  return (
    <View style={[styles.fallback, circle, style]}>
      <Text style={[styles.initials, { fontSize: size * 0.36 }]}>{initialsFrom(name)}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.bgPanel,
    borderColor: color.border,
    borderWidth: 1,
  },
  initials: {
    fontFamily: type.mono,
    color: color.textMid,
  },
});

export default Avatar;
