import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { GridIcon, RepostIcon, BookmarkIcon } from './Icons';
import { PROFILE_TAB_LABELS, type ProfileTab } from '../../lib/screens/profile';
import { color } from '../../theme/tokens';

export interface ProfileTabsProps {
  tabs: ProfileTab[];
  selected: ProfileTab;
  onSelect: (tab: ProfileTab) => void;
}

/** The strip's height, in points. */
export const PROFILE_TABS_HEIGHT = 44;

const ICON_SIZE = 22;

const iconFor = (tab: ProfileTab, active: boolean) => {
  const tint = active ? color.text : color.textMuted;
  switch (tab) {
    case 'posts':
      return <GridIcon color={tint} size={ICON_SIZE} strokeWidth={1.8} />;
    case 'reposts':
      return <RepostIcon color={tint} size={ICON_SIZE} strokeWidth={1.8} />;
    case 'saved':
      return <BookmarkIcon color={tint} size={ICON_SIZE} strokeWidth={1.8} />;
  }
};

/**
 * Icon tabs over a profile's grid, with no text labels: the selected tab
 * carries a 1pt ink underline over the strip's `border` hairline. Screen
 * readers get each tab's name and its selected state.
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
          {iconFor(tab, active)}
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
