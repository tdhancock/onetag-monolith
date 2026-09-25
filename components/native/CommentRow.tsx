import React, { useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile } from '../../features/profiles';
import { useCommentLikesQuery, useToggleCommentLike } from '../../features/comments';
import { Avatar, IconButton, Skeleton } from './ui';
import { HeartIcon } from './Icons';
import RenderUserContent from './RenderUserContent';
import { getTimeAgo } from '../../lib/timeAgo';
import { color, space, type } from '../../theme/tokens';
import type { Comment } from '../../types';

interface CommentRowProps {
  comment: Comment;
  onViewProfile: (username: string) => void;
  /** Supplied only for comments the viewer may delete: the row then swipes to Delete. */
  onDelete?: (commentId: string) => void;
}

/** The commenter's avatar diameter. */
export const COMMENT_AVATAR_SIZE = 32;

/** "2h · 3 likes". Reply joins it once threading exists; a dead control would not. */
export const commentMeta = (timeAgo: string, likes: number): string =>
  [timeAgo, likes > 0 ? `${likes} ${likes === 1 ? 'like' : 'likes'}` : null]
    .filter(Boolean)
    .join(' · ');

/**
 * One comment: a 32pt avatar, "**username** text" wrapping beneath it, a meta
 * line of time and likes, and a heart on the right. Your own comments swipe
 * to reveal Delete.
 */
const CommentRow: React.FC<CommentRowProps> = ({ comment, onViewProfile, onDelete }) => {
  const { triggerHapticFeedback } = useApp();
  const { profileId } = useCurrentProfile();

  // Likes are a query and an optimistic toggle (ONE-14): the count moves at
  // once and reverts if the write fails.
  const { data: likes } = useCommentLikesQuery(comment.id, profileId);
  const likeHaptic = useCallback(() => triggerHapticFeedback(), [triggerHapticFeedback]);
  const like = useToggleCommentLike(profileId, likeHaptic);

  const isLiked = Boolean(likes?.isLiked);
  const likesCount = likes?.count ?? 0;

  const row = (
    <View
      style={styles.row}
      // Swiping is invisible to a screen reader; the same Delete is offered as
      // an accessibility action instead.
      accessibilityActions={onDelete ? [{ name: 'delete', label: 'Delete comment' }] : undefined}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'delete') onDelete?.(comment.id);
      }}
    >
      <Pressable
        onPress={() => onViewProfile(comment.username)}
        accessibilityRole="button"
        accessibilityLabel={`View ${comment.username}'s profile`}
        hitSlop={6}
      >
        <Avatar uri={comment.avatar} name={comment.username} size={COMMENT_AVATAR_SIZE} />
      </Pressable>
      <View style={styles.body}>
        <Text style={styles.text}>
          <Text style={styles.username} onPress={() => onViewProfile(comment.username)}>
            {comment.username}
          </Text>
          {' '}
          <RenderUserContent content={comment.text} />
        </Text>
        <Text style={styles.meta}>{commentMeta(getTimeAgo(comment.timestamp), likesCount)}</Text>
      </View>
      <IconButton
        icon={<HeartIcon liked={isLiked} color={isLiked ? color.heart : color.textMuted} size={16} strokeWidth={1.8} />}
        accessibilityLabel={`Like comment, ${isLiked ? 'liked' : 'not liked'}`}
        onPress={() => like.toggle(comment.id)}
      />
    </View>
  );

  if (!onDelete) return row;

  return (
    <Swipeable
      overshootRight={false}
      rightThreshold={36}
      renderRightActions={() => (
        <Pressable
          onPress={() => onDelete(comment.id)}
          accessibilityRole="button"
          accessibilityLabel="Delete comment"
          style={styles.deleteAction}
        >
          <Text style={styles.deleteLabel}>Delete</Text>
        </Pressable>
      )}
    >
      {row}
    </Swipeable>
  );
};

/** A comment-shaped placeholder: avatar, two lines, and the meta line. */
export const CommentRowSkeleton: React.FC = () => (
  <View style={styles.row}>
    <Skeleton circle height={COMMENT_AVATAR_SIZE} />
    <View style={styles.body}>
      <Skeleton width="80%" height={12} />
      <Skeleton width="50%" height={12} style={styles.skeletonGap} />
      <Skeleton width={72} height={10} style={styles.skeletonGap} />
    </View>
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 56,
    paddingLeft: space.lg,
    // The heart's IconButton carries its own inset.
    paddingRight: space.xs,
    paddingVertical: space.sm,
    backgroundColor: color.bg,
  },
  body: {
    flex: 1,
    marginLeft: space.md,
    paddingTop: 2,
  },
  text: {
    fontFamily: type.body,
    fontSize: 15,
    lineHeight: 21,
    color: color.text,
  },
  username: {
    fontFamily: type.bodyBold,
  },
  meta: {
    marginTop: space.xs,
    fontFamily: type.body,
    fontSize: 13,
    color: color.textMuted,
  },
  deleteAction: {
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    backgroundColor: color.bg,
    borderLeftWidth: 1,
    borderLeftColor: color.border,
  },
  deleteLabel: {
    fontFamily: type.bodyBold,
    fontSize: 15,
    color: color.heart,
  },
  skeletonGap: {
    marginTop: space.sm,
  },
});

export default React.memo(CommentRow);
