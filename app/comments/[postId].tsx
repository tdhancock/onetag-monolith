import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  RefreshControl,
  Alert,
  StyleSheet,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile } from '../../features/profiles';
import { useCommentsQuery, useAddComment, useDeleteComment, threadIdFor } from '../../features/comments';
import { cleanHtml } from '../../lib/cleanHtml';
import {
  deleteCommentConfirm,
  FOCUS_HIGHLIGHT_MS,
  hiddenRepliesLabel,
  locateComment,
  replyPrefill,
  visibleReplies,
} from '../../lib/screens/comments';
import CommentRow, { CommentRowSkeleton, COMMENT_AVATAR_SIZE, REPLY_INDENT } from '../../components/native/CommentRow';
import { Avatar, EmptyState, IconButton, TextField } from '../../components/native/ui';
import { XIcon } from '../../components/native/Icons';
import KeyboardAvoider from '../../components/native/KeyboardAvoider';
import { color, space, type } from '../../theme/tokens';
import type { Comment } from '../../types';

const EMPTY_COMMENTS: Comment[] = [];

/** Placeholder rows while the first load is in flight. */
const SKELETON_ROWS = 6;

/** The composer grows with its text up to about four lines, then scrolls. */
const COMPOSER_MAX_HEIGHT = 4 * 21 + 2 * space.md;

export default function CommentsScreen() {
  const { postId, commentId: focusId } = useLocalSearchParams<{ postId: string; commentId?: string }>();
  const router = useRouter();
  const { isUserBlocked, addToast } = useApp();
  const { profile: userProfile, profileId } = useCurrentProfile();
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<Comment>>(null);

  const [newCommentText, setNewCommentText] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  // The comment being replied to, while the composer is answering one.
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
  // Threads opened past their first replies.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

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

    // A reply goes in the thread of the comment it answers, which opens so
    // the reply shows where it landed.
    const parentId = replyingTo ? threadIdFor(replyingTo) : null;
    if (parentId) setExpanded((open) => new Set(open).add(parentId));

    setNewCommentText('');
    setReplyingTo(null);
    addCommentMutation.mutate({
      postId,
      text: cleanHtml(text),
      parentId,
      author: {
        id: profileId,
        username: userProfile?.username || '',
        avatar: userProfile?.profilePicture,
      },
    });
  };

  const handleReply = useCallback((comment: Comment) => {
    setReplyingTo(comment);
    // Their handle leads the reply, so they hear of it however deep it sits.
    setNewCommentText(replyPrefill(comment.username, userProfile?.username));
    inputRef.current?.focus();
  }, [userProfile?.username]);

  const cancelReply = useCallback(() => {
    setReplyingTo(null);
    setNewCommentText('');
  }, []);

  const handleDeleteComment = useCallback((commentId: string) => {
    if (!postId) return;

    const remove = () =>
      deleteCommentMutation.mutate(
        { postId, commentId },
        {
          onError: (error) => {
            console.error('Failed to delete comment', error);
            addToast('Failed to delete comment.', 'error');
          },
        },
      );

    // Deleting a comment deletes the replies under it. Asked first when
    // there are any, since they are other people's words too.
    const replies = comments?.find((c) => c.id === commentId)?.replies?.length ?? 0;
    const confirm = deleteCommentConfirm(replies);
    if (!confirm) {
      remove();
      return;
    }
    Alert.alert(confirm.title, confirm.body, [
      { text: 'Cancel', style: 'cancel' },
      { text: confirm.confirm, style: 'destructive', onPress: remove },
    ]);
  }, [addToast, comments, deleteCommentMutation, postId]);

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

  // Opened from a notification: go to the comment it's about, open its
  // thread if a reply is folded away, and mark it for a moment. Once, when
  // the comments first arrive.
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || !focusId || !comments) return;
    focused.current = true;
    const place = locateComment(localComments, focusId);
    if (!place) return;
    if (place.folded) setExpanded((open) => new Set(open).add(place.threadId));
    setHighlighted(focusId);
    // After the list has laid out the rows up to it.
    requestAnimationFrame(() =>
      listRef.current?.scrollToIndex({ index: place.index, viewPosition: 0.2, animated: true }),
    );
  }, [focusId, comments, localComments]);

  useEffect(() => {
    if (!highlighted) return undefined;
    const timer = setTimeout(() => setHighlighted(null), FOCUS_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlighted]);

  // A row further down than the list has drawn: jump near it, then try again.
  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
      setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.2, animated: true }), 100);
    },
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: Comment }) => {
      // Only your own comments delete, by the account's author id where the
      // comment carries one.
      const isMine = (comment: Comment) =>
        comment.userId ? comment.userId === profileId : comment.username === userProfile?.username;
      const replies = item.replies ?? [];
      const shown = visibleReplies(replies, expanded.has(item.id));
      const hidden = hiddenRepliesLabel(replies.length - shown.length);
      return (
        <View>
          <CommentRow
            comment={item}
            onViewProfile={handleViewProfile}
            onDelete={isMine(item) ? handleDeleteComment : undefined}
            onReply={handleReply}
            highlighted={highlighted === item.id}
          />
          {shown.map((reply) => (
            <CommentRow
              key={reply.id}
              comment={reply}
              isReply
              onViewProfile={handleViewProfile}
              onDelete={isMine(reply) ? handleDeleteComment : undefined}
              onReply={handleReply}
              highlighted={highlighted === reply.id}
            />
          ))}
          {hidden ? (
            <Pressable
              onPress={() => setExpanded((open) => new Set(open).add(item.id))}
              accessibilityRole="button"
              hitSlop={4}
              style={styles.moreReplies}
            >
              <Text style={styles.moreRepliesLabel}>{hidden}</Text>
            </Pressable>
          ) : null}
        </View>
      );
    },
    [expanded, highlighted, handleDeleteComment, handleReply, handleViewProfile, profileId, userProfile?.username],
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
        ref={listRef}
        data={localComments}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        extraData={[expanded, highlighted]}
        onScrollToIndexFailed={handleScrollToIndexFailed}
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

      {/* Rides on the keyboard, so the stack header's height no longer has
          to be guessed: the fixed 90pt offset this replaced was short of the
          real header and left the composer half under the keys. */}
      <KeyboardAvoider style={styles.fill}>
        {renderBody()}

        {replyingTo ? (
          <View style={styles.replyBanner}>
            <Text style={styles.replyBannerText} numberOfLines={1}>
              Replying to <Text style={styles.replyBannerName}>@{replyingTo.username}</Text>
            </Text>
            <IconButton
              icon={<XIcon color={color.textMid} size={18} />}
              accessibilityLabel="Cancel reply"
              onPress={cancelReply}
            />
          </View>
        ) : null}

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
            placeholder={replyingTo ? `Reply to @${replyingTo.username}…` : 'Add a comment…'}
            multiline
            // Return sends rather than adding a line: a comment is one thought.
            submitBehavior="submit"
            returnKeyType="send"
            onSubmitEditing={handleAddComment}
            containerStyle={styles.composerField}
            inputStyle={styles.composerInput}
            accessibilityLabel={replyingTo ? `Reply to ${replyingTo.username}` : 'Add a comment'}
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
  moreReplies: {
    minHeight: 32,
    justifyContent: 'center',
    paddingLeft: space.lg + REPLY_INDENT,
    paddingBottom: space.xs,
  },
  moreRepliesLabel: {
    fontFamily: type.bodyBold,
    fontSize: 13,
    color: color.textMid,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space.lg,
    paddingRight: space.xs,
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.bgPanel,
  },
  replyBannerText: {
    flex: 1,
    fontFamily: type.body,
    fontSize: 13,
    color: color.textMid,
  },
  replyBannerName: {
    fontFamily: type.bodyBold,
    color: color.text,
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
