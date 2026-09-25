import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, SectionList, RefreshControl, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCurrentProfile, useFollowState, useToggleFollow } from '../features/profiles';
import { useNotificationsQuery, useMarkAllRead } from '../features/notifications';
import { Avatar, Button, EmptyState, MonoLabel, Pressable, Skeleton } from '../components/native/ui';
import { getTimeAgo } from '../lib/timeAgo';
import { firstLine } from '../lib/screens/profile';
import { groupNotifications, notificationSentence } from '../lib/screens/notifications';
import { color, space, type } from '../theme/tokens';
import type { Notification } from '../types';

/** Placeholder rows while the list loads. */
const SKELETON_ROWS = 7;
const THUMBNAIL_SIZE = 44;

/** A stored image the thumbnail can draw; a OneSnap's SVG stand-in is not one. */
const drawable = (url: string | null | undefined): url is string =>
  typeof url === 'string' && url.length > 0 && !url.startsWith('data:image/svg+xml');

/** The square on the right of a post-related row: the photo, or a text post's first line. */
const Thumbnail: React.FC<{ notification: Notification }> = ({ notification }) => {
  const { post, story } = notification;
  if (post) {
    if (post.media_type === 'image' && drawable(post.media)) {
      return <Image source={{ uri: post.media }} style={styles.thumbnail} contentFit="cover" />;
    }
    return (
      <View style={[styles.thumbnail, styles.textThumbnail]}>
        <Text style={styles.textThumbnailCopy} numberOfLines={3}>
          {firstLine(post.content)}
        </Text>
      </View>
    );
  }
  if (story && drawable(story.media_url)) {
    return <Image source={{ uri: story.media_url }} style={styles.thumbnail} contentFit="cover" />;
  }
  return null;
};

/** A notification-shaped placeholder. */
const RowSkeleton: React.FC = () => (
  <View style={styles.row}>
    <Skeleton circle height={40} />
    <View style={styles.body}>
      <Skeleton width="85%" height={12} />
      <Skeleton width="45%" height={12} style={styles.skeletonGap} />
    </View>
  </View>
);

export default function NotificationsScreen() {
  const { profileId } = useCurrentProfile();
  const router = useRouter();
  const { isFollowing } = useFollowState(profileId);
  const follow = useToggleFollow(profileId);

  const query = useNotificationsQuery(profileId);
  const notifications = query.data;
  const markAllRead = useMarkAllRead(profileId);
  const [refreshing, setRefreshing] = useState(false);

  // Which rows were unread when this visit began. They keep a dot for the
  // visit even though they are marked read on open, as before (ONE-17): the
  // ids are captured from the first list, before the mutation fires.
  const unreadAtOpen = useRef<Set<string> | null>(null);
  if (unreadAtOpen.current === null && notifications) {
    unreadAtOpen.current = new Set(notifications.filter(n => !n.is_read).map(n => n.id));
  }

  // Opening the screen marks everything read, once the list has settled so
  // the unread ids above were captured first. The rows and the tab badge
  // change together, and revert together if the server refuses.
  const { mutate: markAll } = markAllRead;
  const marked = useRef(false);
  useEffect(() => {
    if (!profileId || marked.current || query.isPending) return;
    marked.current = true;
    markAll();
  }, [profileId, query.isPending, markAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await query.refetch();
      markAll();
    } finally {
      setRefreshing(false);
    }
  }, [query, markAll]);

  const handlePress = useCallback((n: Notification) => {
    if (n.type === 'follow') {
      router.push(`/user/${n.sender.username}`);
    } else if (n.post) {
      router.push(`/post/${n.post.id}`);
    }
  }, [router]);

  const sections = useMemo(() => groupNotifications(notifications ?? []), [notifications]);

  const renderItem = useCallback(({ item }: { item: Notification }) => {
    const unread = unreadAtOpen.current?.has(item.id) ?? false;
    const time = getTimeAgo(item.created_at);
    const followsBack = item.type === 'follow' && isFollowing(item.sender.username);

    return (
      <Pressable
        onPress={() => handlePress(item)}
        accessibilityRole="button"
        accessibilityLabel={`${unread ? 'New. ' : ''}${item.sender.username} ${notificationSentence(item.type)} ${time}`}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {/* Leading edge: a dot for rows that arrived since the last visit. */}
        <View style={styles.dotSlot}>{unread ? <View style={styles.dot} /> : null}</View>
        <Avatar uri={item.sender.avatar_url} name={item.sender.username} size={40} />
        <View style={styles.body}>
          <Text style={styles.sentence}>
            <Text style={styles.sender}>{item.sender.username}</Text>
            {' '}
            {notificationSentence(item.type)}
            {time ? <Text style={styles.time}>{` ${time}`}</Text> : null}
          </Text>
        </View>
        {item.type === 'follow' ? (
          <Button
            size="sm"
            variant={followsBack ? 'outline' : 'primary'}
            onPress={() => follow.toggle({ userId: item.sender.id, username: item.sender.username })}
            disabled={follow.isPending}
          >
            {followsBack ? 'Following' : 'Follow'}
          </Button>
        ) : (
          <Thumbnail notification={item} />
        )}
      </Pressable>
    );
  }, [handlePress, isFollowing, follow]);

  const renderBody = () => {
    if (query.isPending) {
      return (
        <View>
          {Array.from({ length: SKELETON_ROWS }, (_, i) => <RowSkeleton key={i} />)}
        </View>
      );
    }

    if (query.isError && !notifications) {
      return (
        <EmptyState
          title="Couldn't load notifications"
          body="Check your connection and try again."
          action={{ label: 'Retry', onPress: () => void query.refetch() }}
        />
      );
    }

    return (
      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <MonoLabel color="textMid">{section.title}</MonoLabel>
          </View>
        )}
        stickySectionHeadersEnabled={false}
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
            title="You're all caught up"
            body="Likes, follows and comments will show up here."
          />
        }
        contentContainerStyle={styles.list}
      />
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: 'Notifications' }} />
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
    paddingBottom: space.lg,
  },
  sectionHeader: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.sm,
    backgroundColor: color.bg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingRight: space.lg,
    paddingVertical: space.sm,
    backgroundColor: color.bg,
  },
  pressed: {
    backgroundColor: color.bgSub,
  },
  // The dot's own gutter, so every avatar still starts on the lg edge.
  dotSlot: {
    width: space.lg,
    alignItems: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: color.text,
  },
  body: {
    flex: 1,
    marginHorizontal: space.md,
  },
  sentence: {
    fontFamily: type.body,
    fontSize: 15,
    lineHeight: 21,
    color: color.text,
  },
  sender: {
    fontFamily: type.bodyBold,
  },
  time: {
    color: color.textMuted,
  },
  thumbnail: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    backgroundColor: color.bgPanel,
  },
  textThumbnail: {
    justifyContent: 'center',
    padding: space.xs,
  },
  textThumbnailCopy: {
    fontFamily: type.body,
    fontSize: 12,
    lineHeight: 14,
    color: color.text,
  },
  skeletonGap: {
    marginTop: space.sm,
  },
});
