// The accounts you have blocked, and the only place to undo one.
//
// Before ONE-54 a block was a username in AsyncStorage with no screen behind
// it: once blocked, an account was invisible to you with no way to find it
// again. The list is a server query now, so it is the same on every device
// you sign in on.

import React from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../store/AppContext.native';
import { useBlocksQuery, useBlockToggle, type BlockedUser } from '../features/blocks';
import UserAvatar from '../components/native/UserAvatar';
import { ArrowLeftIcon } from '../components/native/Icons';

export default function BlockedUsersScreen() {
  const router = useRouter();
  const { userProfile } = useApp();
  const blockerId = userProfile.id || undefined;

  const { data: blockedUsers, isPending, isError, refetch } = useBlocksQuery(blockerId);
  const blockToggle = useBlockToggle(blockerId);

  const renderItem = ({ item }: { item: BlockedUser }) => (
    <View className="flex-row items-center px-4 py-3">
      <UserAvatar username={item.username} avatarUrl={item.avatarUrl} size={48} />

      <View className="flex-1 ml-3">
        <Text className="text-white text-base font-semibold">@{item.username}</Text>
        {item.name ? <Text className="text-gray-500 text-sm">{item.name}</Text> : null}
      </View>

      <Pressable
        onPress={() => blockToggle.toggle(item)}
        disabled={blockToggle.isPending}
        accessibilityLabel={`Unblock ${item.username}`}
        className="px-4 py-2 rounded-full border border-gray-700"
      >
        <Text className="text-white text-sm font-semibold">Unblock</Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View className="flex-row items-center px-4 py-3 border-b border-gray-800">
        <Pressable onPress={() => router.back()} accessibilityLabel="Go back" hitSlop={8}>
          <ArrowLeftIcon color="#ffffff" size={24} />
        </Pressable>
        <Text className="text-white text-lg font-bold ml-3">Blocked Accounts</Text>
      </View>

      {isPending && blockerId ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#ffffff" />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-gray-400 text-center mb-4">
            Could not load your blocked accounts.
          </Text>
          <Pressable onPress={() => refetch()} className="px-4 py-2 rounded-full border border-gray-700">
            <Text className="text-white text-sm font-semibold">Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={blockedUsers ?? []}
          keyExtractor={(item) => item.userId}
          renderItem={renderItem}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center px-8 pt-24">
              <Text className="text-gray-400 text-center">
                You have not blocked anyone.
              </Text>
              <Text className="text-gray-600 text-center text-sm mt-2">
                Blocked accounts cannot message you or comment on your posts.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
