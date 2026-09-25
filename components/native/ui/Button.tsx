import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { color, radius, space } from '../../../theme/tokens';
import Pressable from './Pressable';
import MonoLabel from './MonoLabel';

export type ButtonVariant = 'primary' | 'outline' | 'inverse';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  onPress?: () => void;
  disabled?: boolean;
  /**
   * Shows a spinner in place of the label and ignores presses, at full
   * strength rather than dimmed: the action is under way, not unavailable.
   */
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Opacity applied to the whole control when disabled. */
export const DISABLED_OPACITY = 0.4;
/** Opacity applied while the finger is down. */
export const PRESSED_OPACITY = 0.6;

const sizing: Record<ButtonSize, { paddingVertical: number; paddingHorizontal: number; label: number }> = {
  sm: { paddingVertical: space.sm, paddingHorizontal: space.md, label: 10 },
  md: { paddingVertical: space.md, paddingHorizontal: space.lg, label: 12 },
};

/** Fill, border and label colour for each variant. */
const palette: Record<ButtonVariant, { fill: string; border: string; label: 'inverse' | 'text' }> = {
  primary: { fill: color.text, border: color.text, label: 'inverse' },
  outline: { fill: 'transparent', border: color.border, label: 'text' },
  // For full-bleed dark media (the camera, the OneSnap viewer), where an ink
  // button would disappear into the black.
  inverse: { fill: color.inverse, border: color.inverse, label: 'text' },
};

/**
 * A squared-off button in three weights: `primary` is filled ink with an
 * inverse label, `outline` is a hairline box with an ink label, and `inverse`
 * is a white fill with an ink label for use over dark media. All wear the
 * uppercase DM Mono label treatment.
 */
const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  onPress,
  disabled = false,
  loading = false,
  fullWidth = false,
  style,
}) => {
  const metrics = sizing[size];
  const colors = palette[variant];
  const inert = disabled || loading;

  // Guard here as well as on Pressable. The `disabled` prop already stops the
  // press, but this keeps the rule true regardless of what the control is
  // swapped for later, and makes it assertable without a renderer.
  const handlePress = () => {
    if (inert) return;
    onPress?.();
  };

  const label = (
    <MonoLabel size={metrics.label} color={colors.label} style={loading ? styles.hidden : undefined}>
      {children}
    </MonoLabel>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: loading }}
      disabled={inert}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        {
          paddingVertical: metrics.paddingVertical,
          paddingHorizontal: metrics.paddingHorizontal,
          backgroundColor: colors.fill,
          borderColor: colors.border,
        },
        fullWidth && styles.fullWidth,
        disabled && { opacity: DISABLED_OPACITY },
        pressed && !inert && { opacity: PRESSED_OPACITY },
        style,
      ]}
    >
      {loading ? (
        // The label stays in the layout, invisible, so the button keeps its
        // width while the spinner sits over it.
        <View>
          {label}
          <ActivityIndicator size="small" color={color[colors.label]} style={styles.spinner} />
        </View>
      ) : (
        label
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.none,
  },
  fullWidth: {
    alignSelf: 'stretch',
    width: '100%',
  },
  hidden: {
    opacity: 0,
  },
  spinner: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
});

export default Button;
