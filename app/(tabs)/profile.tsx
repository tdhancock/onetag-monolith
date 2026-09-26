import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../store/AppContext.native';
import { useFollowCountsQuery, profileKeys, useCurrentProfile } from '../../features/profiles';
import { useRealtimeSync } from '../../lib/realtimeBridge';
import { getUserPosts, getUserReposts } from '../../features/profiles';
import { getSavedPosts } from '../../features/posts';
import ProfileHeader, { ProfileHeaderSkeleton } from '../../components/native/ProfileHeader';
import ProfileTabs from '../../components/native/ProfileTabs';
import ProfileSwitcher, { ProfileSwitcherButton } from '../../components/native/ProfileSwitcher';
import { GridTile, ProfileGridSkeleton } from '../../components/native/ProfileGrid';
import { Button, EmptyState, IconButton } from '../../components/native/ui';
import { MenuIcon, TagIcon } from '../../components/native/Icons';
import {
  getEditButtonProps,
  profileEmptyState,
  profileTabsFor,
  PROFILE_GRID_COLUMNS,
  type ProfileTab,
} from '../../lib/screens/profile';
import { tagCreateRoute, TAGS_DASHBOARD_ROUTE } from '../../lib/screens/tags';
import { color, space } from '../../theme/tokens';
import type { Post } from '../../types';

// ─── Profile Screen ──────────────────────────────

export default function ProfileScreen() {
  const { addToast } = useApp();
  const { profile: userProfile, profileId } = useCurrentProfile();
  const queryClient = useQueryClient();

  // Follow counts come from the query the follow toggle moves optimistically
  // (ONE-15), so following someone updates this screen without a refetch.
  const { data: followCounts } = useFollowCountsQuery(profileId);
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<ProfileTab>('posts');
  const [posts, setPosts] = useState<Post[]>([]);
  const [reposts, setReposts] = useState<Post[]>([]);
  // The posts on the Saved tab, not the viewer's set of saved ids — that
  // moved onto the cached post as `isSaved` in ONE-13.
  const [savedTabPosts, setSavedTabPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  // The profile these lists were asked for. A switch mid-fetch must not let
  // the previous profile's answer land under the new one's header.
  const requestedFor = useRef(profileId);

  const fetchAll = useCallback(async () => {
    if (!profileId) return;
    requestedFor.current = profileId;
    try {
      const [userPosts, userReposts, userSaved] = await Promise.all([
        getUserPosts(profileId),
        getUserReposts(profileId),
        getSavedPosts(profileId),
      ]);
      if (requestedFor.current !== profileId) return;
      setPosts(userPosts);
      setReposts(userReposts);
      setSavedTabPosts(userSaved);
    } catch (error) {
      console.error('Profile fetch error:', error);
      addToast('Failed to load profile data', 'error');
    } finally {
      if (requestedFor.current === profileId) setIsLoading(false);
    }
  }, [profileId]);

  // A new identity — the first load, or a switch in the profile switcher —
  // starts from the loading state rather than showing the previous profile's
  // grid under the new header (ONE-25).
  useEffect(() => {
    setIsLoading(true);
    setPosts([]);
    setReposts([]);
    setSavedTabPosts([]);
    fetchAll();
  }, [fetchAll]);

  // Realtime, through the shared bridge (ONE-16).
  useRealtimeSync({
    table: 'posts',
    filter: `user_id=eq.${profileId ?? ''}`,
    queryKey: profileKeys.posts(profileId ?? ''),
    enabled: Boolean(profileId),
    onInsert: () => { fetchAll(); return true; },
    onUpdate: () => { fetchAll(); return true; },
    onDelete: () => { fetchAll(); return true; },
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Pull-to-refresh re-reads this screen's lists and everything cached
      // about profiles — the header, the counts, follow state. It used to go
      // through a refresh-everything call on AppContext, which re-synced the session
      // and invalidated every query in the app (ONE-20).
      await Promise.all([
        fetchAll(),
        queryClient.invalidateQueries({ queryKey: profileKeys.all }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [fetchAll, queryClient]);

  const currentData = activeTab === 'posts' ? posts : activeTab === 'reposts' ? reposts : savedTabPosts;

  const handlePostPress = useCallback((post: Post) => {
    router.push(`/post/${post.id}`);
  }, [router]);

  const renderItem = useCallback(({ item, index }: { item: Post; index: number }) => (
    <GridTile post={item} index={index} onPress={() => handlePostPress(item)} />
  ), [handlePostPress]);

  if (!userProfile) return null;

  const editButton = getEditButtonProps(userProfile);
  const empty = profileEmptyState(activeTab, true);

  // A bar of its own above the header: the profile you are acting as, which
  // opens the switcher (ONE-25), its Tags (ONE-34), and Settings.
  const topBar = (
    <View style={styles.topBar}>
      <ProfileSwitcherButton profile={userProfile} onPress={() => setSwitcherOpen(true)} />
      <View style={styles.topBarActions}>
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
        stats={{ posts: posts.length, followers: followCounts?.followers, following: followCounts?.following }}
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
      <ProfileTabs tabs={profileTabsFor(true)} selected={activeTab} onSelect={setActiveTab} />
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {topBar}
      <FlatList
        data={isLoading ? [] : currentData}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        numColumns={PROFILE_GRID_COLUMNS}
        ListHeaderComponent={isLoading ? <ProfileHeaderSkeleton /> : header}
        ListEmptyComponent={
          isLoading ? (
            <ProfileGridSkeleton />
          ) : (
            <EmptyState
              title={empty.title}
              body={empty.body}
              action={empty.action ? { label: empty.action.label, onPress: () => router.push(empty.action!.target) } : undefined}
            />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={color.textMuted}
            colors={[color.textMuted]}
          />
        }
        contentContainerStyle={styles.list}
      />

      <ProfileSwitcher
        visible={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        onAddProfile={() => router.push('/create-profile')}
      />
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
