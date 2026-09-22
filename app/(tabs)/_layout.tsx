

import React from 'react';
import { Tabs, useRouter } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../store/AppContext.native';
import {
  HomeIcon,
  SearchIcon,
  CameraIcon,
  UserIcon,
  PencilAltIcon
} from '../../components/native/Icons';
import { color, type } from '../../theme/tokens';

// Vertical budget, worst case (a device reporting no bottom inset):
// the bar is 60pt tall with 8pt of padding top and bottom, leaving a 44pt
// row. Each tab item fills that row and adds 5pt of its own padding, so its
// children start at y=5. Everything below is sized to land inside 44pt from
// there, which is what keeps the circle off the bar's edges on Android.
//
//   center tab   5 + 36                  = 41
//   other tabs   5 + 22 + 2 + 12         = 41
//
// Changing any of these means redoing that arithmetic.

/** Icon size for the four ordinary tabs. */
const TAB_ICON_SIZE = 22;
/** Label line box, pinned so the total does not drift with font metrics. */
const TAB_LABEL_LINE_HEIGHT = 12;
/** Diameter of the center tab's filled circle. */
const CENTER_BUTTON_SIZE = 36;
/** Icon inside that circle, sized to leave a ring of ground around it. */
const CENTER_ICON_SIZE = 20;

export default function TabLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { notifications, unreadMessageCount } = useApp();
  const unreadNotificationCount = notifications?.filter(n => !n.is_read).length ?? 0;
  const totalBadge = unreadNotificationCount + unreadMessageCount;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.text,
        tabBarInactiveTintColor: color.textMuted,
        tabBarShowLabel: true,
        // Pinned rather than left to the automatic width heuristic: on a wide
        // screen the labels would otherwise move beside the icons and the
        // center circle would lose its slot.
        tabBarLabelPosition: 'below-icon',
        tabBarLabelStyle: styles.tabLabel,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: color.bg,
          borderTopColor: color.border,
          height: 60 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 8,
          // Keep the bar flat and stable so it never overlaps screen content.
          elevation: 0,
          shadowOpacity: 0,
          borderTopWidth: 1,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarLabel: 'Home',
          // `color` here is the tint react-navigation hands the icon; the
          // import of the same name is the token module. Renamed so the two
          // never get confused.
          tabBarIcon: ({ color: tint }) => (
            <View style={styles.iconWrap}>
              <HomeIcon color={tint} size={TAB_ICON_SIZE} />
              {totalBadge > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{totalBadge > 99 ? '99+' : totalBadge}</Text>
                </View>
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          tabBarLabel: 'Explore',
          tabBarIcon: ({ color: tint }) => <SearchIcon color={tint} size={TAB_ICON_SIZE} />,
        }}
      />
      <Tabs.Screen
        name="camera"
        options={{
          title: 'Camera',
          // The circle is this tab's emphasis and carries no label — a label
          // under a 36pt circle does not fit inside the unchanged bar height.
          //
          // It has to be hidden with a null label rather than with
          // `tabBarShowLabel: false`: BottomTabBar reads that flag off the
          // *focused* tab's options and applies it to every item, so setting
          // it here would blank all five labels whenever this tab is open.
          tabBarLabel: () => null,
          // …which also means the automatic accessibility label, derived from
          // a string label, is not available. Set it explicitly.
          tabBarAccessibilityLabel: 'Camera',
          tabBarIcon: () => (
            <View style={styles.centerButton}>
              <CameraIcon color={color.inverse} size={CENTER_ICON_SIZE} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="compose_dummy"
        options={{
          tabBarLabel: 'Compose',
          tabBarIcon: ({ color: tint }) => <PencilAltIcon color={tint} size={TAB_ICON_SIZE} />,
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push('/compose');
          },
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color: tint }) => <UserIcon color={tint} size={TAB_ICON_SIZE} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabLabel: {
    fontFamily: type.monoLabel.fontFamily,
    fontSize: type.monoLabel.fontSize,
    letterSpacing: type.monoLabel.letterSpacing,
    textTransform: type.monoLabel.textTransform,
    lineHeight: TAB_LABEL_LINE_HEIGHT,
    marginTop: 2,
  },
  iconWrap: {
    position: 'relative',
  },
  centerButton: {
    width: CENTER_BUTTON_SIZE,
    height: CENTER_BUTTON_SIZE,
    borderRadius: CENTER_BUTTON_SIZE / 2,
    backgroundColor: color.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    backgroundColor: color.heart,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: color.inverse,
    fontSize: 9,
    fontWeight: 'bold',
  },
});
