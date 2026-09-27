import React, { useState, useCallback, useRef } from 'react';
import { View, Text, Pressable, Animated, Alert, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile } from '../../features/profiles';
import { useLikePost, useRepostPost, useSavePost, useDeletePost } from '../../features/posts';
import { Avatar, IconButton, ICON_BUTTON_SIZE, Sheet, SheetRow } from './ui';
import RenderUserContent from './RenderUserContent';
import EmbeddedTags, { useImageContentRect } from './EmbeddedTags';
import {
  HeartIcon,
  CommentIcon,
  RepostIcon,
  BookmarkIcon,
  TrashIcon,
  VerifiedIcon,
  DotsHorizontalIcon,
  SendIcon,
  ReportIcon,
  PencilAltIcon,
} from './Icons';
import { reportPost } from '../../features/moderation';
import { useIsAdmin } from '../../features/admin';
import { useAuthUserId } from '../../features/auth';
import { POST_REPORT_REASONS } from '../../services/reportReasons';
import { getTimeAgo } from '../../lib/timeAgo';
import {
  actionLabels,
  commentsLinkLabel,
  likesLabel,
  repostsLabel,
  truncateForCard,
} from '../../lib/screens/postCard';
import { color, space, type } from '../../theme/tokens';
import type { Post } from '../../types';

// ─── Layout ────────────────────────────────────────

/** Header avatar diameter. PostSkeleton mirrors it. */
const HEADER_AVATAR_SIZE = 36;
/** Action icons: 24pt glyphs at a 1.8 stroke. */
const ACTION_ICON_SIZE = 24;
const ACTION_STROKE = 1.8;
/** A reposted post keeps the ink colour and reads heavier instead. */
const ACTION_STROKE_ACTIVE = 2.6;
/**
 * An IconButton centres its 24pt glyph in a 44pt target, which insets the
 * glyph 10pt from the button's edge. Pulling the action row in by that much
 * lines the first icon up with the `space.lg` text edge below it.
 */
const ACTION_ROW_INSET = space.lg - (ICON_BUTTON_SIZE - ACTION_ICON_SIZE) / 2;

// ─── Props ─────────────────────────────────────────

interface PostCardProps {
  post: Post;
  isStoryVersion?: boolean;
  onDelete?: (postId: string) => void;
  onEditPost?: (post: Post) => void;
  onViewProfile?: (username: string, avatar?: string | null) => void;
  onViewComments?: (postId: string) => void;
  onViewLikers?: (postId: string) => void;
  onViewReposters?: (postId: string) => void;
  onSharePost?: (post: Post) => void;
  isPreview?: boolean;
  /**
   * Post detail: the text is shown whole rather than truncated, and the card
   * drops its own "View all N comments" line because the screen lists the
   * comments beneath it.
   */
  detail?: boolean;
}

// ─── PostHeader ────────────────────────────────────

const PostHeader: React.FC<{
  post: Post;
  isMyPost: boolean;
  timeAgo: string;
  onViewProfile: () => void;
  onDelete: () => void;
  onEditPost?: () => void;
  isPreview?: boolean;
}> = React.memo(({ post, isMyPost, timeAgo, onViewProfile, onDelete, onEditPost, isPreview }) => {
  const [menuVisible, setMenuVisible] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const { addToast } = useApp();
  const { profileId, authUserId } = useCurrentProfile();
  const isAdmin = useIsAdmin(authUserId);

  const closeMenu = () => setMenuVisible(false);

  const handleReport = async (reason: string) => {
    setMenuVisible(false);
    setShowReport(false);
    if (!profileId) return;
    const success = await reportPost(profileId, post.id, reason);
    if (success) {
      addToast('Report submitted. Thank you for your feedback.', 'success');
    } else {
      addToast('Failed to submit report. Please try again.', 'error');
    }
  };

  const displayName = post.name || post.username;
  const meta = [`@${post.username}`, timeAgo].filter(Boolean).join(' · ');

  return (
    <View style={styles.header}>
      <Pressable
        onPress={onViewProfile}
        accessibilityRole="button"
        accessibilityLabel={`View ${displayName}'s profile`}
        hitSlop={4}
      >
        <Avatar uri={post.avatar} name={displayName} size={HEADER_AVATAR_SIZE} />
      </Pressable>

      <Pressable onPress={onViewProfile} style={styles.headerText} accessibilityRole="button">
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
          {post.isVerified && (
            <View style={styles.verified} accessible accessibilityLabel="Verified">
              <VerifiedIcon color={color.text} size={14} />
            </View>
          )}
        </View>
        <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
      </Pressable>

      {!isPreview && (
        <IconButton
          icon={<DotsHorizontalIcon color={color.text} size={20} />}
          accessibilityLabel="Post options"
          onPress={() => { setMenuVisible(true); setShowReport(false); }}
        />
      )}

      {/* Options menu, and the report reasons as its second step */}
      <Sheet
        visible={menuVisible}
        onClose={closeMenu}
        title={showReport ? 'Why are you reporting this?' : undefined}
        onBack={showReport ? () => setShowReport(false) : undefined}
      >
        {!showReport ? (
          (isMyPost || isAdmin) ? (
            <>
              {isMyPost && post.media_type === 'text' && onEditPost && (
                <SheetRow
                  label="Edit Post"
                  icon={<PencilAltIcon color={color.text} size={20} />}
                  onPress={() => { setMenuVisible(false); onEditPost(); }}
                />
              )}
              <SheetRow
                label="Delete Post"
                destructive
                icon={<TrashIcon color={color.heart} size={20} />}
                onPress={() => { setMenuVisible(false); onDelete(); }}
              />
            </>
          ) : (
            <SheetRow
              label="Report Post"
              destructive
              chevron
              icon={<ReportIcon color={color.heart} size={20} />}
              onPress={() => setShowReport(true)}
            />
          )
        ) : (
          POST_REPORT_REASONS.map(reason => (
            <SheetRow key={reason} label={reason} onPress={() => handleReport(reason)} />
          ))
        )}
      </Sheet>
    </View>
  );
});

// ─── PostCard ──────────────────────────────────────

const PostCard: React.FC<PostCardProps> = ({
  post,
  isStoryVersion = false,
  onDelete,
  onEditPost,
  onViewProfile,
  onViewComments,
  onViewLikers,
  onViewReposters,
  onSharePost,
  isPreview = false,
  detail = false,
}) => {
  const {
    addToast,
    triggerHapticFeedback,
  } = useApp();
  const { profile: userProfile, profileId } = useCurrentProfile();
  const isAdmin = useIsAdmin(useAuthUserId());
  const router = useRouter();

  // Like, Repost and Save read straight off the post (ONE-13). The cached
  // entity is the source of truth for both the boolean and the count, so an
  // optimistic toggle — and its rollback — reaches every copy of this post at
  // once, rather than this card keeping its own count that a failed write
  // would leave behind.
  // Haptics and the Save toast fired from the AppContext toggles these
  // replace, so they hang off the same instant the cache flips.
  const likeHaptic = useCallback(() => triggerHapticFeedback('light'), [triggerHapticFeedback]);
  const repostHaptic = useCallback(() => triggerHapticFeedback(), [triggerHapticFeedback]);
  const onSaveToggled = useCallback(
    ({ isOn }: { isOn: boolean }) => {
      triggerHapticFeedback();
      addToast(
        isOn ? 'Saved to your collection!' : 'Removed from your collection.',
        isOn ? 'success' : 'info',
      );
    },
    [triggerHapticFeedback, addToast],
  );

  const deletePost = useDeletePost();
  const like = useLikePost(profileId, likeHaptic);
  const repost = useRepostPost(profileId, repostHaptic);
  const save = useSavePost(profileId, onSaveToggled);

  const liked = Boolean(post.isLiked);
  const reposted = Boolean(post.isReposted);
  const saved = Boolean(post.isSaved);

  const [showHeart, setShowHeart] = useState(false);
  const [isExpanded, setIsExpanded] = useState(detail);

  const heartScale = useRef(new Animated.Value(0)).current;
  const media = useImageContentRect();

  const isTextOnly = post.media_type === 'text';
  const isImage = post.media_type === 'image';
  const timeAgo = getTimeAgo(post.timestamp);

  // The reply count comes off the post itself. It used to prefer the length
  // of a locally cached comment list when one had been loaded, which is the
  // same number by a longer route — and the comment mutations now move
  // `replies` on the cached post as they go (ONE-14).
  const likes = likesLabel(post.likes);
  const reposts = repostsLabel(post.reposts);
  const commentsLink = commentsLinkLabel(post.replies);
  const labels = actionLabels({ liked, reposted, saved });
  const isMyPost = post.username === userProfile?.username;

  const body = truncateForCard(post.content || '', isExpanded);

  // ─── Handlers ──────────────────────────────────

  // The mutation's own pending flag replaces the `isLiking` / `isReposting`
  // booleans these handlers used to keep, so a second tap while the first is
  // in flight is still ignored.
  const handleLike = useCallback(() => {
    if (isStoryVersion || like.isPending) return;
    like.toggle(post.id);
  }, [isStoryVersion, like, post.id]);

  const handleRepost = useCallback(() => {
    if (isStoryVersion || repost.isPending) return;
    repost.toggle(post.id);
  }, [isStoryVersion, repost, post.id]);

  const handleDoubleTap = useCallback(() => {
    if (isStoryVersion) return;
    if (!liked) handleLike();
    setShowHeart(true);
    triggerHapticFeedback('medium');
    // Animate heart
    heartScale.setValue(0.5);
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.2, useNativeDriver: true, speed: 50 }),
      Animated.timing(heartScale, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start(() => setShowHeart(false));
  }, [isStoryVersion, liked]);

  const handleDelete = useCallback(() => {
    Alert.alert('Delete Post', 'Are you sure you want to delete this post?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (onDelete) onDelete(post.id);
          else deletePost.mutate({ postId: post.id, asAdmin: isAdmin });
        },
      },
    ]);
  }, [post.id, onDelete, deletePost, isAdmin]);

  const handleViewProfile = useCallback(() => {
    if (onViewProfile) {
      onViewProfile(post.username, post.avatar);
    } else {
      router.push(`/user/${post.username}`);
    }
  }, [post.username, post.avatar]);

  // Last tap tracking for double tap
  const lastTap = useRef(0);
  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      handleDoubleTap();
    }
    lastTap.current = now;
  }, [handleDoubleTap]);

  // ─── Render ────────────────────────────────────

  // Posts published before ONE-55 carry no ratio and keep rendering at 4:5.
  // Backfilling would mean fetching every stored image to measure it, which is
  // a decision of its own rather than a side effect of this change.
  const aspectRatio = post.media_aspect_ratio || 1080 / 1350;

  // Zero counts are hidden rather than shown as "0". A text-only post's text
  // is its content, so only a media post has a caption line here.
  const showCounts = !isStoryVersion && Boolean(likes || reposts);
  const showCaption = !isTextOnly && Boolean(post.content);
  const showComments = !isStoryVersion && !detail && Boolean(commentsLink);
  const hasFooter = showCounts || showCaption || showComments;

  const moreControl = body.truncated ? (
    <Text
      style={styles.more}
      onPress={() => setIsExpanded(true)}
      accessibilityRole="button"
      accessibilityLabel="Show more"
    >
      {' '}more
    </Text>
  ) : null;

  return (
    <View style={styles.card}>
      <PostHeader
        post={post}
        isMyPost={isMyPost}
        timeAgo={timeAgo}
        onViewProfile={handleViewProfile}
        onDelete={handleDelete}
        onEditPost={onEditPost ? () => onEditPost(post) : undefined}
        isPreview={isPreview}
      />

      {/* Content: the double-tap target */}
      <Pressable onPress={handleTap} accessibilityHint="Double tap to like">
        {isTextOnly ? (
          <View style={styles.textPost}>
            <Text style={styles.textPostBody}>
              <RenderUserContent content={body.text} />
              {moreControl}
            </Text>
          </View>
        ) : (
          post.media && (
            <View style={[styles.media, { aspectRatio }]} onLayout={media.onLayout}>
              <Image
                source={{ uri: post.media }}
                placeholder={post.media_preview_url ? { uri: post.media_preview_url } : undefined}
                style={styles.mediaImage}
                contentFit="contain"
                transition={300}
                onLoad={media.onLoad}
              />
              {/* Tags sit over the picture itself, not the letterbox (ONE-45). */}
              <EmbeddedTags tags={post.embeddedTags ?? []} contentRect={media.contentRect} interactive={!isPreview} />
            </View>
          )
        )}

        {/* Double-tap heart burst. Inverse over photos; on a white text post
            an inverse heart would vanish, so it takes the heart colour. */}
        {showHeart && (
          <View style={styles.burst} pointerEvents="none">
            <Animated.View style={{ transform: [{ scale: heartScale }], opacity: heartScale }}>
              <HeartIcon liked color={isTextOnly ? color.heart : color.inverse} size={96} />
            </Animated.View>
          </View>
        )}
      </Pressable>

      {/* Actions */}
      {!isStoryVersion && (
        <View style={styles.actions}>
          <View style={styles.actionGroup}>
            <IconButton
              icon={<HeartIcon liked={liked} size={ACTION_ICON_SIZE} strokeWidth={ACTION_STROKE} />}
              accessibilityLabel={labels.like}
              accessibilityHint="Long press to see who liked this"
              onPress={handleLike}
              onLongPress={() => onViewLikers?.(post.id)}
            />
            <IconButton
              icon={<CommentIcon color={color.text} size={ACTION_ICON_SIZE} strokeWidth={ACTION_STROKE} />}
              accessibilityLabel={labels.comment}
              onPress={() => onViewComments?.(post.id)}
            />
            <IconButton
              icon={
                <RepostIcon
                  color={color.text}
                  size={ACTION_ICON_SIZE}
                  strokeWidth={reposted ? ACTION_STROKE_ACTIVE : ACTION_STROKE}
                />
              }
              accessibilityLabel={labels.repost}
              accessibilityHint="Long press to see who reposted this"
              onPress={handleRepost}
              onLongPress={() => onViewReposters?.(post.id)}
            />
            <IconButton
              icon={<SendIcon color={color.text} size={ACTION_ICON_SIZE} strokeWidth={ACTION_STROKE} />}
              accessibilityLabel={labels.share}
              onPress={() => onSharePost?.(post)}
            />
          </View>
          <IconButton
            icon={
              <BookmarkIcon
                saved={saved}
                color={color.text}
                size={ACTION_ICON_SIZE}
                strokeWidth={ACTION_STROKE}
              />
            }
            accessibilityLabel={labels.save}
            onPress={() => save.toggle(post.id)}
          />
        </View>
      )}

      {/* Counts, caption, comments */}
      {hasFooter && (
        <View style={styles.footer}>
          {showCounts ? (
            <Text style={styles.counts}>
              {likes ? <Text style={styles.likes}>{likes}</Text> : null}
              {likes && reposts ? ' · ' : null}
              {reposts}
            </Text>
          ) : null}
          {showCaption ? (
            <Text style={styles.caption}>
              <Text style={styles.captionName} onPress={handleViewProfile}>
                {post.name || post.username}
              </Text>
              {' '}
              <RenderUserContent content={body.text} />
              {moreControl}
            </Text>
          ) : null}
          {showComments ? (
            <Pressable
              onPress={() => onViewComments?.(post.id)}
              accessibilityRole="button"
              hitSlop={{ top: 12, bottom: 12 }}
            >
              <Text style={styles.commentsLink}>{commentsLink}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  // Room either side of the hairline between posts: 8pt barely separated the
  // last line of one post from the next one's header.
  card: {
    backgroundColor: color.bg,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    paddingTop: space.sm,
    paddingBottom: space.lg,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingLeft: space.lg,
    // The ⋯ IconButton brings its own 10pt of inset around the glyph.
    paddingRight: space.lg - (ICON_BUTTON_SIZE - 20) / 2,
  },
  headerText: {
    flex: 1,
    marginLeft: space.md,
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    flexShrink: 1,
    fontFamily: type.bodyBold,
    fontSize: 15,
    color: color.text,
  },
  verified: {
    marginLeft: space.xs,
  },
  meta: {
    marginTop: 1,
    fontFamily: type.body,
    fontSize: 13,
    color: color.textMid,
  },

  // Content
  textPost: {
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  textPostBody: {
    fontFamily: type.body,
    fontSize: 17,
    lineHeight: 26,
    color: color.text,
  },
  media: {
    width: '100%',
    backgroundColor: color.bgPanel,
  },
  mediaImage: {
    width: '100%',
    height: '100%',
  },
  more: {
    fontFamily: type.bodyMedium,
    color: color.textMuted,
  },
  burst: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Actions
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: ICON_BUTTON_SIZE,
    paddingHorizontal: ACTION_ROW_INSET,
  },
  actionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  // Counts and caption
  footer: {
    paddingHorizontal: space.lg,
    gap: space.xs,
  },
  counts: {
    fontFamily: type.body,
    fontSize: 14,
    color: color.textMid,
  },
  likes: {
    fontFamily: type.bodyBold,
    color: color.text,
  },
  caption: {
    fontFamily: type.body,
    fontSize: 15,
    lineHeight: 22,
    color: color.text,
  },
  captionName: {
    fontFamily: type.bodyBold,
  },
  commentsLink: {
    fontFamily: type.body,
    fontSize: 14,
    color: color.textMuted,
  },
});

export default React.memo(PostCard);
