import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { color, type } from '../../../theme/tokens';

export interface IconButtonProps {
  /** The icon element, e.g. `<BellIcon />`. It is centred in the hit area. */
  icon: React.ReactNode;
  onPress?: () => void;
  /**
   * Required: an icon-only control has no text for a screen reader to fall
   * back on, so leaving it out is a type error rather than a silent gap.
   */
  accessibilityLabel: string;
  disabled?: boolean;
  /** An unread count drawn over the icon's top-right corner. Hidden at 0. */
  badge?: number;
  style?: StyleProp<ViewStyle>;
}

/** The minimum tappable area, in points, on both axes. */
export const ICON_BUTTON_SIZE = 44;
/** Counts above this read as "99+". The tab bar badge uses the same rule. */
export const BADGE_MAX = 99;

/** Opacity applied to the whole control when disabled. */
export const DISABLED_OPACITY = 0.4;
/** Opacity applied while the finger is down. */
export const PRESSED_OPACITY = 0.5;

/**
 * The text a badge shows for a count, or null when there is nothing to show.
 * Zero and negative counts hide the badge rather than reading "0".
 */
export const badgeLabel = (count?: number | null): string | null => {
  if (!count || count <= 0) return null;
  return count > BADGE_MAX ? `${BADGE_MAX}+` : String(count);
};

/**
 * An icon inside a 44×44pt hit area, with an optional unread badge.
 *
 * The icon itself stays whatever size the caller drew it at; the hit area
 * around it is what meets the minimum target size.
 */
const IconButton: React.FC<IconButtonProps> = ({
  icon,
  onPress,
  accessibilityLabel,
  disabled = false,
  badge,
  style,
}) => {
  const label = badgeLabel(badge);

  // Guarded here as well as on Pressable, for the same reason as Button.
  const handlePress = () => {
    if (disabled) return;
    onPress?.();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        disabled && { opacity: DISABLED_OPACITY },
        pressed && !disabled && { opacity: PRESSED_OPACITY },
        style,
      ]}
    >
      {icon}
      {label !== null && (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    width: ICON_BUTTON_SIZE,
    height: ICON_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    // The badge is a pill: like the avatar, a deliberate exception to the
    // square-corner house style, so it reads as a count and not a tag.
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.heart,
  },
  badgeText: {
    fontFamily: type.bodyBold,
    fontSize: 9,
    color: color.inverse,
  },
});

export default IconButton;
