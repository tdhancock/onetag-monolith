import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, TextInput, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile, useProfileQuery } from '../../features/profiles';
import { useThreadQuery, useSendMessage, useMarkChatRead, useOlderMessages, isPendingMessage } from '../../features/messages';
import { cleanHtml } from '../../lib/cleanHtml';
import { bubbleGapAbove, endsRun, lastOwnMessageId, messageMetaLabel } from '../../lib/screens/messages';
import MessageBubble from '../../components/native/MessageBubble';
import KeyboardAvoider from '../../components/native/KeyboardAvoider';
import { Avatar, EmptyState, IconButton, Pressable, Sheet, SheetRow, Skeleton, TextField } from '../../components/native/ui';
import { ReplyIcon, SendIcon, XIcon } from '../../components/native/Icons';
import { color, space, type } from '../../theme/tokens';
import type { Message, Post, SimpleUser } from '../../types';

const EMPTY_MESSAGES: Message[] = [];

/** The composer grows with its text up to about four lines, then scrolls. */
const COMPOSER_MAX_HEIGHT = 4 * 21 + 2 * space.md;

/** Bubble-shaped placeholders, alternating sides, while a thread loads. */
const ThreadSkeleton: React.FC = () => (
  <View style={styles.threadSkeleton}>
    {[180, 120, 220, 150].map((width, i) => (
      <View key={i} style={[styles.skeletonBubbleRow, i % 2 === 1 && styles.skeletonBubbleMine]}>
        <Skeleton width={width} height={36} />
      </View>
    ))}
  </View>
);

/**
 * One conversation, at /messages/<username>: its own screen, pushed from the
 * inbox, a profile's Message button or a message's push. It used to be a
 * state of the Messages screen, so Back in its header went to the inbox but
 * the iOS swipe back left Messages altogether.
 */
export default function MessageThreadScreen() {
  const router = useRouter();
  const { username } = useLocalSearchParams<{ username: string }>();
  const { addToast, triggerHapticFeedback } = useApp();
  const { profile: userProfile, profileId } = useCurrentProfile();
  const userId = profileId;

  // Who the conversation is with, by the handle in the route.
  const profileQuery = useProfileQuery(username);
  const chatWith: SimpleUser | null = useMemo(() => {
    const profile = profileQuery.data;
    return profile
      ? {
          id: profile.id,
          username: profile.username,
          name: profile.name,
          avatar: profile.profilePicture,
          isVerified: profile.isVerified,
          bio: profile.bio,
        }
      : null;
  }, [profileQuery.data]);

  const [newMessage, setNewMessage] = useState('');
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  // The message a long press picked, for the options sheet.
  const [messageForOptions, setMessageForOptions] = useState<Message | null>(null);
  const inputRef = useRef<TextInput>(null);

  // The thread and its unread state are queries (ONE-18), kept live by the
  // realtime hook AppContext mounts for the session.
  const thread = useThreadQuery(userId, chatWith?.id);
  const messages = thread.data ?? EMPTY_MESSAGES;
  // The list is inverted, newest first, so a thread opens on its latest
  // messages and scrolling up to its end loads the page before (ONE-110).
  const newestFirst = useMemo(() => [...messages].reverse(), [messages]);
  const older = useOlderMessages(userId, chatWith?.id, messages.length);
  const sendMessage = useSendMessage(userId);
  const markChatRead = useMarkChatRead(userId);

  // Opening the thread reads it, and so does a message arriving while it's
  // open: before, that one counted as unread, on the badge and for its
  // sender, until the thread was left and opened again.
  const { mutate: markRead } = markChatRead;
  const unreadInThread = useMemo(
    () => (chatWith ? messages.filter((m) => m.sender_id === chatWith.id && m.seen === false).length : 0),
    [messages, chatWith],
  );
  useEffect(() => {
    if (!userId || !chatWith?.id) return;
    markRead(chatWith.id, { onError: () => addToast("Couldn't mark messages as read.", 'error') });
  }, [userId, chatWith?.id, markRead, addToast]);
  useEffect(() => {
    if (userId && chatWith?.id && unreadInThread > 0) markRead(chatWith.id);
  }, [userId, chatWith?.id, unreadInThread, markRead]);

  const handleSendMessage = () => {
    if (!newMessage.trim() || !chatWith || !userId) return;

    // The mutation appends the message with a temporary id at once, swaps in
    // the server row where it sits, and takes it out again if the send fails.
    sendMessage.mutate(
      {
        receiverId: chatWith.id,
        text: cleanHtml(newMessage.trim()),
        replyTo: replyingTo,
      },
      {
        onError: (error) => {
          console.error('Error sending message:', error);
          addToast('Failed to send message.', 'error');
        },
      },
    );

    setNewMessage('');
    setReplyingTo(null);
  };

  const usernameOf = (senderId: string, other: SimpleUser) =>
    senderId === profileId ? userProfile?.username : other.username;

  if (profileQuery.isPending) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <Stack.Screen options={{ title: `@${username ?? ''}` }} />
        <ThreadSkeleton />
      </SafeAreaView>
    );
  }

  if (!chatWith) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Message' }} />
        <EmptyState
          title="This account isn't available"
          body={`There's no one called @${username ?? ''} to message.`}
          action={{ label: 'Back', onPress: () => router.back() }}
        />
      </SafeAreaView>
    );
  }

  const lastOwnId = lastOwnMessageId(messages, profileId);
  const canSend = newMessage.trim().length > 0;
  const displayName = chatWith.name || chatWith.username;

  const renderMessage = ({ item: msg, index: listIndex }: { item: Message; index: number }) => {
    // The list runs newest first; the layout rules read the thread oldest first.
    const index = messages.length - 1 - listIndex;
    const mine = msg.sender_id === profileId;
    const pending = isPendingMessage(msg);
    return (
      <MessageBubble
        message={msg}
        mine={mine}
        gapAbove={bubbleGapAbove(messages, index)}
        meta={messageMetaLabel({
          message: msg,
          endsRun: endsRun(messages, index),
          isLastOwn: msg.id === lastOwnId,
          isPending: pending,
        })}
        quotedUsername={msg.repliedMessage ? usernameOf(msg.repliedMessage.sender_id, chatWith) : null}
        // A message still on its way has no server id to reply to.
        onLongPress={
          pending
            ? undefined
            : () => {
                triggerHapticFeedback();
                setMessageForOptions(msg);
              }
        }
        onOpenPost={(post: Post) => router.push(`/post/${post.id}`)}
        onOpenProfile={(user: SimpleUser) => router.push(`/user/${user.username}`)}
      />
    );
  };

  const renderThread = () => {
    if (thread.isLoading) return <ThreadSkeleton />;
    if (messages.length === 0) {
      return (
        <View style={styles.emptyThread}>
          <Avatar uri={chatWith.avatar} name={displayName} size={56} />
          <Text style={styles.emptyThreadName}>{displayName}</Text>
          <Text style={styles.emptyThreadBody}>Say hi to @{chatWith.username}</Text>
        </View>
      );
    }
    return (
      <FlatList
        data={newestFirst}
        inverted
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        onEndReached={older.loadOlder}
        onEndReachedThreshold={0.5}
        // Inverted, the footer sits above the oldest message.
        ListFooterComponent={
          older.isLoading ? (
            <View style={styles.olderLoading}>
              <ActivityIndicator size="small" color={color.textMuted} accessibilityLabel="Loading earlier messages" />
            </View>
          ) : null
        }
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.threadList}
      />
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      {/* The native Back returns to the inbox, and so does the swipe. */}
      <Stack.Screen
        options={{
          title: displayName,
          headerTitle: () => (
            <Pressable
              onPress={() => router.push(`/user/${chatWith.username}`)}
              accessibilityRole="button"
              accessibilityLabel={`View ${chatWith.username}'s profile`}
              style={styles.threadHeader}
            >
              <Avatar uri={chatWith.avatar} name={displayName} size={32} />
              <Text style={styles.threadHeaderName} numberOfLines={1}>
                {displayName}
              </Text>
            </Pressable>
          ),
        }}
      />

      {/* Rides on the keyboard, so no header height has to be guessed
          (see KeyboardAvoider). */}
      <KeyboardAvoider style={styles.fill}>
        <View style={styles.fill}>{renderThread()}</View>

        {replyingTo ? (
          <View style={styles.replyBanner}>
            <View style={styles.fill}>
              <Text style={styles.replyTitle} numberOfLines={1}>
                Replying to @{usernameOf(replyingTo.sender_id, chatWith)}
              </Text>
              <Text style={styles.replyQuote} numberOfLines={1}>
                {replyingTo.text}
              </Text>
            </View>
            <IconButton
              icon={<XIcon color={color.textMid} size={18} />}
              accessibilityLabel="Cancel reply"
              onPress={() => setReplyingTo(null)}
            />
          </View>
        ) : null}

        {/* The composer, pinned above the keyboard and the home indicator. */}
        <View style={styles.composer}>
          <TextField
            ref={inputRef}
            value={newMessage}
            onChangeText={setNewMessage}
            placeholder="Message…"
            multiline
            // Return sends, as it always has here.
            submitBehavior="submit"
            returnKeyType="send"
            onSubmitEditing={handleSendMessage}
            containerStyle={styles.fill}
            inputStyle={styles.composerInput}
            accessibilityLabel="Message"
          />
          <IconButton
            icon={<SendIcon color={canSend ? color.text : color.textMuted} size={22} />}
            accessibilityLabel="Send"
            onPress={handleSendMessage}
            disabled={!canSend}
          />
        </View>
      </KeyboardAvoider>

      <Sheet visible={!!messageForOptions} onClose={() => setMessageForOptions(null)}>
        <SheetRow
          label="Reply"
          icon={<ReplyIcon color={color.text} size={20} />}
          onPress={() => {
            setReplyingTo(messageForOptions);
            setMessageForOptions(null);
            inputRef.current?.focus();
          }}
        />
      </Sheet>
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
  threadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    maxWidth: 240,
  },
  threadHeaderName: {
    flexShrink: 1,
    fontFamily: type.bodyBold,
    fontSize: 17,
    color: color.text,
  },
  threadList: {
    paddingVertical: space.md,
  },
  olderLoading: {
    paddingVertical: space.md,
    alignItems: 'center',
  },
  threadSkeleton: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.md,
  },
  skeletonBubbleRow: {
    alignItems: 'flex-start',
  },
  skeletonBubbleMine: {
    alignItems: 'flex-end',
  },
  emptyThread: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  emptyThreadName: {
    marginTop: space.md,
    fontFamily: type.bodyBold,
    fontSize: 17,
    color: color.text,
  },
  emptyThreadBody: {
    marginTop: space.xs,
    fontFamily: type.body,
    fontSize: 15,
    color: color.textMid,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space.lg,
    paddingRight: space.xs,
    paddingVertical: space.xs,
    backgroundColor: color.bgPanel,
  },
  replyTitle: {
    fontFamily: type.bodyBold,
    fontSize: 13,
    color: color.text,
  },
  replyQuote: {
    marginTop: 2,
    fontFamily: type.body,
    fontSize: 13,
    color: color.textMid,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.xs,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    paddingVertical: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.bg,
  },
  composerInput: {
    minHeight: 44,
    maxHeight: COMPOSER_MAX_HEIGHT,
    paddingVertical: space.sm,
  },
});
