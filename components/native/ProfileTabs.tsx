import React from 'react';
import { View, StyleSheet } from 'react-native';
import { MonoLabel, Pressable } from './ui';
import { PROFILE_TAB_LABELS, type ProfileTab } from '../../lib/screens/profile';
import { color } from '../../theme/tokens';

export interface ProfileTabsProps {
  tabs: ProfileTab[];
  selected: ProfileTab;
  onSelect: (tab: ProfileTab) => void;
}

/** The strip's height, in points. */
export const PROFILE_TABS_HEIGHT = 44;

/**
 * The tabs over a profile's content (ONE-43): each a mono micro-label, the
 * selected one in ink with a 1pt ink underline over the strip's `border`
 * hairline, the rest muted. Words rather than the icons the posts-only strip
 * had (ONE-68): Products, Projects, Saves and Scans have no glyph a reader
 * could be sure of. Screen readers get each tab's name and selected state.
 */
const ProfileTabs: React.FC<ProfileTabsProps> = ({ tabs, selected, onSelect }) => (
  <View style={styles.strip} accessibilityRole="tablist">
    {tabs.map(tab => {
      const active = tab === selected;
      return (
        <Pressable
          key={tab}
          onPress={() => onSelect(tab)}
          accessibilityRole="tab"
          accessibilityLabel={PROFILE_TAB_LABELS[tab]}
          accessibilityState={{ selected: active }}
          style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
        >
          <MonoLabel color={active ? 'text' : 'textMuted'} numberOfLines={1}>
            {PROFILE_TAB_LABELS[tab]}
          </MonoLabel>
          {active ? <View style={styles.underline} /> : null}
        </Pressable>
      );
    })}
  </View>
);

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: color.border,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    backgroundColor: color.bg,
  },
  tab: {
    flex: 1,
    height: PROFILE_TABS_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  underline: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Sits on the strip's hairline rather than above it.
    bottom: -1,
    height: 1,
    backgroundColor: color.text,
  },
});

export default ProfileTabs;
