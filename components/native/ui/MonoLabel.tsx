import React from 'react';
import { Text, StyleSheet } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { color, type } from '../../../theme/tokens';

export type ColorTokenKey = keyof typeof color;

export interface MonoLabelProps {
  children: React.ReactNode;
  /**
   * Font size in points. Defaults to the `monoLabel` token size. Tracking is
   * derived from this rather than fixed, so the label keeps its 0.18em
   * proportion at any size — see `letterSpacingFor`.
   */
  size?: number;
  /** A key from the colour tokens. Never a hex string. */
  color?: ColorTokenKey;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

/**
 * The tracking in `type.monoLabel` is expressed in points at the token's own
 * font size. Scaling it keeps the ratio constant, so a 14px MonoLabel is
 * letterspaced as generously as a 10px one rather than looking cramped.
 */
export const letterSpacingFor = (size: number): number =>
  // Multiply before dividing. Taking the ratio first would go through 0.18,
  // which has no exact binary representation, and the default size would
  // come back as 1.7999999999999998 instead of the token's 1.8.
  (size * type.monoLabel.letterSpacing) / type.monoLabel.fontSize;

/**
 * The recurring micro-label: DM Mono, uppercase, widely letterspaced.
 *
 * This treatment appears on nearly every screen in the design direction.
 * Reach for this component rather than hand-rolling the three style
 * properties again.
 */
const MonoLabel: React.FC<MonoLabelProps> = ({
  children,
  size = type.monoLabel.fontSize,
  color: colorKey = 'textMuted',
  style,
  numberOfLines,
}) => (
  <Text
    numberOfLines={numberOfLines}
    style={[
      styles.base,
      {
        fontSize: size,
        letterSpacing: letterSpacingFor(size),
        color: color[colorKey],
      },
      style,
    ]}
  >
    {children}
  </Text>
);

const styles = StyleSheet.create({
  base: {
    fontFamily: type.monoLabel.fontFamily,
    textTransform: type.monoLabel.textTransform,
  },
});

export default MonoLabel;
