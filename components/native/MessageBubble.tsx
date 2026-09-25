import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Avatar, Card, Pressable } from './ui';
import RenderUserContent from './RenderUserContent';
import { firstLine } from '../../lib/screens/profile';
import { color, radius, space, type, withAlpha } from '../../theme/tokens';
import type { Message, Post, SimpleUser } from '../../types';

export interface MessageBubbleProps {
  message: Message;
  /** Sent by the person viewing the thread: ink, on the right. */
  mine: boolean;
  /** Who wrote the message this one replies to, for its quote. */
  quotedUsername?: string | null;
  /** The meta line under the bubble: its time, or "Sending…" / "Sent". */
  meta?: string | null;
  /** Space above the bubble, from `bubbleGapAbove`. */
  gapAbove: number;
  onLongPress?: () => void;
  onOpenPost: (post: Post) => void;
  onOpenProfile: (user: SimpleUser) => void;
}

/** The widest a bubble grows, as a share of the thread. */
export const BUBBLE_MAX_WIDTH = '75%';
const THUMBNAIL_SIZE = 48;

/** A stored image the thumbnail can draw. */
const drawable = (url: string | null | undefined): url is string =>
  typeof url === 'string' && url.length > 0;

/** A shared post: its photo or first line, its author, one line of copy. */
const SharedPostCard: React.FC<{ post: Post; onPress: () => void }> = ({ post, onPress }) => {
  const hasImage = post.media_type === 'image' && drawable(post.media);
  return (
    <Card padding="sm" onPress={onPress} style={styles.card}>
      <View style={styles.cardRow} accessible accessibilityLabel={`Post by ${post.username}`}>
        {hasImage ? (
          <Image
            // The preview is a 50px blur-up, not something to show on its own.
            source={{ uri: post.media }}
            placeholder={post.media_preview_url ? { uri: post.media_preview_url } : undefined}
            style={styles.thumbnail}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.thumbnail, styles.textThumbnail]}>
            <Text style={styles.textThumbnailCopy} numberOfLines={3}>
              {firstLine(post.content)}
            </Text>
          </View>
        )}
        <View style={styles.cardText}>
          <View style={styles.author}>
            <Avatar uri={post.avatar} name={post.name || post.username} size={20} />
            <Text style={styles.authorName} numberOfLines={1}>
              {post.username}
            </Text>
          </View>
          {post.content ? (
            <Text style={styles.cardLine} numberOfLines={1}>
              {firstLine(post.content)}
            </Text>
          ) : null}
        </View>
      </View>
    </Card>
  );
};

/** A shared profile: avatar, name and handle. */
const SharedProfileCard: React.FC<{ user: SimpleUser; onPress: () => void }> = ({ user, onPress }) => (
  <Card padding="sm" onPress={onPress} style={styles.card}>
    <View style={styles.cardRow} accessible accessibilityLabel={`Profile of ${user.username}`}>
      <Avatar uri={user.avatar} name={user.name || user.username} size={40} />
      <View style={styles.cardText}>
        <Text style={styles.profileName} numberOfLines={1}>
          {user.name || user.username}
        </Text>
        <Text style={styles.cardLine} numberOfLines={1}>
          @{user.username}
        </Text>
      </View>
    </View>
  </Card>
);

/**
 * One message in a thread. Yours are ink with inverse text on the right;
 * theirs sit on the panel surface on the left. A reply carries an inset quote
 * of the message it answers, and a shared post or profile renders as a card
 * inside the bubble.
 */
const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  mine,
  quotedUsername,
  meta,
  gapAbove,
  onLongPress,
  onOpenPost,
  onOpenProfile,
}) => {
  const { repliedMessage, sharedPost, sharedUser } = message;
  const showPost = message.type === 'post_share' && sharedPost;
  const showProfile = message.type === 'profile_share' && sharedUser;
  const hasText = Boolean(message.text);

  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs, { marginTop: gapAbove }]}>
      <Pressable
        onLongPress={onLongPress}
        accessibilityHint={onLongPress ? 'Long press for options' : undefined}
        style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
      >
        {repliedMessage ? (
          <View style={[styles.quote, mine ? styles.quoteMine : styles.quoteTheirs]}>
            {quotedUsername ? (
              <Text style={[styles.quoteName, mine ? styles.quoteTextMine : styles.quoteTextTheirs]}>
                @{quotedUsername}
              </Text>
            ) : null}
            <Text style={[styles.quoteText, mine ? styles.quoteTextMine : styles.quoteTextTheirs]} numberOfLines={2}>
              {repliedMessage.text}
            </Text>
          </View>
        ) : null}

        {showPost ? <SharedPostCard post={sharedPost} onPress={() => onOpenPost(sharedPost)} /> : null}
        {showProfile ? <SharedProfileCard user={sharedUser} onPress={() => onOpenProfile(sharedUser)} /> : null}

        {hasText ? (
          <RenderUserContent
            content={message.text}
            style={[styles.text, mine ? styles.textMine : null, (showPost || showProfile) && styles.textAfterCard]}
          />
        ) : null}
      </Pressable>
      {meta ? <Text style={[styles.meta, mine ? styles.metaMine : null]}>{meta}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: space.lg,
  },
  rowMine: {
    alignItems: 'flex-end',
  },
  rowTheirs: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: BUBBLE_MAX_WIDTH,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
  },
  bubbleMine: {
    backgroundColor: color.text,
  },
  bubbleTheirs: {
    backgroundColor: color.bgPanel,
  },
  text: {
    fontSize: 15,
    lineHeight: 21,
  },
  textMine: {
    color: color.inverse,
  },
  textAfterCard: {
    marginTop: space.sm,
  },
  quote: {
    borderLeftWidth: 2,
    paddingLeft: space.sm,
    marginBottom: space.sm,
  },
  // The ticket's textMid all but vanishes on an ink bubble, so your own
  // quotes use a dimmed inverse instead.
  quoteMine: {
    borderLeftColor: withAlpha(color.inverse, 0.5),
  },
  quoteTheirs: {
    borderLeftColor: color.textMid,
  },
  quoteName: {
    fontFamily: type.bodyBold,
    fontSize: 13,
  },
  quoteText: {
    fontFamily: type.body,
    fontSize: 13,
    lineHeight: 18,
  },
  quoteTextMine: {
    color: withAlpha(color.inverse, 0.7),
  },
  quoteTextTheirs: {
    color: color.textMid,
  },
  card: {
    minWidth: 200,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardText: {
    flex: 1,
    marginLeft: space.sm,
  },
  thumbnail: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    backgroundColor: color.bgPanel,
  },
  textThumbnail: {
    justifyContent: 'center',
    padding: space.xs,
  },
  textThumbnailCopy: {
    fontFamily: type.body,
    fontSize: 12,
    lineHeight: 14,
    color: color.text,
  },
  author: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  authorName: {
    flexShrink: 1,
    fontFamily: type.bodyBold,
    fontSize: 13,
    color: color.text,
  },
  profileName: {
    fontFamily: type.bodyBold,
    fontSize: 15,
    color: color.text,
  },
  cardLine: {
    marginTop: 2,
    fontFamily: type.body,
    fontSize: 13,
    color: color.textMid,
  },
  meta: {
    marginTop: space.xs,
    fontFamily: type.body,
    fontSize: 12,
    color: color.textMuted,
  },
  metaMine: {
    textAlign: 'right',
  },
});

export default MessageBubble;
