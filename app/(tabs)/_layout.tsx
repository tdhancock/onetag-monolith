

import React from 'react';
import { Tabs, useRouter } from 'expo-router';
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../store/AppContext.native';
import { 
  HomeIcon, 
  SearchIcon, 
  CameraIcon, 
  UserIcon, 
  PencilAltIcon 
} from '../../components/native/Icons';
import { color } from '../../theme/tokens';

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
        tabBarShowLabel: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: color.bg,
          borderTopColor: color.border,
          height: 60 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 8,
          // Stabil nav bar: içerikle çakışmayı önle
          elevation: 0,
          shadowOpacity: 0,
          borderTopWidth: 1,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ color }) => (
            <View style={{ position: 'relative' }}>
              <HomeIcon color={color} />
              {totalBadge > 0 && (
                <View style={{ position: 'absolute', top: -4, right: -6, backgroundColor: '#ef4444', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: 'bold' }}>{totalBadge > 99 ? '99+' : totalBadge}</Text>
                </View>
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          tabBarIcon: ({ color }) => <SearchIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="camera"
        options={{
          tabBarIcon: ({ color }) => <CameraIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="compose_dummy"
        options={{
          tabBarIcon: ({ color }) => <PencilAltIcon color={color} />,
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
          tabBarIcon: ({ color }) => <UserIcon color={color} />,
        }}
      />
      {/* Utility modules are not screens — hide them from the tab bar.
          Expo Router registers every file under (tabs)/ as a tab; .ts helpers
          would otherwise appear as 3 extra meaningless icons. */}
      <Tabs.Screen name="feed.utils" options={{ href: null }} />
      <Tabs.Screen name="home.utils" options={{ href: null }} />
      <Tabs.Screen name="profile.utils" options={{ href: null }} />
    </Tabs>
  );
}
