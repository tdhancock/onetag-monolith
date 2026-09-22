import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { color, radius, space } from '../../../theme/tokens';

export type SpaceTokenKey = keyof typeof space;

export interface CardProps {
  children: React.ReactNode;
  /** A key from the space scale. Defaults to `lg` (16). */
  padding?: SpaceTokenKey;
  /** Supplying this makes the card pressable, with press feedback. */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Opacity applied while the finger is down on a pressable card. */
export const PRESSED_OPACITY = 0.7;

/**
 * A panel on the page ground, bounded by a hairline rule and no radius.
 *
 * With `onPress` it renders as a pressable with feedback; without it, a plain
 * view — so a static card costs nothing and never traps a touch.
 */
const Card: React.FC<CardProps> = ({ children, padding = 'lg', onPress, style }) => {
  const base: StyleProp<ViewStyle> = [styles.base, { padding: space[padding] }, style];

  if (!onPress) {
    return <View style={base}>{children}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [base, pressed && { opacity: PRESSED_OPACITY }]}
    >
      {children}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    backgroundColor: color.bg,
    borderColor: color.border,
    borderWidth: 1,
    borderRadius: radius.none,
  },
});

export default Card;
