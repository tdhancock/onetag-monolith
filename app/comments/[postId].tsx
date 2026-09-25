

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { formatDistanceToNow } from 'date-fns';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile } from '../../features/profiles';
import {
  useCommentsQuery,
  useCommentLikesQuery,
  useAddComment,
  useDeleteComment,
  useToggleCommentLike,
} from '../../features/comments';
import { cleanHtml } from '../../lib/cleanHtml';
import UserAvatar from '../../components/native/UserAvatar';
import RenderUserContent from '../../components/native/RenderUserContent';
import { HeartIcon, TrashIcon } from '../../components/native/Icons';
import type { Comment } from '../../types';

const EMPTY_COMMENTS: Comment[] = [];

const removeCommentById = (comments: Comment[], idToRemove: string): Comment[] => {
  let changed = false;
  const next: Comment[] = [];

  for (const comment of comments) {
    if (comment.id === idToRemove) {
      changed = true;
      continue;
    }

    if (comment.replies && comment.replies.length > 0) {
      const updatedReplies = removeCommentById(comment.replies, idToRemove);
      if (updatedReplies !== comment.replies) {
        changed = true;
        next.push({ ...comment, replies: updatedReplies });
        continue;
      }
    }

    next.push(comment);
  }

  return changed ? next : comments;
};

// ─── Comment Item ─────────────────────────────

const CommentItem: React.FC<{
  comment: Comment;
  onDelete: (id: string) => void | Promise<void>;
  currentUserId?: string;
  currentUsername: string;
  currentAvatar?: string;
  onViewProfile: (username: string) => void;
}> = React.memo(({ comment, onDelete, currentUserId, currentUsername, onViewProfile }) => {
  const { triggerHapticFeedback } = useApp();
  const { profileId } = useCurrentProfile();

  // Likes are a query and an optimistic toggle (ONE-14). The double-tap
  // protection this screen used to hand-roll is the mutation's own pending
  // state now, so those 110 lines are gone.
  const { data: likes } = useCommentLikesQuery(comment.id, profileId);
  const likeHaptic = useCallback(() => triggerHapticFeedback(), [triggerHapticFeedback]);
  const like = useToggleCommentLike(profileId, likeHaptic);

  const isLiked = Boolean(likes?.isLiked);
  const likesCount = likes?.count ?? 0;

  const handleLike = () => like.toggle(comment.id);

  const canDelete = comment.userId
    ? comment.userId === currentUserId
    : comment.username === currentUsername;

  const rowContent = (
    <View className="px-4 py-3 border-b border-gray-800">
      <View className="flex-row" style={{ gap: 12 }}>
        <Pressable onPress={() => onViewProfile(comment.username)}>
          <UserAvatar username={comment.username} avatarUrl={comment.avatar} size={40} />
        </Pressable>
        <View className="flex-1">
          <Pressable onPress={() => onViewProfile(comment.username)}>
            <Text className="text-white">
              <Text className="font-bold">@{comment.username}</Text>
              {'  '}
              <Text className="text-gray-500 text-sm">
                {formatDistanceToNow(comment.timestamp, { addSuffix: true })}
              </Text>
            </Text>
          </Pressable>
          <View className="mt-1">
            <RenderUserContent content={comment.text} className="text-white" />
          </View>
          <View className="flex-row items-center mt-2" style={{ gap: 16 }}>
            <Pressable onPress={handleLike} className="flex-row items-center" style={{ gap: 4 }}>
              <HeartIcon color={isLiked ? '#ef4444' : '#6b7280'} size={16} liked={isLiked} />
              <Text className={`text-sm ${isLiked ? 'text-red-500' : 'text-gray-500'}`}>
                {likesCount}
              </Text>
            </Pressable>
            {canDelete && (
              <Pressable
                onPress={() => onDelete(comment.id)}
                className="flex-row items-center"
                style={{ gap: 4 }}
                hitSlop={8}
              >
                <TrashIcon color="#9ca3af" size={16} />
                <Text className="text-gray-500 text-sm">Delete</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </View>
  );

  if (!canDelete) return rowContent;

  return (
    <Swipeable
      overshootRight={false}
      rightThreshold={36}
      renderRightActions={() => (
        <Pressable
          onPress={() => onDelete(comment.id)}
          className="bg-red-600 justify-center items-center px-5"
        >
          <Text className="text-white font-semibold">Delete</Text>
        </Pressable>
      )}
    >
      {rowContent}
    </Swipeable>
  );
});

// ─── Comments Screen ──────────────────────────

export default function CommentsScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const { isUserBlocked, addToast } = useApp();
  const { profile: userProfile, profileId } = useCurrentProfile();
  const inputRef = useRef<TextInput>(null);

  const [newCommentText, setNewCommentText] = useState('');

  // One query, keyed by post. Two mounts in quick succession share a single
  // request because TanStack dedupes by key — which is what made the 209-line
  // fetch guard, its abort plumbing and its cooldown unnecessary (ONE-14).
  const { data: comments, isPending: loading } = useCommentsQuery(postId);
  const addCommentMutation = useAddComment();
  const deleteCommentMutation = useDeleteComment();

  // A blocked account's comments are filtered out of what is rendered; the
  // cache keeps the server's answer intact.
  const localComments = useMemo(() => {
    const filterBlocked = (list: Comment[]): Comment[] =>
      list
        .filter(c => !isUserBlocked(c.username))
        .map(c => ({ ...c, replies: c.replies ? filterBlocked(c.replies) : [] }));

    return filterBlocked(comments ?? EMPTY_COMMENTS);
  }, [comments, isUserBlocked]);

  const handleAddComment = () => {
    const text = newCommentText.trim();
    if (!text || !postId || addCommentMutation.isPending) return;

    setNewCommentText('');
    addCommentMutation.mutate({
      postId,
      text: cleanHtml(text),
      author: {
        id: profileId,
        username: userProfile?.username || '',
        avatar: userProfile?.profilePicture,
      },
    });
  };

  const handleDeleteComment = useCallback((commentId: string) => {
    if (!postId) return;

    deleteCommentMutation.mutate(
      { postId, commentId },
      {
        onError: (error) => {
          console.error('Failed to delete comment', error);
          addToast('Failed to delete comment.', 'error');
        },
      },
    );
  }, [addToast, deleteCommentMutation, postId]);

  const handleViewProfile = useCallback((username: string) => {
    router.push(`/user/${username}`);
  }, [router]);

  const renderItem = useCallback(
    ({ item }: { item: Comment }) => (
      <CommentItem
        comment={item}
        onDelete={handleDeleteComment}
        currentUserId={profileId}
        currentUsername={userProfile?.username || ''}
        currentAvatar={userProfile?.profilePicture || undefined}
        onViewProfile={handleViewProfile}
      />
    ),
    [handleDeleteComment, handleViewProfile, profileId, userProfile?.username],
  );

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['bottom']}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Comments',
          headerStyle: { backgroundColor: '#000' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {loading ? (
          <View className="flex-1 justify-center items-center">
            <ActivityIndicator color="#3b82f6" size="large" />
          </View>
        ) : (
          <FlatList
            data={localComments}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            ListEmptyComponent={
              <View className="py-20 items-center">
                <Text className="text-gray-500 text-lg text-center">
                  No comments yet. Be the first to comment!
                </Text>
              </View>
            }
            contentContainerStyle={{ flexGrow: 1 }}
          />
        )}

        {/* Comment input */}
        <View className="border-t border-gray-800 bg-black px-3 py-2">
          <View className="flex-row items-center" style={{ gap: 12 }}>
            <UserAvatar
              username={userProfile?.username || ''}
              avatarUrl={userProfile?.profilePicture}
              size={36}
            />
            <View className="flex-1 flex-row items-center bg-gray-800 rounded-full px-4">
              <TextInput
                ref={inputRef}
                value={newCommentText}
                onChangeText={setNewCommentText}
                placeholder="Add a comment..."
                placeholderTextColor="#6b7280"
                className="flex-1 text-white py-2"
                returnKeyType="send"
                onSubmitEditing={handleAddComment}
              />
            </View>
            <Pressable
              onPress={handleAddComment}
              disabled={!newCommentText.trim() || addCommentMutation.isPending}
            >
              <Text
                className={`font-semibold ${
                  newCommentText.trim() && !addCommentMutation.isPending
                    ? 'text-blue-500'
                    : 'text-gray-500'
                }`}
              >
                Post
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
