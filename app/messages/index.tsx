import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TextInput, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../store/AppContext.native';
import { searchUsers, useCurrentProfile } from '../../features/profiles';
import {
  useConversationsQuery,
  useUnreadChats,
  useMarkAllMessagesRead,
  useDeleteConversation,
  type Conversation,
} from '../../features/messages';
import { conversationPreview, messageThreadRoute } from '../../lib/screens/messages';
import { getTimeAgo } from '../../lib/timeAgo';
import { Avatar, EmptyState, IconButton, ListRow, Sheet, SheetRow, Skeleton, TextField } from '../../components/native/ui';
import { PencilAltIcon, SearchIcon, TrashIcon } from '../../components/native/Icons';
import { color, space, type } from '../../theme/tokens';
import type { SimpleUser } from '../../types';

/** Placeholder rows while the inbox or a search loads. */
const SKELETON_ROWS = 6;
/** The inbox's avatars are a step larger than a plain list's. */
const CONVERSATION_AVATAR_SIZE = 52;

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

// ─── Messages Screen ──────────────────────────

/**
 * The inbox: every conversation, newest first, with a search for someone new.
 * Each conversation opens as its own screen, /messages/<username>.
 */
export default function MessagesScreen() {
  const router = useRouter();
  const { addToast, triggerHapticFeedback } = useApp();
  const { profileId } = useCurrentProfile();
  const userId = profileId;

  const [searchTerm, setSearchTerm] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Conversations and unread state are queries (ONE-18), kept live by the
  // realtime hook AppContext mounts for the session.
  const conversations = useConversationsQuery(userId);
  const chatUsers = conversations.data ?? [];
  const unreadChats = useUnreadChats(userId);

  const markAllRead = useMarkAllMessagesRead(userId);
  const deleteConversation = useDeleteConversation(userId);

  // Search
  const [userSearchResults, setUserSearchResults] = useState<SimpleUser[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);

  // The conversation a long press picked, for the delete sheet.
  const [userToDelete, setUserToDelete] = useState<SimpleUser | null>(null);

  const searchRef = useRef<TextInput>(null);

  const focusSearch = useCallback(() => searchRef.current?.focus(), []);

  // Opening the inbox reads everything in it.
  const { mutate: markAll } = markAllRead;
  useEffect(() => {
    if (userId) markAll();
  }, [userId, markAll]);

  const openChat = (user: SimpleUser) => {
    setSearchTerm('');
    setUserSearchResults([]);
    router.push(messageThreadRoute(user.username));
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await conversations.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [conversations]);

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

  // ─── Chat List View ───────────────────────────

  const renderChatUser = ({ item: user }: { item: Conversation }) => {
    const hasUnread = unreadChats.has(user.id);
    const name = user.name || user.username;
    // The latest message under the name, and when it was sent beside it.
    const preview = conversationPreview(user.lastMessage, profileId);
    const sentAgo = getTimeAgo(user.lastMessage?.sentAt);

    return (
      <ListRow
        title={name}
        subtitle={preview ?? `@${user.username}`}
        verified={user.isVerified}
        leading={<Avatar uri={user.avatar} name={name} size={CONVERSATION_AVATAR_SIZE} />}
        trailing={
          sentAgo || hasUnread ? (
            <View style={styles.conversationMeta}>
              {sentAgo ? <Text style={[styles.sentAgo, hasUnread && styles.sentAgoUnread]}>{sentAgo}</Text> : null}
              {hasUnread ? <View style={styles.unreadDot} /> : null}
            </View>
          ) : null
        }
        onPress={() => openChat(user)}
        onLongPress={() => {
          triggerHapticFeedback();
          setUserToDelete(user);
        }}
        accessibilityLabel={[
          `${hasUnread ? 'Unread. ' : ''}Conversation with ${user.username}`,
          preview,
          sentAgo,
        ]
          .filter(Boolean)
          .join('. ')}
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
          automaticallyAdjustKeyboardInsets
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
        automaticallyAdjustKeyboardInsets
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
  conversationMeta: {
    alignItems: 'flex-end',
    gap: space.xs,
  },
  sentAgo: {
    fontFamily: type.body,
    fontSize: 12,
    color: color.textMuted,
  },
  sentAgoUnread: {
    fontFamily: type.bodyBold,
    color: color.text,
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
});
