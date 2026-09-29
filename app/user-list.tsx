import React, { useState, useCallback, useMemo } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../store/AppContext.native';
import {
  useFollowState,
  useToggleFollow,
  useCurrentProfile,
  useFollowersQuery,
  useFollowingQuery,
} from '../features/profiles';
import { usePostLikersQuery, usePostRepostersQuery } from '../features/posts';
import { Button, EmptyState, ListRow, Skeleton } from '../components/native/ui';
import { followButton, userListEmptyTitle, type UserListType } from '../lib/screens/profile';
import { color, space } from '../theme/tokens';
import type { SimpleUser } from '../types';

/** Placeholder rows while the list loads. */
const SKELETON_ROWS = 8;

/** A ListRow-shaped placeholder. */
const RowSkeleton: React.FC = () => (
  <View style={styles.skeletonRow}>
    <Skeleton circle height={40} />
    <View style={styles.skeletonText}>
      <Skeleton width={140} height={12} />
      <Skeleton width={90} height={10} style={styles.skeletonGap} />
    </View>
  </View>
);

export default function UserListScreen() {
  const { type, userId, postId, title } = useLocalSearchParams<{
    type: UserListType;
    userId?: string;
    postId?: string;
    title: string;
  }>();
  const router = useRouter();
  const { isUserBlocked } = useApp();
  const { profileId } = useCurrentProfile();
  const { isFollowing: isUserFollowing, isRequested: isUserRequested } = useFollowState(profileId);
  const follow = useToggleFollow(profileId);

  // One list, read through its own query; the other three stay idle.
  const lists = {
    followers: useFollowersQuery(type === 'followers' ? userId : undefined),
    following: useFollowingQuery(type === 'following' ? userId : undefined),
    likes: usePostLikersQuery(type === 'likes' ? postId : undefined),
    reposts: usePostRepostersQuery(type === 'reposts' ? postId : undefined),
  };
  const list = lists[type] as (typeof lists)[UserListType] | undefined;
  const users = useMemo(() => list?.data ?? [], [list?.data]);
  const loading = list?.isLoading ?? false;
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await list?.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [list]);

  // The optimistic toggle flips the cache immediately, so there is no per-row
  // pending state to keep (ONE-15).
  const handleToggleFollow = useCallback(
    (user: SimpleUser) =>
      follow.toggle({ userId: user.id, username: user.username, isPrivate: Boolean(user.isPrivate) }),
    [follow],
  );

  const filteredUsers = useMemo(() => {
    const seen = new Set<string>();
    const uniqueUsers: SimpleUser[] = [];

    for (const user of users) {
      if (isUserBlocked(user.username)) continue;

      const key = user.id || user.username;
      if (seen.has(key)) continue;

      seen.add(key);
      uniqueUsers.push(user);
    }

    return uniqueUsers;
  }, [users, isUserBlocked]);

  const renderItem = useCallback(
    ({ item }: { item: SimpleUser }) => {
      const button = followButton(isUserFollowing(item.username), isUserRequested(item.username));
      const isSelf = Boolean(profileId && item.id === profileId);

      return (
        <ListRow
          title={item.name || item.username}
          subtitle={`@${item.username}`}
          avatarUri={item.avatar}
          verified={item.isVerified}
          onPress={() => router.push(`/user/${item.username}`)}
          accessibilityLabel={`View ${item.username}'s profile`}
          // You cannot follow yourself: your own row has no button.
          trailing={
            isSelf ? null : (
              <Button
                size="sm"
                variant={button.variant}
                onPress={() => handleToggleFollow(item)}
                disabled={follow.isPending}
              >
                {button.label}
              </Button>
            )
          }
        />
      );
    },
    [handleToggleFollow, isUserFollowing, isUserRequested, follow.isPending, router, profileId],
  );

  const keyExtractor = useCallback((item: SimpleUser) => item.id || item.username, []);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: (title as string) || 'People' }} />
      {loading ? (
        <View>
          {Array.from({ length: SKELETON_ROWS }, (_, i) => <RowSkeleton key={i} />)}
        </View>
      ) : (
        <FlatList
          data={filteredUsers}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={color.textMuted}
              colors={[color.textMuted]}
            />
          }
          ListEmptyComponent={<EmptyState title={userListEmptyTitle(type)} />}
          contentContainerStyle={styles.list}
        />
      )}
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
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  skeletonText: {
    marginLeft: space.md,
  },
  skeletonGap: {
    marginTop: space.sm,
  },
});
