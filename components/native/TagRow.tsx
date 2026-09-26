import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { MonoLabel, Pressable } from './ui';
import type { OwnedTag } from '../../features/tags';
import { destinationLabel, scanSummary, TAG_TYPE_LABEL, tagStateLabel, tagTitle } from '../../lib/screens/tags';
import { color, space, type } from '../../theme/tokens';

export interface TagActiveSwitchProps {
  active: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** Names the tag, so a screen reader says which one it flips. */
  tagName: string;
}

/**
 * A tag's activation switch, on the dashboard row and the detail screen. The
 * settings switch's colours, from the tokens.
 */
export const TagActiveSwitch: React.FC<TagActiveSwitchProps> = ({ active, onToggle, disabled, tagName }) => (
  <Switch
    value={active}
    onValueChange={onToggle}
    disabled={disabled}
    accessibilityLabel={`${tagName}: ${active ? 'active' : 'inactive'}`}
    trackColor={{ true: color.text, false: color.borderStrong }}
    ios_backgroundColor={color.borderStrong}
    thumbColor={color.inverse}
  />
);

/**
 * The INACTIVE marker. Solid ink with inverse type, so a paused tag cannot be
 * mistaken for a live one at a glance (ONE-34) — not a tint.
 */
export const InactiveBadge: React.FC = () => (
  <View style={styles.badge} accessible accessibilityLabel="Inactive">
    <MonoLabel color="inverse">{tagStateLabel(false)}</MonoLabel>
  </View>
);

export interface TagRowProps {
  tag: OwnedTag;
  onPress: () => void;
  onToggleActive: () => void;
  divider?: boolean;
}

/**
 * One tag on the dashboard (ONE-34): its name (or destination), a mono label
 * of its type and code, where it points, how often it has been scanned, and
 * its activation switch.
 */
const TagRow: React.FC<TagRowProps> = ({ tag, onPress, onToggleActive, divider = false }) => {
  const title = tagTitle(tag);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${TAG_TYPE_LABEL[tag.tagType]} tag, ${tagStateLabel(tag.active)}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        divider && styles.divider,
        !tag.active && styles.inactiveRow,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.text}>
        <View style={styles.labels}>
          <MonoLabel color="textMid">{`${TAG_TYPE_LABEL[tag.tagType]} · ${tag.shortCode}`}</MonoLabel>
          {tag.active ? null : <InactiveBadge />}
        </View>
        <Text style={[styles.title, !tag.active && styles.inactiveTitle]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.destination} numberOfLines={1}>
          {destinationLabel(tag.destination)}
        </Text>
        <Text style={styles.scans}>{scanSummary(tag)}</Text>
      </View>
      <TagActiveSwitch active={tag.active} onToggle={onToggleActive} tagName={title} />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: color.bg,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  inactiveRow: {
    backgroundColor: color.bgPanel,
  },
  pressed: {
    backgroundColor: color.bgSub,
  },
  text: {
    flex: 1,
    marginRight: space.md,
  },
  labels: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  badge: {
    backgroundColor: color.text,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
  },
  title: {
    marginTop: space.xs,
    fontFamily: type.bodyBold,
    fontSize: 15,
    color: color.text,
  },
  inactiveTitle: {
    color: color.textMid,
  },
  destination: {
    marginTop: 2,
    fontFamily: type.body,
    fontSize: 13,
    color: color.textMid,
  },
  scans: {
    marginTop: 2,
    fontFamily: type.body,
    fontSize: 12,
    color: color.textMuted,
  },
});

export default TagRow;
