import React, { useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  useFollowCountsQuery,
  useProfilePostCountQuery,
  profileKeys,
  useCurrentProfile,
} from '../../features/profiles';
import { useRealtimeSync } from '../../lib/realtimeBridge';
import ProfileHeader, { ProfileHeaderSkeleton } from '../../components/native/ProfileHeader';
import ProfileTabs from '../../components/native/ProfileTabs';
import ProfileTabList from '../../components/native/ProfileTabList';
import ProfileSwitcher, { ProfileSwitcherButton } from '../../components/native/ProfileSwitcher';
import { ProfileGridSkeleton } from '../../components/native/ProfileGrid';
import { Button, IconButton, Sheet, SheetRow } from '../../components/native/ui';
import { MenuIcon, PlusIcon, TagIcon } from '../../components/native/Icons';
import { getEditButtonProps, profileTabsFor, type ProfileTab } from '../../lib/screens/profile';
import { tagCreateRoute, TAGS_DASHBOARD_ROUTE } from '../../lib/screens/tags';
import { canCreateProduct, PRODUCT_CREATE_ROUTE } from '../../lib/screens/products';
import { PROJECT_CREATE_ROUTE } from '../../lib/screens/projects';
import { color, space } from '../../theme/tokens';

// ─── Profile Screen ──────────────────────────────

/**
 * Your own profile: the header, then the tabs your profile's type has
 * (ONE-43) — Products, Projects and Media for a business; Posts, Saves,
 * Projects and Scans for an individual. Each tab fetches only once it is
 * opened.
 */
export default function ProfileScreen() {
  const { profile: userProfile, profileId } = useCurrentProfile();
  const queryClient = useQueryClient();

  // Follow counts come from the query the follow toggle moves optimistically
  // (ONE-15), so following someone updates this screen without a refetch.
  const { data: followCounts } = useFollowCountsQuery(profileId);
  // A count for the header, never the posts: the first tab may not be them.
  const { data: postCount } = useProfilePostCountQuery(profileId);
  const router = useRouter();

  const tabs = profileTabsFor({
    profileType: userProfile.profileType,
    isOwnProfile: true,
    scanHistoryPublic: userProfile.scanHistoryPublic,
  });
  const [selectedTab, setSelectedTab] = useState<ProfileTab>(tabs[0]!);
  // A switch to a profile of the other type lands on its first tab.
  const tab = tabs.includes(selectedTab) ? selectedTab : tabs[0]!;
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // Realtime, through the shared bridge (ONE-16). A change to the profile's
  // posts re-reads them and their count, which sits beneath them.
  useRealtimeSync({
    table: 'posts',
    filter: `user_id=eq.${profileId ?? ''}`,
    queryKey: profileKeys.posts(profileId ?? ''),
    enabled: Boolean(profileId),
  });

  // Two streams rather than one client-side check over every follow in the
  // system: a follow of this user, and a follow made by them.
  useRealtimeSync({
    table: 'follows',
    filter: `followed_id=eq.${profileId ?? ''}`,
    queryKey: profileKeys.counts(profileId ?? ''),
    enabled: Boolean(profileId),
  });

  useRealtimeSync({
    table: 'follows',
    filter: `follower_id=eq.${profileId ?? ''}`,
    queryKey: profileKeys.counts(profileId ?? ''),
    enabled: Boolean(profileId),
  });

  // Pull to refresh re-reads everything cached about profiles — the header,
  // the counts, follow state — and the open tab re-reads its own list.
  const refreshHeader = () => queryClient.invalidateQueries({ queryKey: profileKeys.all });

  const editButton = getEditButtonProps(userProfile);

  // What this profile can create from here: a project, whatever its type
  // (ONE-41), and a product only if it is a business (ONE-40) — an
  // individual profile is never offered one.
  const canAddProduct = canCreateProduct(userProfile);

  // A bar of its own above the header: the profile you are acting as, which
  // opens the switcher (ONE-25), what it can create, its Tags (ONE-34), and
  // Settings.
  const topBar = (
    <View style={styles.topBar}>
      <ProfileSwitcherButton profile={userProfile} onPress={() => setSwitcherOpen(true)} />
      <View style={styles.topBarActions}>
        <IconButton
          icon={<PlusIcon color={color.text} size={24} strokeWidth={1.8} />}
          accessibilityLabel="Create"
          onPress={() => setCreateOpen(true)}
        />
        <IconButton
          icon={<TagIcon color={color.text} size={24} strokeWidth={1.8} />}
          accessibilityLabel="Tags"
          onPress={() => router.push(TAGS_DASHBOARD_ROUTE)}
        />
        <IconButton
          icon={<MenuIcon color={color.text} size={24} strokeWidth={1.8} />}
          accessibilityLabel="Settings"
          onPress={() => router.push('/settings')}
        />
      </View>
    </View>
  );

  const header = (
    <View>
      <ProfileHeader
        profile={userProfile}
        stats={{ posts: postCount, followers: followCounts?.followers, following: followCounts?.following }}
        onPressFollowers={() => router.push({ pathname: '/user-list', params: { type: 'followers', userId: profileId, title: 'Followers' } })}
        onPressFollowing={() => router.push({ pathname: '/user-list', params: { type: 'following', userId: profileId, title: 'Following' } })}
        // Share waits for profile links in M4 (ONE-68 allows hiding it until
        // then). A business profile creates tags from its own view (ONE-32).
        actions={
          editButton.isEnabled ? (
            <View style={styles.actions}>
              <Button variant="outline" size="sm" onPress={() => router.push(editButton.target)} style={styles.action}>
                {editButton.label}
              </Button>
              {userProfile.profileType === 'business' ? (
                <Button variant="outline" size="sm" onPress={() => router.push(tagCreateRoute())} style={styles.action}>
                  Create tag
                </Button>
              ) : null}
            </View>
          ) : null
        }
      />
      <ProfileTabs tabs={tabs} selected={tab} onSelect={setSelectedTab} />
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {topBar}
      {profileId ? (
        // Keyed by the profile: a switch starts every tab afresh, with none of
        // the previous profile's content under the new one's header (ONE-25).
        <ProfileTabList
          key={profileId}
          tab={tab}
          profile={{ id: profileId, username: userProfile.username, scanHistoryPublic: userProfile.scanHistoryPublic }}
          isOwnProfile
          header={header}
          onRefreshHeader={refreshHeader}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          <ProfileHeaderSkeleton />
          <ProfileGridSkeleton />
        </ScrollView>
      )}

      <ProfileSwitcher
        visible={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        onAddProfile={() => router.push('/create-profile')}
      />

      <Sheet visible={createOpen} onClose={() => setCreateOpen(false)} title="Create">
        <SheetRow
          label="New project"
          hint="A build, install or finished job, with the people and products behind it."
          onPress={() => {
            setCreateOpen(false);
            router.push(PROJECT_CREATE_ROUTE);
          }}
        />
        {canAddProduct ? (
          <SheetRow
            label="Add a product"
            hint="A catalog item people can save and projects can Link."
            onPress={() => {
              setCreateOpen(false);
              router.push(PRODUCT_CREATE_ROUTE);
            }}
          />
        ) : null}
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
  },
  list: {
    flexGrow: 1,
    backgroundColor: color.bg,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: space.sm,
  },
  action: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    backgroundColor: color.bg,
  },
});
