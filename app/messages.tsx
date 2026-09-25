import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TextInput, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../store/AppContext.native';
import { getUserProfile, searchUsers, useCurrentProfile } from '../features/profiles';
import {
  useConversationsQuery,
  useThreadQuery,
  useUnreadChats,
  useSendMessage,
  useMarkChatRead,
  useMarkAllMessagesRead,
  useDeleteConversation,
  isPendingMessage,
} from '../features/messages';
import { cleanHtml } from '../lib/cleanHtml';
import { bubbleGapAbove, endsRun, lastOwnMessageId, messageMetaLabel } from '../lib/screens/messages';
import MessageBubble from '../components/native/MessageBubble';
import KeyboardAvoider from '../components/native/KeyboardAvoider';
import {
  Avatar,
  EmptyState,
  IconButton,
  ListRow,
  Pressable,
  Sheet,
  SheetRow,
  Skeleton,
  TextField,
} from '../components/native/ui';
import { ArrowLeftIcon, PencilAltIcon, ReplyIcon, SearchIcon, SendIcon, TrashIcon, XIcon } from '../components/native/Icons';
import { color, space, type } from '../theme/tokens';
import type { Message, Post, SimpleUser } from '../types';

const EMPTY_MESSAGES: Message[] = [];

/** Placeholder rows while the inbox or a search loads. */
const SKELETON_ROWS = 6;
/** The inbox's avatars are a step larger than a plain list's. */
const CONVERSATION_AVATAR_SIZE = 52;
/** The composer grows with its text up to about four lines, then scrolls. */
const COMPOSER_MAX_HEIGHT = 4 * 21 + 2 * space.md;

/** A conversation-row-shaped placeholder. */
const RowSkeleton: React.FC<{ avatarSize?: number }> = ({ avatarSize = 40 }) => (
  <View style={styles.skeletonRow}>
    <Skeleton circle height={avatarSize} />
    <View style={styles.skeletonText}>
      <Skeleton width={140} height={12} />
      <Skeleton width={90} height={10} style={styles.skeletonGap} />
    </View>
  </View>
);

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

// ─── Messages Screen ──────────────────────────

export default function MessagesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ chatWith?: string }>();
  const { addToast, triggerHapticFeedback } = useApp();
  const { profile: userProfile, profileId } = useCurrentProfile();
  const userId = profileId;

  const [chatWith, setChatWith] = useState<SimpleUser | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Conversations, the open thread and unread state are queries (ONE-18),
  // kept live by the realtime hook AppContext mounts for the session.
  const conversations = useConversationsQuery(userId);
  const chatUsers = conversations.data ?? [];
  const thread = useThreadQuery(userId, chatWith?.id);
  const messages = thread.data ?? EMPTY_MESSAGES;
  const unreadChats = useUnreadChats(userId);

  const sendMessage = useSendMessage(userId);
  const markChatRead = useMarkChatRead(userId);
  const markAllRead = useMarkAllMessagesRead(userId);
  const deleteConversation = useDeleteConversation(userId);

  // Search
  const [userSearchResults, setUserSearchResults] = useState<SimpleUser[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);

  // The conversation a long press picked, for the delete sheet.
  const [userToDelete, setUserToDelete] = useState<SimpleUser | null>(null);
  // The message a long press picked, for the options sheet.
  const [messageForOptions, setMessageForOptions] = useState<Message | null>(null);

  const inputRef = useRef<TextInput>(null);
  const searchRef = useRef<TextInput>(null);

  const focusSearch = useCallback(() => searchRef.current?.focus(), []);

  // Mark messages read on mount (list view)
  useEffect(() => {
    if (userId && !params.chatWith) {
      markAllRead.mutate();
    }
  }, [userId, params.chatWith]);

  // Open chat from params (e.g. from profile "Message" button)
  useEffect(() => {
    if (!params.chatWith) return;
    const findAndOpen = async () => {
      const profile = await getUserProfile(params.chatWith!);
      if (profile) {
        const userToChat: SimpleUser = {
          id: profile.id,
          username: profile.username,
          name: profile.name,
          avatar: profile.profilePicture,
          isVerified: profile.isVerified,
          bio: profile.bio,
        };
        openChat(userToChat);
      } else {
        addToast(`User @${params.chatWith} not found.`, 'error');
      }
    };
    findAndOpen();
  }, [params.chatWith]);

  const openChat = (user: SimpleUser) => {
    setSearchTerm('');
    setUserSearchResults([]);
    setChatWith(user);
    if (userId && user.id) {
      markChatRead.mutate(user.id, {
        onError: () => addToast("Couldn't mark messages as read.", 'error'),
      });
    }
  };

  // User search with debounce
  useEffect(() => {
    if (!searchTerm.trim()) {
      setUserSearchResults([]);
      setIsSearchingUsers(false);
      return;
    }

    setIsSearchingUsers(true);
    const timer = setTimeout(async () => {
      try {
        const usersFromApi = await searchUsers(searchTerm);
        const mapped: SimpleUser[] = usersFromApi.map((u: any) => ({
          id: u.id,
          name: u.full_name,
          username: u.username,
          avatar: u.avatar_url,
          isVerified: u.is_verified,
          bio: u.bio || undefined,
        }));
        setUserSearchResults(mapped.filter(u => u.id !== userId));
      } catch (error) {
        console.error('Error searching users:', error);
      } finally {
        setIsSearchingUsers(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm, userId]);

  const closeChat = () => {
    setChatWith(null);
    setReplyingTo(null);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await conversations.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [conversations]);

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

  const handleDeleteChat = () => {
    if (!userToDelete || !userId) return;
    const otherUserId = userToDelete.id;
    setUserToDelete(null);

    deleteConversation.mutate(otherUserId, {
      onSuccess: () => addToast('Conversation deleted.', 'info'),
      onError: (error) => {
        console.error('Failed to delete chat:', error);
        addToast('Failed to delete conversation.', 'error');
      },
    });
  };

  const usernameOf = (senderId: string, other: SimpleUser) =>
    senderId === profileId ? userProfile?.username : other.username;

  // ─── Chat View ────────────────────────────────

  if (chatWith) {
    const lastOwnId = lastOwnMessageId(messages, profileId);
    const canSend = newMessage.trim().length > 0;
    const displayName = chatWith.name || chatWith.username;

    const renderMessage = ({ item: msg, index }: { item: Message; index: number }) => {
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
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.threadList}
        />
      );
    };

    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <Stack.Screen
          options={{
            headerShown: true,
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
            headerLeft: () => (
              <IconButton
                icon={<ArrowLeftIcon color={color.text} size={22} />}
                accessibilityLabel="Back to messages"
                onPress={closeChat}
              />
            ),
            headerRight: () => null,
          }}
        />

        {/* Measures itself against the keyboard, so the modal's header height
            never has to be guessed (see KeyboardAvoider). */}
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

  // ─── Chat List View ───────────────────────────

  const renderChatUser = ({ item: user }: { item: SimpleUser }) => {
    const hasUnread = unreadChats.has(user.id);
    const name = user.name || user.username;

    return (
      <ListRow
        title={name}
        subtitle={`@${user.username}`}
        verified={user.isVerified}
        leading={<Avatar uri={user.avatar} name={name} size={CONVERSATION_AVATAR_SIZE} />}
        trailing={hasUnread ? <View style={styles.unreadDot} /> : null}
        onPress={() => openChat(user)}
        onLongPress={() => {
          triggerHapticFeedback();
          setUserToDelete(user);
        }}
        accessibilityLabel={`${hasUnread ? 'Unread. ' : ''}Conversation with ${user.username}`}
        accessibilityHint="Long press to delete the conversation"
      />
    );
  };

  const renderSearchResult = ({ item: user }: { item: SimpleUser }) => (
    <ListRow
      title={user.name || user.username}
      subtitle={`@${user.username}`}
      avatarUri={user.avatar}
      verified={user.isVerified}
      onPress={() => openChat(user)}
      accessibilityLabel={`Message ${user.username}`}
    />
  );

  const skeletonRows = (avatarSize?: number) => (
    <View>
      {Array.from({ length: SKELETON_ROWS }, (_, i) => <RowSkeleton key={i} avatarSize={avatarSize} />)}
    </View>
  );

  const renderInbox = () => {
    if (searchTerm.trim()) {
      if (isSearchingUsers) return skeletonRows();
      if (userSearchResults.length === 0) {
        return <Text style={styles.noResults}>No results for "{searchTerm.trim()}"</Text>;
      }
      return (
        <FlatList
          data={userSearchResults}
          keyExtractor={item => item.id}
          renderItem={renderSearchResult}
          keyboardShouldPersistTaps="handled"
        />
      );
    }

    if (conversations.isLoading) return skeletonRows(CONVERSATION_AVATAR_SIZE);

    if (conversations.isError && !conversations.data) {
      return (
        <EmptyState
          title="Couldn't load your messages"
          body="Check your connection and try again."
          action={{ label: 'Retry', onPress: () => void conversations.refetch() }}
        />
      );
    }

    return (
      <FlatList
        data={chatUsers}
        keyExtractor={item => item.id}
        renderItem={renderChatUser}
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
          <EmptyState
            title="No messages yet"
            body="Search for someone to start a conversation."
            action={{ label: 'Find people', onPress: focusSearch }}
          />
        }
        contentContainerStyle={styles.fillGrow}
      />
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Messages',
          // Reset what the thread view set, since options merge.
          headerTitle: undefined,
          headerLeft: undefined,
          headerRight: () => (
            <IconButton
              icon={<PencilAltIcon color={color.text} size={22} />}
              accessibilityLabel="New message"
              onPress={focusSearch}
            />
          ),
        }}
      />

      <View style={styles.searchBar}>
        <TextField
          ref={searchRef}
          value={searchTerm}
          onChangeText={setSearchTerm}
          placeholder="Search"
          leading={<SearchIcon color={color.textMuted} size={18} />}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          inputStyle={styles.searchInput}
          accessibilityLabel="Search people"
        />
      </View>

      {renderInbox()}

      <Sheet
        visible={!!userToDelete}
        onClose={() => setUserToDelete(null)}
        title={userToDelete ? `Conversation with @${userToDelete.username}` : undefined}
      >
        <SheetRow
          label="Delete for both sides"
          icon={<TrashIcon color={color.heart} size={20} />}
          destructive
          onPress={handleDeleteChat}
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
  fillGrow: {
    flexGrow: 1,
  },
  searchBar: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  searchInput: {
    minHeight: 44,
    paddingVertical: space.sm,
  },
  noResults: {
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    fontFamily: type.body,
    fontSize: 15,
    color: color.textMid,
    textAlign: 'center',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.text,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  skeletonText: {
    marginLeft: space.md,
  },
  skeletonGap: {
    marginTop: space.sm,
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
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingVertical: space.md,
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
