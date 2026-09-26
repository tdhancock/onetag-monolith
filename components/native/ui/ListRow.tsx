import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { color, space, type } from '../../../theme/tokens';
import Pressable from './Pressable';
import Avatar from './Avatar';
import { VerifiedIcon } from '../Icons';

export interface ListRowProps {
  title: string;
  subtitle?: string | null;
  /** Avatar image. The avatar's initials fall back to `title`. */
  avatarUri?: string | null;
  /** Replaces the avatar, e.g. an icon tile on an option row. */
  leading?: React.ReactNode;
  /** Right-aligned node: a button, a chevron, a timestamp. */
  trailing?: React.ReactNode;
  /** Supplying this makes the row pressable, with press feedback. */
  onPress?: () => void;
  /** A secondary action, e.g. a sheet of options. Only on a pressable row. */
  onLongPress?: () => void;
  /** Describes what a long press does, when there is one. */
  accessibilityHint?: string;
  /** A `border` hairline along the row's bottom edge. */
  divider?: boolean;
  /** An ink verified mark after the title. */
  verified?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** The row's minimum height, in points. */
export const LIST_ROW_MIN_HEIGHT = 56;
/** The leading avatar's diameter. */
export const LIST_ROW_AVATAR_SIZE = 40;
/** Background while the finger is down on a pressable row. */
export const PRESSED_BACKGROUND = color.bgSub;

/**
 * The standard list row: a 40pt avatar (or any leading node), a bold title
 * over a muted subtitle, and an optional trailing node.
 *
 * Without `onPress` it is a plain view, so a static row never traps a touch.
 */
const ListRow: React.FC<ListRowProps> = ({
  title,
  subtitle,
  avatarUri,
  leading,
  trailing,
  onPress,
  onLongPress,
  accessibilityHint,
  divider = false,
  verified = false,
  accessibilityLabel,
  style,
}) => {
  const content = (
    <>
      {leading ?? <Avatar uri={avatarUri} name={title} size={LIST_ROW_AVATAR_SIZE} />}
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {verified ? (
            <View style={styles.verified} accessible accessibilityLabel="Verified">
              <VerifiedIcon color={color.text} size={14} />
            </View>
          ) : null}
        </View>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </>
  );

  const base: StyleProp<ViewStyle> = [styles.row, divider && styles.divider, style];

  if (!onPress) {
    // Named by its caller, a static row reads as one element — not as its
    // avatar initials, title and subtitle in turn (ONE-87). Unnamed, its parts
    // are left to be read on their own.
    return (
      <View
        style={base}
        accessible={accessibilityLabel ? true : undefined}
        accessibilityLabel={accessibilityLabel}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [base, pressed && { backgroundColor: PRESSED_BACKGROUND }]}
    >
      {content}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: LIST_ROW_MIN_HEIGHT,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: color.bg,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  text: {
    flex: 1,
    marginLeft: space.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  verified: {
    marginLeft: space.xs,
  },
  title: {
    flexShrink: 1,
    fontFamily: type.bodyBold,
    fontSize: 15,
    color: color.text,
  },
  subtitle: {
    marginTop: 2,
    fontFamily: type.body,
    fontSize: 13,
    color: color.textMid,
  },
  trailing: {
    marginLeft: space.md,
  },
});

export default ListRow;
