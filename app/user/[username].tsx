import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FlatList, RefreshControl, Alert, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../store/AppContext.native';
import { useFollowState, useToggleFollow, useFollowCountsQuery, profileKeys, useCurrentProfile } from '../../features/profiles';
import { useRealtimeSync } from '../../lib/realtimeBridge';
import { getUserProfile, getUserPosts, getUserReposts } from '../../features/profiles';
import { setUserVerified, useIsAdmin } from '../../features/admin';
import { useAuthUserId } from '../../features/auth';
import { reportUser } from '../../features/moderation';
import { REPORT_REASONS } from '../../services/reportReasons';
import ProfileHeader, { ProfileHeaderSkeleton } from '../../components/native/ProfileHeader';
import ProfileTabs from '../../components/native/ProfileTabs';
import ScanHistorySection from '../../components/native/ScanHistorySection';
import { GridTile, ProfileGridSkeleton } from '../../components/native/ProfileGrid';
import { Button, EmptyState, IconButton, Sheet, SheetRow } from '../../components/native/ui';
import { BlockIcon, LockClosedIcon, DotsHorizontalIcon, ReportIcon, VerifiedIcon } from '../../components/native/Icons';
import {
  isProfileLocked,
  profileEmptyState,
  profileTabsFor,
  PROFILE_GRID_COLUMNS,
  type ProfileTab,
} from '../../lib/screens/profile';
import { color } from '../../theme/tokens';
import type { Post, UserProfile as UserProfileType } from '../../types';

export default function UserProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    isUserBlocked,
    toggleBlockUser,
    addToast,
  } = useApp();
  const { profile: myProfile, profileId } = useCurrentProfile();
  // Admin is a property of the account, read from `is_admin()` (ONE-20).
  const isAdmin = useIsAdmin(useAuthUserId());

  // Follow state and the counts are queries (ONE-15): the button and the
  // follower number move together the moment it is tapped, and revert
  // together if the server refuses.
  const { isFollowing: isUserFollowing } = useFollowState(profileId);
  const follow = useToggleFollow(profileId);

  const [profile, setProfile] = useState<UserProfileType | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [reposts, setReposts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTab>('posts');
  const [menuVisible, setMenuVisible] = useState(false);
  // The report reasons are the menu's second step, in the same sheet.
  const [showReport, setShowReport] = useState(false);

  const { data: followCounts } = useFollowCountsQuery(profile?.id || undefined);
  const isFollowing = isUserFollowing(username || '');
  const isBlocked = isUserBlocked(username || '');
  const isMyProfile = myProfile?.username === username;

  // A private profile the viewer does not follow comes back from the server
  // with no posts — RLS hides them. Say why, rather than "No posts yet"
  // (ONE-58).
  const isLocked = isProfileLocked({
    isPrivate: profile?.isPrivate,
    isOwnProfile: isMyProfile,
    isFollowing,
    isAdmin,
  });

  const fetchData = useCallback(async () => {
    if (!username) return;
    try {
      const profileData = await getUserProfile(username);
      setProfile(profileData);
      if (profileData) {
        const [userPosts, userReposts] = await Promise.all([
          getUserPosts(profileData.id),
          getUserReposts(profileData.id),
        ]);
        setPosts(userPosts);
        setReposts(userReposts);
      }
    } catch (error) {
      console.error('Failed to load user profile', error);
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Following a private profile is what lets its posts through RLS, so the
  // grid re-reads when follow state changes on one (ONE-58).
  const wasFollowing = useRef(isFollowing);
  useEffect(() => {
    if (wasFollowing.current === isFollowing) return;
    wasFollowing.current = isFollowing;
    if (profile?.isPrivate && !isMyProfile) fetchData();
  }, [isFollowing, profile?.isPrivate, isMyProfile, fetchData]);

  // Realtime follow counts, through the shared bridge (ONE-16). Two streams
  // rather than one subscription to every follow in the system: followers of
  // this profile, and the people it follows.
  useRealtimeSync({
    table: 'follows',
    filter: `followed_id=eq.${profile?.id ?? ''}`,
    queryKey: profileKeys.counts(profile?.id ?? ''),
    enabled: Boolean(profile?.id),
  });

  useRealtimeSync({
    table: 'follows',
    filter: `follower_id=eq.${profile?.id ?? ''}`,
    queryKey: profileKeys.counts(profile?.id ?? ''),
    enabled: Boolean(profile?.id),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const handleToggleFollow = useCallback(() => {
    if (!username || !profile?.id || isMyProfile) return;
    follow.toggle({ userId: profile.id, username });
  }, [username, profile?.id, isMyProfile, follow]);

  const handleBlockToggle = () => {
    setMenuVisible(false);
    if (isBlocked) {
      toggleBlockUser(username || '');
      addToast(`@${username} has been unblocked.`, 'success');
    } else {
      Alert.alert(
        `Block @${username}?`,
        "They won't be able to find your profile, posts, or story, and they won't be notified.",
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Block',
            style: 'destructive',
            onPress: () => {
              toggleBlockUser(username || '');
              addToast(`@${username} has been blocked.`, 'info');
            },
          },
        ],
      );
    }
  };

  const handleReport = async (reason: string) => {
    setShowReport(false);
    setMenuVisible(false);
    if (!profile?.id) {
      addToast('Unable to report — user not loaded.', 'error');
      return;
    }
    if (!profileId) return;
    const success = await reportUser(profileId, profile.id, reason);
    if (success) {
      addToast('Report submitted. Thank you for your feedback.', 'success');
    } else {
      addToast('Failed to submit report. Please try again.', 'error');
    }
  };

  const handleToggleVerify = async () => {
    setMenuVisible(false);
    if (!profile) return;
    try {
      setProfile(prev => prev ? { ...prev, isVerified: !prev.isVerified } : null);
      await setUserVerified(profile.id, !profile.isVerified);
      addToast(`User ${profile.isVerified ? 'unverified' : 'verified'} successfully.`, 'success');
    } catch (error) {
      setProfile(prev => prev ? { ...prev, isVerified: !prev.isVerified } : null);
      addToast('Error updating verification status.', 'error');
    }
  };

  const handlePostPress = useCallback((post: Post) => {
    router.push(`/post/${post.id}`);
  }, [router]);

  const currentData = activeTab === 'posts' ? posts : reposts;
  const renderItem = useCallback(({ item, index }: { item: Post; index: number }) => (
    <GridTile post={item} index={index} onPress={() => handlePostPress(item)} />
  ), [handlePostPress]);

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={color.textMuted}
      colors={[color.textMuted]}
    />
  );

  const closeMenu = () => {
    setMenuVisible(false);
    setShowReport(false);
  };

  // Loading: the header's and the grid's shapes, under the handle.
  if (loading && !profile) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <Stack.Screen options={{ headerShown: true, title: `@${username}` }} />
        <ProfileHeaderSkeleton />
        <ProfileGridSkeleton />
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <Stack.Screen options={{ headerShown: true, title: 'Profile' }} />
        <EmptyState
          title="This profile doesn't exist"
          body={`There's no one called @${username}.`}
          action={{ label: 'Back', onPress: () => router.back() }}
        />
      </SafeAreaView>
    );
  }

  const actions = isMyProfile ? null : isBlocked ? (
    <Button variant="outline" size="sm" fullWidth onPress={handleBlockToggle}>
      Unblock
    </Button>
  ) : (
    <>
      <Button
        variant={isFollowing ? 'outline' : 'primary'}
        size="sm"
        onPress={handleToggleFollow}
        disabled={follow.isPending}
        style={styles.action}
      >
        {isFollowing ? 'Following' : 'Follow'}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onPress={() => router.push(`/messages?chatWith=${username}`)}
        style={styles.action}
      >
        Message
      </Button>
    </>
  );

  const header = (
    <>
      <ProfileHeader
        profile={profile}
        stats={{ posts: posts.length, followers: followCounts?.followers, following: followCounts?.following }}
        onPressFollowers={() => router.push({ pathname: '/user-list', params: { type: 'followers', userId: profile.id, title: 'Followers' } })}
        onPressFollowing={() => router.push({ pathname: '/user-list', params: { type: 'following', userId: profile.id, title: 'Following' } })}
        actions={actions}
      />
      {/* Their public scan history, only if they made it public (ONE-35);
          absent otherwise, with no placeholder. */}
      {isBlocked ? null : <ScanHistorySection profile={profile} />}
      {/* Blocked and private profiles show why there is nothing to see, in
          place of the tabs and the grid. */}
      {isBlocked ? (
        <EmptyState
          icon={<BlockIcon color={color.textMuted} size={40} strokeWidth={1.6} />}
          title={`You blocked @${username}`}
          body="They can't see your posts or find your profile."
        />
      ) : isLocked ? (
        <EmptyState
          icon={<LockClosedIcon color={color.textMuted} size={40} strokeWidth={1.6} />}
          title="This account is private"
          body={`Follow @${username} to see their posts.`}
        />
      ) : (
        <ProfileTabs tabs={profileTabsFor(false)} selected={activeTab} onSelect={setActiveTab} />
      )}
    </>
  );

  const empty = profileEmptyState(activeTab, false);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: `@${username}`,
          headerRight: () =>
            !isMyProfile ? (
              <IconButton
                icon={<DotsHorizontalIcon color={color.text} size={20} />}
                accessibilityLabel="Profile options"
                onPress={() => setMenuVisible(true)}
              />
            ) : null,
        }}
      />

      <FlatList
        data={isBlocked || isLocked ? [] : currentData}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        numColumns={PROFILE_GRID_COLUMNS}
        ListHeaderComponent={header}
        ListEmptyComponent={
          isBlocked || isLocked ? null : loading ? (
            <ProfileGridSkeleton />
          ) : (
            <EmptyState title={empty.title} body={empty.body} />
          )
        }
        refreshControl={refreshControl}
        contentContainerStyle={styles.list}
      />

      <Sheet
        visible={menuVisible}
        onClose={closeMenu}
        title={showReport ? 'Why are you reporting this user?' : undefined}
        onBack={showReport ? () => setShowReport(false) : undefined}
      >
        {showReport ? (
          REPORT_REASONS.map(reason => (
            <SheetRow key={reason} label={reason} onPress={() => handleReport(reason)} />
          ))
        ) : (
          <>
            <SheetRow
              label="Report User"
              destructive
              chevron
              icon={<ReportIcon color={color.heart} size={20} />}
              onPress={() => setShowReport(true)}
            />
            <SheetRow
              label={isBlocked ? 'Unblock' : 'Block'}
              destructive={!isBlocked}
              icon={<BlockIcon color={isBlocked ? color.text : color.heart} size={20} />}
              onPress={handleBlockToggle}
            />
            {isAdmin ? (
              <SheetRow
                label={profile.isVerified ? 'Unverify Account' : 'Verify Account'}
                icon={<VerifiedIcon color={color.text} size={20} />}
                onPress={() => { void handleToggleVerify(); }}
              />
            ) : null}
          </>
        )}
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
  action: {
    flex: 1,
  },
});
