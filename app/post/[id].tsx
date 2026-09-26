import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile } from '../../features/profiles';
import { usePostQuery } from '../../features/posts';
import { useCommentsQuery } from '../../features/comments';
import PostCard from '../../components/native/PostCard';
import PostSkeleton from '../../components/native/PostSkeleton';
import CommentRow from '../../components/native/CommentRow';
import { EmptyState } from '../../components/native/ui';
import { homeBackHeaderLeft } from '../../components/native/HomeBackButton';
import { useBackOrHome } from '../../lib/useBackOrHome';
import { commentsLinkLabel } from '../../lib/screens/postCard';
import { color, space, type } from '../../theme/tokens';

/** How many comments post detail shows inline before "View all". */
const INLINE_COMMENT_COUNT = 3;

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isUserBlocked } = useApp();
  const { profileId } = useCurrentProfile();

  // The post is read from the cache entry the like, repost and save toggles
  // and the comment mutations patch (ONE-13, ONE-14). Holding it in local
  // state instead left every one of them invisible on this screen. The viewer
  // id is what marks the post as liked, reposted or saved for this user.
  const postQuery = usePostQuery(id, profileId);
  const post = postQuery.data ?? null;
  const loading = postQuery.isPending;
  const [refreshing, setRefreshing] = useState(false);

  // The same query the comments screen reads, so opening it is instant.
  const commentsQuery = useCommentsQuery(post ? post.id : undefined);
  const firstComments = useMemo(
    () => (commentsQuery.data ?? []).filter(c => !isUserBlocked(c.username)).slice(0, INLINE_COMMENT_COUNT),
    [commentsQuery.data, isUserBlocked],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([postQuery.refetch(), commentsQuery.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  // A post can be the first screen, opened from a notification on a cold
  // start: Back then goes home rather than nowhere (ONE-90).
  const back = useBackOrHome();
  const header = <Stack.Screen options={{ headerShown: true, title: 'Post', headerLeft: homeBackHeaderLeft(back) }} />;

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <PostSkeleton />
      </SafeAreaView>
    );
  }

  // A missing post and a blocked author's post read the same: there is
  // nothing here for this viewer.
  if (!post || isUserBlocked(post.username)) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <EmptyState
          title="This post isn't available"
          body="It may have been deleted."
          action={{ label: 'Back', onPress: back.goBack }}
        />
      </SafeAreaView>
    );
  }

  const openComments = () => router.push(`/comments/${post.id}`);
  const viewAll = commentsLinkLabel(post.replies);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      {header}
      <ScrollView
        style={styles.screen}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={color.textMuted}
            colors={[color.textMuted]}
          />
        }
        contentContainerStyle={styles.content}
      >
        <PostCard
          post={post}
          detail
          onViewProfile={(username) => router.push(`/user/${username}`)}
          onViewComments={() => openComments()}
          onViewLikers={(postId) => router.push({ pathname: '/user-list', params: { type: 'likes', postId, title: 'Likes' } })}
          onViewReposters={(postId) => router.push({ pathname: '/user-list', params: { type: 'reposts', postId, title: 'Reposts' } })}
          onSharePost={(p) => router.push({ pathname: '/share-post', params: { id: p.id } })}
          onEditPost={(p) => router.push({ pathname: '/edit-post', params: { id: p.id } })}
        />

        {firstComments.length > 0 && (
          <View style={styles.comments}>
            {firstComments.map(comment => (
              <CommentRow
                key={comment.id}
                comment={comment}
                onViewProfile={(username) => router.push(`/user/${username}`)}
              />
            ))}
          </View>
        )}

        {/* Always a way into the conversation, even before anyone has spoken. */}
        <Pressable
          onPress={openComments}
          accessibilityRole="button"
          style={styles.viewAll}
        >
          <Text style={styles.viewAllText}>{viewAll ?? 'Add a comment'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
  },
  content: {
    flexGrow: 1,
    paddingBottom: space.xl,
  },
  comments: {
    paddingTop: space.xs,
  },
  viewAll: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  viewAllText: {
    fontFamily: type.bodyMedium,
    fontSize: 14,
    color: color.textMuted,
  },
});
