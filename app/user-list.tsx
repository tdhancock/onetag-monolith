import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../store/AppContext.native';
import { useFollowState, useToggleFollow, useCurrentProfile } from '../features/profiles';
import { getFollowerUsers, getFollowingUsers } from '../features/profiles';
import { getPostLikers, getPostReposters } from '../features/posts';
import { Button, EmptyState, ListRow, Skeleton } from '../components/native/ui';
import { userListEmptyTitle, type UserListType } from '../lib/screens/profile';
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
  const { isFollowing: isUserFollowing } = useFollowState(profileId);
  const follow = useToggleFollow(profileId);

  const [users, setUsers] = useState<SimpleUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchUsers = useCallback(async (): Promise<SimpleUser[]> => {
    if (type === 'followers' && userId) return getFollowerUsers(userId);
    if (type === 'following' && userId) return getFollowingUsers(userId);
    if (type === 'likes' && postId) return getPostLikers(postId);
    if (type === 'reposts' && postId) return getPostReposters(postId);
    return [];
  }, [type, userId, postId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchUsers()
      .then((result) => { if (!cancelled) setUsers(result); })
      .catch((err) => console.error('Failed to fetch user list:', err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fetchUsers]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setUsers(await fetchUsers());
    } catch (err) {
      console.error('Failed to refresh user list:', err);
    } finally {
      setRefreshing(false);
    }
  }, [fetchUsers]);

  // The optimistic toggle flips the cache immediately, so there is no per-row
  // pending state to keep (ONE-15).
  const handleToggleFollow = useCallback(
    (user: SimpleUser) => follow.toggle({ userId: user.id, username: user.username }),
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
      const isFollowing = isUserFollowing(item.username);
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
                variant={isFollowing ? 'outline' : 'primary'}
                onPress={() => handleToggleFollow(item)}
                disabled={follow.isPending}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </Button>
            )
          }
        />
      );
    },
    [handleToggleFollow, isUserFollowing, follow.isPending, router, profileId],
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
