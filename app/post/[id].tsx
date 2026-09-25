

import React, { useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile } from '../../features/profiles';
import { usePostQuery } from '../../features/posts';
import PostCard from '../../components/native/PostCard';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isUserBlocked } = useApp();
  const { profile: userProfile, profileId } = useCurrentProfile();

  // The post is read from the cache entry the like, repost and save toggles
  // and the comment mutations patch (ONE-13, ONE-14). Holding it in local
  // state instead left every one of them invisible on this screen. The viewer
  // id is what marks the post as liked, reposted or saved for this user.
  const postQuery = usePostQuery(id, profileId);
  const post = postQuery.data ?? null;
  const loading = postQuery.isPending;
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await postQuery.refetch();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-black">
        <Stack.Screen
          options={{
            headerShown: true,
            title: 'Post',
            headerStyle: { backgroundColor: '#000' },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: 'bold' },
          }}
        />
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator color="#3b82f6" size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView className="flex-1 bg-black">
        <Stack.Screen
          options={{
            headerShown: true,
            title: 'Post',
            headerStyle: { backgroundColor: '#000' },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: 'bold' },
          }}
        />
        <View className="flex-1 justify-center items-center">
          <Text className="text-gray-400 text-lg">Post not found.</Text>
          <Text className="text-gray-600 text-sm mt-2">
            It may have been deleted or is no longer available.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isUserBlocked(post.username)) {
    return (
      <SafeAreaView className="flex-1 bg-black">
        <Stack.Screen
          options={{
            headerShown: true,
            title: 'Post',
            headerStyle: { backgroundColor: '#000' },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: 'bold' },
          }}
        />
        <View className="flex-1 justify-center items-center">
          <Text className="text-gray-400 text-lg">This post is unavailable.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-black">
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Post',
          headerStyle: { backgroundColor: '#000' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      />
      <ScrollView
        className="flex-1"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
        }
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <PostCard
          post={post}
          onViewProfile={(username) => router.push(`/user/${username}`)}
          onViewComments={(postId) => router.push(`/comments/${postId}`)}
          onViewLikers={(postId) => router.push({ pathname: '/user-list', params: { type: 'likes', postId, title: 'Likes' } })}
          onViewReposters={(postId) => router.push({ pathname: '/user-list', params: { type: 'reposts', postId, title: 'Reposts' } })}
          onSharePost={(p) => router.push({ pathname: '/share-post', params: { id: p.id } })}
          onEditPost={(p) => router.push({ pathname: '/edit-post', params: { id: p.id } })}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
