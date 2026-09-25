import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile } from '../../features/profiles';
import { useCommentsQuery, useAddComment, useDeleteComment } from '../../features/comments';
import { cleanHtml } from '../../lib/cleanHtml';
import CommentRow, { CommentRowSkeleton, COMMENT_AVATAR_SIZE } from '../../components/native/CommentRow';
import { Avatar, EmptyState, TextField } from '../../components/native/ui';
import KeyboardAvoider from '../../components/native/KeyboardAvoider';
import { color, space, type } from '../../theme/tokens';
import type { Comment } from '../../types';

const EMPTY_COMMENTS: Comment[] = [];

/** Placeholder rows while the first load is in flight. */
const SKELETON_ROWS = 6;

/** The composer grows with its text up to about four lines, then scrolls. */
const COMPOSER_MAX_HEIGHT = 4 * 21 + 2 * space.md;

export default function CommentsScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const { isUserBlocked, addToast } = useApp();
  const { profile: userProfile, profileId } = useCurrentProfile();
  const inputRef = useRef<TextInput>(null);

  const [newCommentText, setNewCommentText] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // One query, keyed by post. Two mounts in quick succession share a single
  // request because TanStack dedupes by key — which is what made the 209-line
  // fetch guard, its abort plumbing and its cooldown unnecessary (ONE-14).
  const commentsQuery = useCommentsQuery(postId);
  const { data: comments, isPending: loading } = commentsQuery;
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

  const canPost = Boolean(newCommentText.trim()) && !addCommentMutation.isPending;

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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await commentsQuery.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [commentsQuery]);

  const renderItem = useCallback(
    ({ item }: { item: Comment }) => {
      // Only your own comments delete, by the account's author id where the
      // comment carries one.
      const mine = item.userId ? item.userId === profileId : item.username === userProfile?.username;
      return (
        <CommentRow
          comment={item}
          onViewProfile={handleViewProfile}
          onDelete={mine ? handleDeleteComment : undefined}
        />
      );
    },
    [handleDeleteComment, handleViewProfile, profileId, userProfile?.username],
  );

  const renderBody = () => {
    if (loading) {
      return (
        <View style={styles.fill}>
          {Array.from({ length: SKELETON_ROWS }, (_, i) => <CommentRowSkeleton key={i} />)}
        </View>
      );
    }

    if (commentsQuery.isError && !comments) {
      return (
        <EmptyState
          title="Couldn't load comments"
          body="Check your connection and try again."
          action={{ label: 'Retry', onPress: () => void commentsQuery.refetch() }}
        />
      );
    }

    return (
      <FlatList
        data={localComments}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={color.textMuted}
            colors={[color.textMuted]}
          />
        }
        ListEmptyComponent={
          // Tapping the empty state is the way into the conversation.
          <Pressable
            onPress={() => inputRef.current?.focus()}
            accessibilityRole="button"
            accessibilityLabel="Add a comment"
          >
            <EmptyState title="No comments yet" body="Start the conversation." />
          </Pressable>
        }
        contentContainerStyle={styles.list}
      />
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: 'Comments' }} />

      {/* Measures itself against the keyboard, so the stack header's height
          no longer has to be guessed: the fixed 90pt offset this replaced was
          short of the real header and left the composer half under the keys. */}
      <KeyboardAvoider style={styles.fill}>
        {renderBody()}

        {/* The composer, pinned above the keyboard and the home indicator. */}
        <View style={styles.composer}>
          <Avatar
            uri={userProfile?.profilePicture}
            name={userProfile?.name || userProfile?.username}
            size={COMMENT_AVATAR_SIZE}
          />
          <TextField
            ref={inputRef}
            value={newCommentText}
            onChangeText={setNewCommentText}
            placeholder="Add a comment…"
            multiline
            // Return sends rather than adding a line: a comment is one thought.
            submitBehavior="submit"
            returnKeyType="send"
            onSubmitEditing={handleAddComment}
            containerStyle={styles.composerField}
            inputStyle={styles.composerInput}
            accessibilityLabel="Add a comment"
          />
          <Pressable
            onPress={handleAddComment}
            disabled={!canPost}
            accessibilityRole="button"
            accessibilityLabel="Post comment"
            accessibilityState={{ disabled: !canPost }}
            hitSlop={8}
            style={styles.postButton}
          >
            <Text style={[styles.postLabel, !canPost && styles.postLabelDisabled]}>Post</Text>
          </Pressable>
        </View>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
  },
  fill: {
    flex: 1,
  },
  list: {
    flexGrow: 1,
    paddingVertical: space.xs,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.bg,
  },
  composerField: {
    flex: 1,
  },
  composerInput: {
    minHeight: 40,
    maxHeight: COMPOSER_MAX_HEIGHT,
    paddingVertical: space.sm,
  },
  postButton: {
    minHeight: 40,
    justifyContent: 'center',
  },
  postLabel: {
    fontFamily: type.bodyBold,
    fontSize: 15,
    color: color.text,
  },
  postLabelDisabled: {
    color: color.textMuted,
  },
});
