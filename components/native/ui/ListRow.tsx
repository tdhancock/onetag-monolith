import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { color, space, type } from '../../../theme/tokens';
import Avatar from './Avatar';

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
  /** A `border` hairline along the row's bottom edge. */
  divider?: boolean;
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
  divider = false,
  accessibilityLabel,
  style,
}) => {
  const content = (
    <>
      {leading ?? <Avatar uri={avatarUri} name={title} size={LIST_ROW_AVATAR_SIZE} />}
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
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
    return <View style={base}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
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
  title: {
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
