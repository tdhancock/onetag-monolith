import React from 'react';
import { View, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { color, space } from '../../../theme/tokens';

export type SpaceTokenKey = keyof typeof space;

export interface DividerProps {
  /** A key from the space scale, applied as horizontal margin. */
  inset?: SpaceTokenKey;
  style?: StyleProp<ViewStyle>;
}

/** A 1px hairline rule. */
const Divider: React.FC<DividerProps> = ({ inset, style }) => (
  <View
    accessibilityRole="none"
    style={[styles.base, inset ? { marginHorizontal: space[inset] } : null, style]}
  />
);

const styles = StyleSheet.create({
  base: {
    height: 1,
    alignSelf: 'stretch',
    backgroundColor: color.border,
  },
});

export default Divider;
