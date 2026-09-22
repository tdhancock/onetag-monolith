import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { color, radius, space } from '../../../theme/tokens';
import MonoLabel from './MonoLabel';

export type ButtonVariant = 'primary' | 'outline';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  onPress?: () => void;
  disabled?: boolean;
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

/**
 * A squared-off button in two weights: `primary` is filled ink with an
 * inverse label, `outline` is a hairline box with an ink label. Both wear the
 * uppercase DM Mono label treatment.
 */
const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  onPress,
  disabled = false,
  fullWidth = false,
  style,
}) => {
  const metrics = sizing[size];
  const isPrimary = variant === 'primary';

  // Guard here as well as on Pressable. The `disabled` prop already stops the
  // press, but this keeps the rule true regardless of what the control is
  // swapped for later, and makes it assertable without a renderer.
  const handlePress = () => {
    if (disabled) return;
    onPress?.();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        {
          paddingVertical: metrics.paddingVertical,
          paddingHorizontal: metrics.paddingHorizontal,
          backgroundColor: isPrimary ? color.text : 'transparent',
          borderColor: isPrimary ? color.text : color.border,
        },
        fullWidth && styles.fullWidth,
        disabled && { opacity: DISABLED_OPACITY },
        pressed && !disabled && { opacity: PRESSED_OPACITY },
        style,
      ]}
    >
      <MonoLabel size={metrics.label} color={isPrimary ? 'inverse' : 'text'}>
        {children}
      </MonoLabel>
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
});

export default Button;
