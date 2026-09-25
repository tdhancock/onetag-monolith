import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { color, space, type } from '../../../theme/tokens';
import Pressable from './Pressable';
import MonoLabel from './MonoLabel';
import { ChevronRightIcon } from '../Icons';

export interface SettingsRowProps {
  title: string;
  /** One line of explanation under the title. */
  subtitle?: string;
  /** A trailing control such as a Switch. Replaces the chevron. */
  control?: React.ReactNode;
  /** Makes the row pressable. Without a control, a chevron shows it leads on. */
  onPress?: () => void;
  /** Heart red, for Delete account. Drops the chevron: it acts, not navigates. */
  destructive?: boolean;
  /** A `border` hairline along the row's bottom edge, between rows in a group. */
  divider?: boolean;
  accessibilityLabel?: string;
}

export interface SettingsSectionProps {
  /** A MonoLabel header above the group. Omit it for a group that needs none. */
  title?: string;
  children: React.ReactNode;
}

/** A settings row's minimum height, in points. */
export const SETTINGS_ROW_MIN_HEIGHT = 52;
/** Background while the finger is down on a pressable row. */
const PRESSED_BACKGROUND = color.bgSub;

/**
 * One row of a grouped settings list: a white row with a body title, an
 * optional muted subtitle, and a trailing chevron or control.
 */
const SettingsRow: React.FC<SettingsRowProps> = ({
  title,
  subtitle,
  control,
  onPress,
  destructive = false,
  divider = false,
  accessibilityLabel,
}) => {
  const trailing =
    control ?? (onPress && !destructive ? <ChevronRightIcon color={color.textMuted} size={18} /> : null);

  const content = (
    <>
      <View style={styles.text}>
        <Text style={[styles.title, destructive && styles.destructive]}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </>
  );

  if (!onPress) {
    return <View style={[styles.row, divider && styles.divider]}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && { backgroundColor: PRESSED_BACKGROUND }]}
    >
      {content}
    </Pressable>
  );
};

/**
 * A group of SettingsRows under a MonoLabel header on the `bgSub` ground,
 * with a hairline above and below the white rows.
 */
export const SettingsSection: React.FC<SettingsSectionProps> = ({ title, children }) => (
  <View style={styles.section}>
    {title ? (
      <MonoLabel color="textMid" style={styles.sectionTitle}>
        {title}
      </MonoLabel>
    ) : null}
    <View style={styles.group}>{children}</View>
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: SETTINGS_ROW_MIN_HEIGHT,
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
  },
  title: {
    fontFamily: type.body,
    fontSize: 15,
    color: color.text,
  },
  destructive: {
    color: color.heart,
  },
  subtitle: {
    marginTop: 2,
    fontFamily: type.body,
    fontSize: 13,
    lineHeight: 18,
    color: color.textMid,
  },
  trailing: {
    marginLeft: space.md,
  },
  section: {
    paddingTop: space.xl,
  },
  sectionTitle: {
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  group: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.border,
  },
});

export default SettingsRow;
