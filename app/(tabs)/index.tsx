import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useApp } from '../../store/AppContext.native';
import { useFollowState, useToggleFollow, profileKeys, getSmartUserSuggestions, useCurrentProfile, type ProfileId } from '../../features/profiles';
import { useRealtimeSync } from '../../lib/realtimeBridge';
import { useUnreadNotificationCount } from '../../features/notifications';
import { useUnreadMessageCount } from '../../features/messages';
import { useStoriesQuery, useStoriesRealtime, storyKeys } from '../../features/stories';
import { useQueryClient } from '@tanstack/react-query';
import {
  useFeedQuery,
  fetchPostById,
  feedPosts,
  prependPost,
  replacePost,
  removePost,
  postKeys,
} from '../../features/posts';
import type { FeedData } from '../../features/posts';
import { supabase } from '../../services/supabase.native';
import PostCard from '../../components/native/PostCard';
import PostSkeleton from '../../components/native/PostSkeleton';
import HomeHeader from '../../components/native/HomeHeader';
import StoryReel, { StoryGroup, StoryReelSkeleton } from '../../components/native/StoryReel';
import StoryCreator from '../../components/native/StoryCreator';
import { Avatar, Button, Card, EmptyState, MonoLabel } from '../../components/native/ui';
import { VerifiedIcon } from '../../components/native/Icons';
import {
  HOME_EXPLORE_TARGET,
  HOME_SUGGESTIONS_HEADING,
  getHomeEmptyState,
  getHomeHeaderTarget,
} from '../../lib/screens/home';
import type { Post, Story, SimpleUser } from '../../types';
import { color, space, type } from '../../theme/tokens';

const dedupeStoriesById = (stories: Story[]): Story[] => {
  const seen = new Set<string>();
  const unique: Story[] = [];
  for (const story of stories) {
    if (!story?.id || seen.has(story.id)) continue;
    seen.add(story.id);
    unique.push(story);
  }
  return unique;
};

export default function HomeFeedScreen() {
  const {
    isUserBlocked,
    addToast,
  } = useApp();
  const { profile: userProfile, profileId } = useCurrentProfile();

  // Follow state is a query now (ONE-15), shared with every other screen that
  // renders a Follow button.
  const { following, isFollowing: isUserFollowing } = useFollowState(profileId);
  const follow = useToggleFollow(profileId);
  const router = useRouter();
  const unreadNotificationCount = useUnreadNotificationCount(profileId);
  const unreadMessageCount = useUnreadMessageCount(profileId);

  const queryClient = useQueryClient();
  const [suggestedUsers, setSuggestedUsers] = useState<SimpleUser[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // The header is sticky rather than collapsing (ONE-66): it draws a hairline
  // once the feed has scrolled beneath it.
  const [scrolled, setScrolled] = useState(false);

  // ─── Feed ──────────────────────────────────────
  // Page state belongs to the query, not to this component and not to a
  // module-level cursor, so a second mount starts from the top on its own.
  const feedQuery = useFeedQuery(profileId);
  const feedKey = postKeys.feed(profileId ?? '');

  // Blocked authors are filtered here rather than inside the query, so the
  // cache holds what the server returned and `getNextPageParam` measures a
  // full page. Filtering before that measurement is what used to end
  // pagination early whenever a page contained a blocked author.
  const posts = useMemo(
    () => feedPosts(feedQuery.data).filter(post => !isUserBlocked(post.username)),
    [feedQuery.data, isUserBlocked],
  );

  const isFeedLoading = Boolean(profileId) && feedQuery.isPending;

  // ─── Stories ───────────────────────────────────
  // The reel is a query (ONE-19). A failed refetch keeps the last good reel
  // on screen, which is what the old "don't clear transiently" guard did by
  // hand.
  const reelQuery = useStoriesQuery(profileId);
  const isStoriesLoading = Boolean(profileId) && reelQuery.isPending;

  const { storyGroups, allStories } = useMemo(() => {
    const filteredStories = (reelQuery.data ?? []).filter(story => !isUserBlocked(story.username));
    const dedupedStories = dedupeStoriesById(filteredStories);
    const currentUsername = userProfile?.username?.trim().toLowerCase();
    const feedStories = currentUsername
      ? dedupedStories.filter(story => story.username.trim().toLowerCase() !== currentUsername)
      : dedupedStories;

    const groups = new Map<string, StoryGroup>();
    feedStories.forEach(story => {
      if (!groups.has(story.username)) {
        groups.set(story.username, {
          username: story.username,
          avatar: story.avatar,
          stories: [],
        });
      }
      groups.get(story.username)?.stories.push(story);
    });

    return { storyGroups: Array.from(groups.values()), allStories: feedStories };
  }, [reelQuery.data, isUserBlocked, userProfile?.username]);
  const isLoading = isFeedLoading || isStoriesLoading;

  const loadSuggestions = useCallback(async (userId: ProfileId) => {
    try {
      const suggestions = await getSmartUserSuggestions(userId);
      const mappedSuggestions: SimpleUser[] = (suggestions || [])
        .map((suggestion: any) => ({
          id: suggestion.suggested_user_id || suggestion.id || suggestion.username,
          username: suggestion.username || '',
          name: suggestion.username || 'OneTag user',
          avatar: suggestion.avatar_url || null,
          isVerified: Boolean(suggestion.is_verified),
        }))
        .filter((user: SimpleUser) => Boolean(user.username) && !isUserBlocked(user.username));
      setSuggestedUsers(mappedSuggestions);
    } catch (error) {
      console.error('Suggestion load error:', error);
      setSuggestedUsers([]);
    }
  }, [isUserBlocked]);

  // The feed used to toast from loadFeed's catch. The query owns retries now,
  // so the toast fires once the retries are exhausted rather than on the
  // first failure.
  useEffect(() => {
    if (feedQuery.isError) {
      console.error('Feed load error:', feedQuery.error);
      addToast('Failed to load feed', 'error');
    }
  }, [feedQuery.isError, feedQuery.error, addToast]);

  // Stories, follows and posts all arrive through the shared bridge now
  // (ONE-16). Each stream is one stably named channel, so remounting this
  // screen re-uses it rather than leaking a new one per mount. The stories
  // stream lives in features/stories since ONE-19.
  useStoriesRealtime();

  // Server-side filtering rather than the client-side check this replaced:
  // the old subscription received every follow in the system and discarded
  // the ones that were not the viewer's.
  useRealtimeSync({
    table: 'follows',
    filter: `follower_id=eq.${profileId ?? ''}`,
    queryKey: profileKeys.all,
    enabled: Boolean(profileId),
    // A new follow changes whose stories are in the reel.
    onInsert: () => { void queryClient.invalidateQueries({ queryKey: storyKeys.lists() }); return true; },
    onDelete: () => { void queryClient.invalidateQueries({ queryKey: storyKeys.lists() }); return true; },
  });

  useEffect(() => {
    if (!profileId || isLoading) return;
    const hasFollows = following.length > 0;
    if (posts.length === 0 && !hasFollows) {
      void loadSuggestions(profileId);
    } else if (suggestedUsers.length > 0) {
      setSuggestedUsers([]);
    }
  }, [following, isLoading, loadSuggestions, posts.length, suggestedUsers.length, profileId]);

  // Realtime edits land in the query cache — the list is the query's data
  // now, so there is no local array to fold them into. ONE-16 generalizes
  // this bridge across domains.
  const handlePostUpdates = useCallback(async (payload: any) => {
    if (!profileId) return;

    try {
      if (payload.eventType === 'DELETE') {
        const deletedId = payload.old?.id;
        if (!deletedId) return;
        queryClient.setQueryData(feedKey, (data: FeedData | undefined) =>
          removePost(data, deletedId),
        );
        return;
      }

      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const postId = payload.new?.id;
        if (!postId) return;
        const fullPost = await fetchPostById(postId);
        if (!fullPost || isUserBlocked(fullPost.username)) return;

        queryClient.setQueryData(feedKey, (data: FeedData | undefined) =>
          payload.eventType === 'INSERT'
            ? prependPost(data, fullPost)
            : replacePost(data, fullPost),
        );
      }
    } catch (error) {
      console.error('Realtime post handling error:', error);
    }
  }, [isUserBlocked, queryClient, feedKey, profileId]);

  useRealtimeSync({
    table: 'posts',
    filter: '',
    queryKey: postKeys.all,
    onInsert: (row) => { void handlePostUpdates({ eventType: 'INSERT', new: row }); return true; },
    onUpdate: (row) => { void handlePostUpdates({ eventType: 'UPDATE', new: row }); return true; },
    onDelete: (row) => { void handlePostUpdates({ eventType: 'DELETE', old: row }); return true; },
  });

  // Refetching an infinite query refetches every loaded page from the first
  // cursor, so the list rebuilds from the top without duplicating.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([feedQuery.refetch(), reelQuery.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }, [feedQuery, reelQuery]);

  const loadMore = useCallback(() => {
    // FlatList fires onEndReached more than once per arrival at the end; both
    // guards are what keep a page from being appended twice.
    if (!feedQuery.hasNextPage || feedQuery.isFetchingNextPage) return;
    void feedQuery.fetchNextPage();
  }, [feedQuery]);

  const handleViewProfile = useCallback((username: string) => {
    router.push(`/user/${username}`);
  }, [router]);

  const handleViewComments = useCallback((postId: string) => {
    router.push(`/comments/${postId}`);
  }, [router]);

  const handleViewStories = useCallback((stories: Story[], startIndex: number) => {
    const selectedStory = stories[startIndex];
    router.push({
      pathname: '/story-viewer',
      params: {
        index: String(startIndex),
        storyId: selectedStory?.id || '',
      },
    });
  }, [router]);

  const handleAddStory = useCallback(() => {
    router.push('/story-create');
  }, [router]);

  const renderPost = useCallback(({ item }: { item: Post }) => (
    <PostCard
      post={item}
      onViewProfile={handleViewProfile}
      onViewComments={handleViewComments}
      onViewLikers={(postId: string) => router.push({ pathname: '/user-list', params: { type: 'likes', postId, title: 'Likes' } })}
      onViewReposters={(postId: string) => router.push({ pathname: '/user-list', params: { type: 'reposts', postId, title: 'Reposts' } })}
      onSharePost={(post: Post) => router.push({ pathname: '/share-post', params: { id: post.id } })}
      onEditPost={(post: Post) => router.push({ pathname: '/edit-post', params: { id: post.id } })}
    />
  ), [handleViewProfile, handleViewComments, router]);

  const keyExtractor = useCallback((item: Post) => item.id, []);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Only crossing zero changes anything; React drops the same-value sets.
    setScrolled(event.nativeEvent.contentOffset.y > 0);
  }, []);

  // The OneSnap strip's slot: directly under the header, on white, with a
  // hairline beneath. The reel draws its own cards (ONE-67).
  const ListHeader = useCallback(() => (
    <View style={styles.strip}>
      <StoryReel
        storyGroups={storyGroups}
        allStories={allStories}
        onViewStories={handleViewStories}
        leading={<StoryCreator onAddStory={handleAddStory} onViewStories={handleViewStories} />}
      />
    </View>
  ), [storyGroups, allStories, handleAddStory, handleViewStories]);

  const ListEmpty = useCallback(() => {
    const state = getHomeEmptyState(isLoading, following.length > 0, feedQuery.isError);

    switch (state.kind) {
      case 'loading':
        return null;

      case 'error':
        return (
          <EmptyState
            title={state.title}
            body={state.body}
            action={{ label: state.action, onPress: () => void feedQuery.refetch() }}
          />
        );

      case 'following-no-posts':
        return (
          <EmptyState
            title={state.title}
            body={state.body}
            action={{ label: state.action, onPress: () => router.navigate(HOME_EXPLORE_TARGET) }}
          />
        );

      case 'new-user':
        return (
          <View>
            <EmptyState title={state.title} body={state.body} />
            {suggestedUsers.length > 0 && (
              <View style={styles.suggestions}>
                <MonoLabel color="textMid" style={styles.suggestionsHeading}>
                  {HOME_SUGGESTIONS_HEADING}
                </MonoLabel>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.suggestionRow}
                >
                  {suggestedUsers.map(user => {
                    const isFollowing = isUserFollowing(user.username);
                    return (
                      <Card
                        key={user.id}
                        padding="md"
                        onPress={() => handleViewProfile(user.username)}
                        style={styles.suggestionCard}
                      >
                        <View style={styles.suggestionBody}>
                          <Avatar uri={user.avatar} name={user.name} size={56} />
                          <View style={styles.suggestionName}>
                            <Text style={styles.suggestionNameText} numberOfLines={1}>
                              {user.name}
                            </Text>
                            {user.isVerified && <VerifiedIcon color={color.text} size={14} />}
                          </View>
                          <Text style={styles.suggestionHandle} numberOfLines={1}>
                            @{user.username}
                          </Text>
                        </View>
                        <Button
                          size="sm"
                          fullWidth
                          variant={isFollowing ? 'outline' : 'primary'}
                          onPress={() => follow.toggle({ userId: user.id, username: user.username })}
                        >
                          {isFollowing ? 'Following' : 'Follow'}
                        </Button>
                      </Card>
                    );
                  })}
                </ScrollView>
              </View>
            )}
          </View>
        );
    }
  }, [isLoading, following, feedQuery, suggestedUsers, isUserFollowing, follow, handleViewProfile, router]);

  const ListFooter = useCallback(() => {
    if (!feedQuery.isFetchingNextPage) return null;
    return (
      <View style={styles.nextPage}>
        <ActivityIndicator size="small" color={color.textMuted} />
      </View>
    );
  }, [feedQuery.isFetchingNextPage]);

  const header = (
    <HomeHeader
      notificationCount={unreadNotificationCount}
      messageCount={unreadMessageCount}
      scrolled={scrolled && !isLoading}
      onPressNotifications={() => router.push(getHomeHeaderTarget('notifications'))}
      onPressMessages={() => router.push(getHomeHeaderTarget('messages'))}
    />
  );

  // First load: the shape of the feed, not a centred spinner.
  if (isLoading) {
    return (
      <SafeAreaView edges={['top']} style={styles.screen}>
        {header}
        <View style={styles.strip}>
          <StoryReelSkeleton />
        </View>
        <PostSkeleton />
        <PostSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      {header}

      <FlatList
        data={posts}
        renderItem={renderPost}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={ListFooter}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={color.textMuted}
            colors={[color.textMuted]}
          />
        }
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        initialNumToRender={5}
        maxToRenderPerBatch={8}
        windowSize={7}
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
  strip: {
    paddingVertical: space.md,
    backgroundColor: color.bg,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  suggestions: {
    marginTop: -space.md,
  },
  suggestionsHeading: {
    paddingHorizontal: space.lg,
    marginBottom: space.md,
  },
  suggestionRow: {
    paddingHorizontal: space.lg,
    gap: space.sm,
  },
  suggestionCard: {
    width: 152,
  },
  suggestionBody: {
    alignItems: 'center',
    marginBottom: space.md,
  },
  suggestionName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.sm,
    maxWidth: '100%',
  },
  suggestionNameText: {
    flexShrink: 1,
    fontFamily: type.bodyBold,
    fontSize: 15,
    color: color.text,
  },
  suggestionHandle: {
    marginTop: 2,
    fontFamily: type.body,
    fontSize: 13,
    color: color.textMid,
  },
  nextPage: {
    paddingVertical: space.xl,
  },
});
