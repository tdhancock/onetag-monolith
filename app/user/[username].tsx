import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshControl, Alert, ScrollView, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../store/AppContext.native';
import {
  useFollowState,
  useToggleFollow,
  useFollowCountsQuery,
  useProfilePostCountQuery,
  profileKeys,
  useCurrentProfile,
} from '../../features/profiles';
import { useRealtimeSync } from '../../lib/realtimeBridge';
import { getUserProfile } from '../../features/profiles';
import { setUserVerified, useIsAdmin } from '../../features/admin';
import { useAuthUserId } from '../../features/auth';
import { reportUser } from '../../features/moderation';
import { REPORT_REASONS } from '../../services/reportReasons';
import ProfileHeader, { ProfileHeaderSkeleton } from '../../components/native/ProfileHeader';
import ProfileTabs from '../../components/native/ProfileTabs';
import ProfileTabList from '../../components/native/ProfileTabList';
import { ProfileGridSkeleton } from '../../components/native/ProfileGrid';
import { Button, EmptyState, IconButton, Sheet, SheetRow } from '../../components/native/ui';
import { homeBackHeaderLeft } from '../../components/native/HomeBackButton';
import { useBackOrHome } from '../../lib/useBackOrHome';
import { BlockIcon, LockClosedIcon, DotsHorizontalIcon, ReportIcon, VerifiedIcon } from '../../components/native/Icons';
import { isProfileLocked, profileTabsFor, type ProfileTab } from '../../lib/screens/profile';
import { color } from '../../theme/tokens';
import type { UserProfile as UserProfileType } from '../../types';

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
  // A tag for a profile lands here alone on the stack: Back then goes home
  // rather than nowhere (ONE-90).
  const back = useBackOrHome();
  const headerLeft = homeBackHeaderLeft(back);
  // Admin is a property of the account, read from `is_admin()` (ONE-20).
  const isAdmin = useIsAdmin(useAuthUserId());

  // Follow state and the counts are queries (ONE-15): the button and the
  // follower number move together the moment it is tapped, and revert
  // together if the server refuses.
  const { isFollowing: isUserFollowing } = useFollowState(profileId);
  const follow = useToggleFollow(profileId);

  const [profile, setProfile] = useState<UserProfileType | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTab, setSelectedTab] = useState<ProfileTab | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  // The report reasons are the menu's second step, in the same sheet.
  const [showReport, setShowReport] = useState(false);

  const { data: followCounts } = useFollowCountsQuery(profile?.id || undefined);
  // A count for the header, never the posts: the first tab may not be them.
  const { data: postCount } = useProfilePostCountQuery(profile?.id || undefined);
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

  // The profile itself. Each tab reads its own content once it is opened
  // (ONE-43), so nothing here fetches posts.
  const fetchData = useCallback(async () => {
    if (!username) return;
    try {
      setProfile(await getUserProfile(username));
    } catch (error) {
      console.error('Failed to load user profile', error);
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Following a private profile is what lets its posts through RLS, so its
  // posts — and their count, which sits beneath them — are read again when
  // follow state changes on one (ONE-58).
  const wasFollowing = useRef(isFollowing);
  useEffect(() => {
    if (wasFollowing.current === isFollowing) return;
    wasFollowing.current = isFollowing;
    if (profile?.isPrivate && !isMyProfile) {
      void queryClient.invalidateQueries({ queryKey: profileKeys.posts(profile.id) });
    }
  }, [isFollowing, profile?.isPrivate, profile?.id, isMyProfile, queryClient]);

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

  // What the header shows, re-read on pull to refresh: the profile and its
  // counts. The open tab re-reads its own list.
  const refreshHeader = useCallback(
    () =>
      Promise.all([
        fetchData(),
        profile ? queryClient.invalidateQueries({ queryKey: profileKeys.counts(profile.id) }) : undefined,
        profile ? queryClient.invalidateQueries({ queryKey: profileKeys.postCount(profile.id) }) : undefined,
      ]),
    [fetchData, profile, queryClient],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshHeader();
    setRefreshing(false);
  }, [refreshHeader]);

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
        <Stack.Screen options={{ headerShown: true, title: `@${username}`, headerLeft }} />
        <ProfileHeaderSkeleton />
        <ProfileGridSkeleton />
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <Stack.Screen options={{ headerShown: true, title: 'Profile', headerLeft }} />
        <EmptyState
          title="This profile doesn't exist"
          body={`There's no one called @${username}.`}
          action={{ label: 'Back', onPress: back.goBack }}
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

  const tabs = profileTabsFor({
    profileType: profile.profileType,
    isOwnProfile: isMyProfile,
    scanHistoryPublic: profile.scanHistoryPublic,
  });
  const tab = selectedTab && tabs.includes(selectedTab) ? selectedTab : tabs[0]!;
  const showsTabs = !isBlocked && !isLocked;

  const header = (
    <>
      <ProfileHeader
        profile={profile}
        stats={{ posts: postCount, followers: followCounts?.followers, following: followCounts?.following }}
        onPressFollowers={() => router.push({ pathname: '/user-list', params: { type: 'followers', userId: profile.id, title: 'Followers' } })}
        onPressFollowing={() => router.push({ pathname: '/user-list', params: { type: 'following', userId: profile.id, title: 'Following' } })}
        actions={actions}
      />
      {/* Blocked and private profiles show why there is nothing to see, in
          place of the tabs and their content. */}
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
        <ProfileTabs tabs={tabs} selected={tab} onSelect={setSelectedTab} />
      )}
    </>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: `@${username}`,
          headerLeft,
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

      {showsTabs ? (
        // Their Scan History is a tab only while they made it public (ONE-35),
        // and Saves never are one here: absent, not locked.
        <ProfileTabList
          key={profile.id}
          tab={tab}
          profile={profile}
          isOwnProfile={isMyProfile}
          header={header}
          onRefreshHeader={refreshHeader}
        />
      ) : (
        <ScrollView refreshControl={refreshControl} contentContainerStyle={styles.list}>
          {header}
        </ScrollView>
      )}

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
