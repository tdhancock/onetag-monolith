import React, { useCallback, useState } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../store/AppContext.native';
import {
  useApproveFollowRequest,
  useCurrentProfile,
  useDeclineFollowRequest,
  useFollowRequestsQuery,
  type FollowRequest,
} from '../features/profiles';
import { Button, EmptyState, ListRow, Skeleton } from '../components/native/ui';
import { color, space } from '../theme/tokens';

/** Placeholder rows while the list loads. */
const SKELETON_ROWS = 6;

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

/**
 * The requests waiting on the active profile's approval, newest first
 * (ONE-63). Reached from the top of Notifications, and from a follow_request
 * notification or its push.
 */
export default function FollowRequestsScreen() {
  const router = useRouter();
  const { addToast } = useApp();
  const { profileId } = useCurrentProfile();
  const query = useFollowRequestsQuery(profileId);
  const approve = useApproveFollowRequest(profileId);
  const decline = useDeclineFollowRequest(profileId);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [query]);

  // Each row leaves the list the moment it is answered, and comes back if the
  // server refuses.
  const { mutate: approveRequest } = approve;
  const { mutate: declineRequest } = decline;
  const onApprove = useCallback(
    (request: FollowRequest) =>
      approveRequest(request.id, {
        onError: () => addToast(`Couldn't approve @${request.requester.username}. Try again.`, 'error'),
      }),
    [approveRequest, addToast],
  );
  const onDecline = useCallback(
    (request: FollowRequest) =>
      declineRequest(request.id, {
        onError: () => addToast(`Couldn't decline @${request.requester.username}. Try again.`, 'error'),
      }),
    [declineRequest, addToast],
  );

  const renderItem = useCallback(
    ({ item }: { item: FollowRequest }) => (
      <ListRow
        title={item.requester.name}
        subtitle={`@${item.requester.username}`}
        avatarUri={item.requester.avatar}
        verified={item.requester.isVerified}
        onPress={() => router.push(`/user/${item.requester.username}`)}
        accessibilityLabel={`View ${item.requester.username}'s profile`}
        trailing={
          <View style={styles.actions}>
            <Button size="sm" onPress={() => onApprove(item)} accessibilityLabel={`Approve @${item.requester.username}`}>
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onPress={() => onDecline(item)}
              accessibilityLabel={`Decline @${item.requester.username}`}
            >
              Decline
            </Button>
          </View>
        }
      />
    ),
    [onApprove, onDecline, router],
  );

  const renderBody = () => {
    if (query.isPending) {
      return (
        <View>
          {Array.from({ length: SKELETON_ROWS }, (_, i) => <RowSkeleton key={i} />)}
        </View>
      );
    }

    if (query.isError && !query.data) {
      return (
        <EmptyState
          title="Couldn't load follow requests"
          body="Check your connection and try again."
          action={{ label: 'Retry', onPress: () => void query.refetch() }}
        />
      );
    }

    return (
      <FlatList
        data={query.data ?? []}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={color.textMuted}
            colors={[color.textMuted]}
          />
        }
        ListEmptyComponent={
          <EmptyState
            title="No follow requests"
            body="When someone asks to follow you, they'll show up here."
          />
        }
        contentContainerStyle={styles.list}
      />
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: 'Follow requests' }} />
      {renderBody()}
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
  actions: {
    flexDirection: 'row',
    gap: space.sm,
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
