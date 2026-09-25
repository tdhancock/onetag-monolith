// The accounts you have blocked, and the only place to undo one.
//
// Before ONE-54 a block was a username in AsyncStorage with no screen behind
// it: once blocked, an account was invisible to you with no way to find it
// again. The list is a server query now, so it is the same on every device
// you sign in on.

import React from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCurrentProfile } from '../features/profiles';
import { useBlocksQuery, useBlockToggle, type BlockedUser } from '../features/blocks';
import { Button, EmptyState, ListRow, Skeleton } from '../components/native/ui';
import { color, space } from '../theme/tokens';

/** Placeholder rows while the list loads. */
const SKELETON_ROWS = 5;

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

export default function BlockedUsersScreen() {
  // Blocks are account-level: a person blocks a person (ONE-21).
  const { authUserId: blockerId } = useCurrentProfile();

  const { data: blockedUsers, isPending, isError, refetch } = useBlocksQuery(blockerId);
  const blockToggle = useBlockToggle(blockerId);

  const renderItem = ({ item }: { item: BlockedUser }) => (
    <ListRow
      title={item.name || item.username}
      subtitle={`@${item.username}`}
      avatarUri={item.avatarUrl}
      divider
      trailing={
        <Button
          size="sm"
          variant="outline"
          onPress={() => blockToggle.toggle(item)}
          disabled={blockToggle.isPending}
          accessibilityLabel={`Unblock ${item.username}`}
        >
          Unblock
        </Button>
      }
    />
  );

  const renderBody = () => {
    if (isPending && blockerId) {
      return (
        <View>
          {Array.from({ length: SKELETON_ROWS }, (_, i) => <RowSkeleton key={i} />)}
        </View>
      );
    }

    if (isError) {
      return (
        <EmptyState
          title="Couldn't load your blocked accounts"
          body="Check your connection and try again."
          action={{ label: 'Retry', onPress: () => void refetch() }}
        />
      );
    }

    return (
      <FlatList
        data={blockedUsers ?? []}
        keyExtractor={(item) => item.userId}
        renderItem={renderItem}
        ListEmptyComponent={
          <EmptyState
            title="You haven't blocked anyone"
            body="Blocked accounts cannot message you or comment on your posts."
          />
        }
        contentContainerStyle={styles.list}
      />
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: 'Blocked accounts' }} />
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
