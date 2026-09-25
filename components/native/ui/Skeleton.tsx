import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import type { DimensionValue, StyleProp, ViewStyle } from 'react-native';
import { color, radius } from '../../../theme/tokens';
import { useReducedMotion } from './useReducedMotion';

export interface SkeletonProps {
  /** Points or a percentage. Defaults to the full width, or `height` for a circle. */
  width?: DimensionValue;
  /** Points. Omit it to size by `style`, e.g. an `aspectRatio`. */
  height?: number;
  /** Draws a circle of diameter `height`, for avatar placeholders. */
  circle?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** The pulse runs between these two opacities. */
export const PULSE_MIN_OPACITY = 0.4;
export const PULSE_MAX_OPACITY = 1;
/** Duration of each half of the pulse, in milliseconds. */
export const PULSE_DURATION_MS = 800;

/**
 * A placeholder block on the panel surface, with a subtle opacity pulse.
 *
 * With the system's reduce-motion setting on, the block holds still at full
 * opacity instead of pulsing.
 */
const Skeleton: React.FC<SkeletonProps> = ({ width, height, circle = false, style }) => {
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(PULSE_MAX_OPACITY)).current;

  useEffect(() => {
    if (reducedMotion) {
      // The setting can flip on mid-pulse; stopping the loop alone would
      // leave the block frozen at whatever opacity it had reached.
      opacity.setValue(PULSE_MAX_OPACITY);
      return undefined;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: PULSE_MIN_OPACITY,
          duration: PULSE_DURATION_MS,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: PULSE_MAX_OPACITY,
          duration: PULSE_DURATION_MS,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, reducedMotion]);

  const shape: ViewStyle = circle
    ? {
        width: width ?? height,
        height,
        // Circles are for avatar placeholders, which mirror the round Avatar.
        borderRadius: (height ?? 0) / 2,
      }
    : { width: width ?? '100%', height, borderRadius: radius.none };

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.base, shape, style, { opacity }]}
    />
  );
};

const styles = StyleSheet.create({
  base: {
    backgroundColor: color.bgPanel,
  },
});

export default Skeleton;
