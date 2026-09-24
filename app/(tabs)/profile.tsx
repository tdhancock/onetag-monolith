

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../store/AppContext.native';
import { useFollowCountsQuery, profileKeys } from '../../features/profiles';
import { useRealtimeSync } from '../../lib/realtimeBridge';
import {
  getUserPosts,
  getUserReposts,
  getFollowerCount,
  getFollowingCount,
} from '../../features/profiles';
import { getSavedPosts } from '../../features/posts';
import { supabase } from '../../services/supabase.native';
import UserAvatar from '../../components/native/UserAvatar';
import RenderUserContent from '../../components/native/RenderUserContent';
import { VerifiedIcon, ThreeDotsVerticalIcon } from '../../components/native/Icons';
import PostSkeleton from '../../components/native/PostSkeleton';
import type { Post } from '../../types';

const GRID_GAP = 2;
const NUM_COLUMNS = 3;
const screenWidth = Dimensions.get('window').width;
const tileSize = (screenWidth - GRID_GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

type TabType = 'posts' | 'reposts' | 'saved';

// ─── Grid Tile ───────────────────────────────────

const GridTile: React.FC<{ post: Post; onPress: () => void }> = React.memo(({ post, onPress }) => {
  const isTextPost = post.media_type === 'text' || !post.media;

  return (
    <Pressable
      onPress={onPress}
      style={{ width: tileSize, height: tileSize, marginRight: GRID_GAP, marginBottom: GRID_GAP }}
    >
      {isTextPost ? (
        <View className="flex-1 p-2 justify-center bg-gray-800">
          <Text className="text-white text-xs" numberOfLines={6}>
            {post.content}
          </Text>
        </View>
      ) : (
        <Image
          source={{ uri: post.media_preview_url || post.media }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          transition={200}
        />
      )}
    </Pressable>
  );
});

// ─── Profile Screen ──────────────────────────────

export default function ProfileScreen() {
  const { userProfile, addToast } = useApp();
  const queryClient = useQueryClient();

  // Follow counts come from the query the follow toggle moves optimistically
  // (ONE-15), so following someone updates this screen without a refetch.
  const { data: followCounts } = useFollowCountsQuery(userProfile?.id || undefined);
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<TabType>('posts');
  const [posts, setPosts] = useState<Post[]>([]);
  const [reposts, setReposts] = useState<Post[]>([]);
  // The posts on the Saved tab, not the viewer's set of saved ids — that
  // moved onto the cached post as `isSaved` in ONE-13.
  const [savedTabPosts, setSavedTabPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!userProfile?.id) return;
    try {
      const [userPosts, userReposts, userSaved] = await Promise.all([
        getUserPosts(userProfile.id),
        getUserReposts(userProfile.id),
        getSavedPosts(userProfile.id),
      ]);
      setPosts(userPosts);
      setReposts(userReposts);
      setSavedTabPosts(userSaved);
    } catch (error) {
      console.error('Profile fetch error:', error);
      addToast('Failed to load profile data', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [userProfile?.id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Realtime, through the shared bridge (ONE-16).
  useRealtimeSync({
    table: 'posts',
    filter: `user_id=eq.${userProfile?.id ?? ''}`,
    queryKey: profileKeys.posts(userProfile?.id ?? ''),
    enabled: Boolean(userProfile?.id),
    onInsert: () => { fetchAll(); return true; },
    onUpdate: () => { fetchAll(); return true; },
    onDelete: () => { fetchAll(); return true; },
  });

  // Two streams rather than one client-side check over every follow in the
  // system: a follow of this user, and a follow made by them.
  useRealtimeSync({
    table: 'follows',
    filter: `followed_id=eq.${userProfile?.id ?? ''}`,
    queryKey: profileKeys.counts(userProfile?.id ?? ''),
    enabled: Boolean(userProfile?.id),
  });

  useRealtimeSync({
    table: 'follows',
    filter: `follower_id=eq.${userProfile?.id ?? ''}`,
    queryKey: profileKeys.counts(userProfile?.id ?? ''),
    enabled: Boolean(userProfile?.id),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Pull-to-refresh re-reads this screen's lists and everything cached
      // about profiles — the header, the counts, follow state. It used to go
      // through a refresh-everything call on AppContext, which re-synced the session
      // and invalidated every query in the app (ONE-20).
      await Promise.all([
        fetchAll(),
        queryClient.invalidateQueries({ queryKey: profileKeys.all }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [fetchAll, queryClient]);

  const currentData = activeTab === 'posts' ? posts : activeTab === 'reposts' ? reposts : savedTabPosts;

  const handlePostPress = useCallback((post: Post) => {
    router.push(`/post/${post.id}`);
  }, []);

  if (!userProfile) return null;

  // ─── Profile Header ────────────────────────────

  const ProfileHeader = () => (
    <View>
      <View className="px-4 py-3 border-b border-gray-800 flex-row justify-between items-center">
        <Text className="text-white font-bold text-xl">@{userProfile.username}</Text>
        <Pressable
          onPress={() => router.push('/settings')}
          className="p-2"
          hitSlop={8}
          accessibilityLabel="Settings"
        >
          <ThreeDotsVerticalIcon color="#fff" size={22} />
        </Pressable>
      </View>

      <View className="p-4">
        <View className="flex-row items-center">
          <UserAvatar
            username={userProfile.username}
            avatarUrl={userProfile.profilePicture}
            size={80}
          />
          <View className="flex-1 flex-row justify-around ml-4">
            <View className="items-center">
              <Text className="text-white font-bold text-lg">{posts.length}</Text>
              <Text className="text-gray-500 text-sm">Posts</Text>
            </View>
            <Pressable
              onPress={() => router.push({ pathname: '/user-list', params: { type: 'followers', userId: userProfile.id, title: 'Followers' } })}
              className="items-center"
            >
              <Text className="text-white font-bold text-lg">{followCounts?.followers ?? 0}</Text>
              <Text className="text-gray-500 text-sm">Followers</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push({ pathname: '/user-list', params: { type: 'following', userId: userProfile.id, title: 'Following' } })}
              className="items-center"
            >
              <Text className="text-white font-bold text-lg">{followCounts?.following ?? 0}</Text>
              <Text className="text-gray-500 text-sm">Following</Text>
            </Pressable>
          </View>
        </View>

        <View className="mt-4">
          <View className="flex-row items-center" style={{ gap: 4 }}>
            <Text className="text-white text-xl font-bold">@{userProfile.username}</Text>
            {userProfile.isVerified && <VerifiedIcon color="#3b82f6" size={18} />}
          </View>
          <Text className="text-gray-400">{userProfile.name}</Text>
          {userProfile.bio ? (
            <View className="mt-2">
              <RenderUserContent content={userProfile.bio} className="text-white" />
            </View>
          ) : null}
        </View>

        <Pressable
          onPress={() => router.push('/settings')}
          className="mt-4 bg-gray-800 py-2 rounded-full items-center"
        >
          <Text className="text-white font-semibold">Edit Profile</Text>
        </Pressable>
      </View>

      {/* Tabs */}
      <View className="flex-row border-b border-gray-800">
        {(['posts', 'reposts', 'saved'] as TabType[]).map(tab => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
            className={`flex-1 py-3 items-center ${activeTab === tab ? 'border-b-2 border-white' : ''}`}
          >
            <Text className={`font-semibold capitalize ${activeTab === tab ? 'text-white' : 'text-gray-500'}`}>
              {tab}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  // ─── Render ────────────────────────────────────

  const renderItem = useCallback(({ item }: { item: Post }) => (
    <GridTile post={item} onPress={() => handlePostPress(item)} />
  ), [handlePostPress]);

  const emptyMessage = activeTab === 'posts'
    ? 'No posts yet.'
    : activeTab === 'reposts'
    ? "You haven't reposted anything yet."
    : "You haven't saved any posts yet.";

  return (
    <SafeAreaView className="flex-1 bg-black">
      <FlatList
        data={currentData}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        numColumns={NUM_COLUMNS}
        ListHeaderComponent={ProfileHeader}
        ListEmptyComponent={
          isLoading ? (
            <View className="py-4">
              <PostSkeleton />
              <PostSkeleton />
            </View>
          ) : (
            <View className="py-20 items-center">
              <Text className="text-gray-500 text-lg">{emptyMessage}</Text>
            </View>
          )
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
        }
        contentContainerStyle={{ flexGrow: 1 }}
      />
    </SafeAreaView>
  );
}
