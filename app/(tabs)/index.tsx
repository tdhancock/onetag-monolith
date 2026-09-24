

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useApp } from '../../store/AppContext.native';
import { useFollowState, useToggleFollow, profileKeys } from '../../features/profiles';
import { useRealtimeSync } from '../../lib/realtimeBridge';
import { useUnreadNotificationCount } from '../../features/notifications';
import {
  getStories,
  getSmartUserSuggestions,
} from '../../services/apiService';
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
import StoryReel, { StoryGroup } from '../../components/native/StoryReel';
import StoryCreator from '../../components/native/StoryCreator';
import UserAvatar from '../../components/native/UserAvatar';
import { VerifiedIcon, BellIcon, SendIcon } from '../../components/native/Icons';
import type { Post, Story, SimpleUser } from '../../types';
import { tokens } from '../../theme/tokens';

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
    userProfile,
    isUserBlocked,
    addToast,
    unreadMessageCount,
  } = useApp();

  // Follow state is a query now (ONE-15), shared with every other screen that
  // renders a Follow button.
  const { following, isFollowing: isUserFollowing } = useFollowState(userProfile?.id || undefined);
  const follow = useToggleFollow(userProfile?.id || undefined);
  const router = useRouter();
  const unreadNotificationCount = useUnreadNotificationCount(userProfile?.id || undefined);

  const queryClient = useQueryClient();
  const [storyGroups, setStoryGroups] = useState<StoryGroup[]>([]);
  const [allStories, setAllStories] = useState<Story[]>([]);
  const allStoriesRef = useRef<Story[]>([]);
  const [suggestedUsers, setSuggestedUsers] = useState<SimpleUser[]>([]);
  const [isStoriesLoading, setIsStoriesLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ─── Feed ──────────────────────────────────────
  // Page state belongs to the query, not to this component and not to a
  // module-level cursor, so a second mount starts from the top on its own.
  const feedQuery = useFeedQuery(userProfile?.id);
  const feedKey = postKeys.feed(userProfile?.id ?? '');

  // Blocked authors are filtered here rather than inside the query, so the
  // cache holds what the server returned and `getNextPageParam` measures a
  // full page. Filtering before that measurement is what used to end
  // pagination early whenever a page contained a blocked author.
  const posts = useMemo(
    () => feedPosts(feedQuery.data).filter(post => !isUserBlocked(post.username)),
    [feedQuery.data, isUserBlocked],
  );

  const isFeedLoading = Boolean(userProfile?.id) && feedQuery.isPending;
  const isLoading = isFeedLoading || isStoriesLoading;

  const loadSuggestions = useCallback(async (userId: string) => {
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

  const applyStoriesState = useCallback((stories: Story[]) => {
    const filteredStories = stories.filter(story => !isUserBlocked(story.username));
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

    setStoryGroups(Array.from(groups.values()));
    setAllStories(feedStories);
    allStoriesRef.current = feedStories;
  }, [isUserBlocked, userProfile?.username]);

  const refreshStories = useCallback(async () => {
    try {
      const stories = await getStories();
      // Only update if we got stories OR if we had stories before (don't clear transiently)
      if (stories.length > 0 || allStoriesRef.current.length === 0) {
        applyStoriesState(stories);
      }
    } catch (error) {
      console.error('Story refresh error:', error);
    }
  }, [applyStoriesState]);

  const loadStories = useCallback(async () => {
    try {
      applyStoriesState(await getStories());
    } catch (error) {
      console.error('Story load error:', error);
    } finally {
      setIsStoriesLoading(false);
    }
  }, [applyStoriesState]);

  useEffect(() => {
    void loadStories();
  }, [loadStories]);

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
  // screen re-uses it rather than leaking a new one per mount.
  useRealtimeSync({
    table: 'stories',
    filter: '',
    queryKey: ['stories'],
    onInsert: () => { void refreshStories(); return true; },
    onUpdate: () => { void refreshStories(); return true; },
    onDelete: () => { void refreshStories(); return true; },
  });

  // Server-side filtering rather than the client-side check this replaced:
  // the old subscription received every follow in the system and discarded
  // the ones that were not the viewer's.
  useRealtimeSync({
    table: 'follows',
    filter: `follower_id=eq.${userProfile?.id ?? ''}`,
    queryKey: profileKeys.all,
    enabled: Boolean(userProfile?.id),
    onInsert: () => { void refreshStories(); return true; },
    onDelete: () => { void refreshStories(); return true; },
  });

  useEffect(() => {
    if (!userProfile?.id || isLoading) return;
    const hasFollows = following.length > 0;
    if (posts.length === 0 && !hasFollows) {
      void loadSuggestions(userProfile.id);
    } else if (suggestedUsers.length > 0) {
      setSuggestedUsers([]);
    }
  }, [following, isLoading, loadSuggestions, posts.length, suggestedUsers.length, userProfile?.id]);

  // Realtime edits land in the query cache — the list is the query's data
  // now, so there is no local array to fold them into. ONE-16 generalizes
  // this bridge across domains.
  const handlePostUpdates = useCallback(async (payload: any) => {
    if (!userProfile?.id) return;

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
  }, [isUserBlocked, queryClient, feedKey, userProfile?.id]);

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
      await Promise.all([feedQuery.refetch(), loadStories()]);
    } finally {
      setRefreshing(false);
    }
  }, [feedQuery, loadStories]);

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

  const ListHeader = useCallback(() => {
    return (
      <View>
        {/* Stories section — compact, Instagram-style (no title) */}
        <View className="py-2 border-b border-gray-800">
          <View className="flex-row px-2">
            <StoryCreator
              onAddStory={handleAddStory}
              onViewStories={handleViewStories}
            />
            {storyGroups.length > 0 && (
              <StoryReel
                storyGroups={storyGroups}
                allStories={allStories}
                onViewStories={handleViewStories}
              />
            )}
          </View>
        </View>
      </View>
    );
  }, [storyGroups, allStories, isLoading, handleAddStory, handleViewStories]);

  const ListEmpty = useCallback(() => {
    if (isLoading) return null;

    const hasFollows = following.length > 0;

    return (
      <View className="items-center mt-20 px-4">
        {hasFollows ? (
          <>
            <Text className="text-gray-400 text-lg text-center">
              No posts yet
            </Text>
            <Text className="text-gray-600 text-sm text-center mt-2">
              The people you follow haven't posted anything yet. Check back later!
            </Text>
          </>
        ) : (
          <>
            <Text className="text-gray-400 text-lg text-center">
              Welcome to OneTag!
            </Text>
            <Text className="text-gray-600 text-sm text-center mt-2">
              Follow users to build your feed.
            </Text>

            {suggestedUsers.length > 0 && (
              <View className="w-full mt-6">
                <Text className="text-white font-semibold mb-3 px-1">Suggested for you</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {suggestedUsers.map(user => {
                    const isFollowing = isUserFollowing(user.username);
                    return (
                      <View key={user.id} className="w-36 bg-gray-900 rounded-xl p-3 mr-3">
                        <Pressable
                          onPress={() => handleViewProfile(user.username)}
                          className="items-center"
                        >
                          <UserAvatar username={user.username} avatarUrl={user.avatar} size={56} />
                          <View className="flex-row items-center mt-2" style={{ gap: 4 }}>
                            <Text className="text-white font-semibold" numberOfLines={1}>
                              @{user.username}
                            </Text>
                            {user.isVerified && <VerifiedIcon color="#3b82f6" size={14} />}
                          </View>
                        </Pressable>

                        <Pressable
                          onPress={() => follow.toggle({ userId: user.id, username: user.username })}
                          className={`mt-3 py-2 rounded-full items-center ${isFollowing ? 'bg-gray-800' : 'bg-blue-600'}`}
                        >
                          <Text className="text-white text-sm font-semibold">
                            {isFollowing ? 'Following' : 'Follow'}
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            )}
          </>
        )}
      </View>
    );
  }, [isLoading, following, suggestedUsers, isUserFollowing, follow, handleViewProfile]);

  const ListFooter = useCallback(() => {
    if (!feedQuery.isFetchingNextPage) return null;
    return (
      <View className="py-6">
        <ActivityIndicator color="#3b82f6" />
      </View>
    );
  }, [feedQuery.isFetchingNextPage]);

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-black">
        <View className="px-4 py-2 border-b border-gray-800 flex-row justify-between items-center">
          <Text style={{ fontFamily: tokens.type.bodyBold }} className="text-2xl text-white">
            OneTag
          </Text>
          <View className="flex-row items-center" style={{ gap: 16 }}>
            <Pressable onPress={() => router.push('/notifications')} className="relative">
              <BellIcon color="#e5e7eb" size={24} />
              {unreadNotificationCount > 0 && (
                <View className="absolute -top-1 -right-1 bg-red-500 rounded-full w-4 h-4 items-center justify-center">
                  <Text className="text-white text-[10px] font-bold">{unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}</Text>
                </View>
              )}
            </Pressable>
            <Pressable onPress={() => router.push('/messages')} className="relative">
              <SendIcon color="#e5e7eb" size={22} />
              {unreadMessageCount > 0 && (
                <View className="absolute -top-1 -right-2 bg-red-500 rounded-full w-4 h-4 items-center justify-center">
                  <Text className="text-white text-[10px] font-bold">{unreadMessageCount > 9 ? '9+' : unreadMessageCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>
        <PostSkeleton />
        <PostSkeleton />
        <PostSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-black">
      <View className="px-4 py-2 border-b border-gray-800 flex-row justify-between items-center">
        <Text style={{ fontFamily: tokens.type.bodyBold }} className="text-2xl text-white">
          OneTag
        </Text>
        <View className="flex-row items-center" style={{ gap: 16 }}>
          <Pressable onPress={() => router.push('/notifications')} className="relative">
            <BellIcon color="#e5e7eb" size={24} />
            {unreadNotificationCount > 0 && (
              <View className="absolute -top-1 -right-1 bg-red-500 rounded-full w-4 h-4 items-center justify-center">
                <Text className="text-white text-[10px] font-bold">{unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}</Text>
              </View>
            )}
          </Pressable>
          <Pressable onPress={() => router.push('/messages')} className="relative">
            <SendIcon color="#e5e7eb" size={22} />
            {unreadMessageCount > 0 && (
              <View className="absolute -top-1 -right-2 bg-red-500 rounded-full w-4 h-4 items-center justify-center">
                <Text className="text-white text-[10px] font-bold">{unreadMessageCount > 9 ? '9+' : unreadMessageCount}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

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
            tintColor="#3b82f6"
            colors={['#3b82f6']}
          />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        initialNumToRender={5}
        maxToRenderPerBatch={8}
        windowSize={7}
      />
    </SafeAreaView>
  );
}
