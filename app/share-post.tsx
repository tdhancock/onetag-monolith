import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../store/AppContext.native';
import { useCurrentProfile, searchUsers } from '../features/profiles';
import { fetchPostById as getPostById } from '../features/posts';
import { useSendMessage } from '../features/messages';
import { Button, ListRow, Skeleton, TextField } from '../components/native/ui';
import { SearchIcon } from '../components/native/Icons';
import { firstLine } from '../lib/screens/profile';
import { color, space, type } from '../theme/tokens';
import type { Post } from '../types';

/** The fewest characters a search needs, as before. */
const MIN_QUERY_LENGTH = 2;
const PREVIEW_THUMBNAIL_SIZE = 48;

/**
 * The post being shared: its photo or first line, and one line of copy.
 * `undefined` while it loads; `null` if it could not be found.
 */
const PostPreview: React.FC<{ post: Post | null | undefined }> = ({ post }) => {
  if (post === null) {
    return (
      <View style={styles.preview}>
        <Text style={styles.previewLine}>This post is no longer available.</Text>
      </View>
    );
  }
  if (!post) {
    return (
      <View style={styles.preview}>
        <Skeleton width={PREVIEW_THUMBNAIL_SIZE} height={PREVIEW_THUMBNAIL_SIZE} />
        <View style={styles.previewText}>
          <Skeleton width={120} height={12} />
          <Skeleton width={180} height={10} style={styles.skeletonGap} />
        </View>
      </View>
    );
  }
  const hasImage = post.media_type === 'image' && Boolean(post.media);
  return (
    <View style={styles.preview} accessible accessibilityLabel={`Sharing a post by ${post.username}`}>
      {hasImage ? (
        <Image
          source={{ uri: post.media }}
          placeholder={post.media_preview_url ? { uri: post.media_preview_url } : undefined}
          style={styles.previewThumbnail}
          contentFit="cover"
        />
      ) : (
        <View style={[styles.previewThumbnail, styles.textThumbnail]}>
          <Text style={styles.textThumbnailCopy} numberOfLines={3}>
            {firstLine(post.content)}
          </Text>
        </View>
      )}
      <View style={styles.previewText}>
        <Text style={styles.previewAuthor} numberOfLines={1}>
          {post.username}
        </Text>
        {post.content ? (
          <Text style={styles.previewLine} numberOfLines={1}>
            {firstLine(post.content)}
          </Text>
        ) : null}
      </View>
    </View>
  );
};

/**
 * Share a post to a conversation (DM). In-app only — no external sharing.
 */
export default function SharePostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { addToast } = useApp();

  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  // Who this post has gone to on this visit, and who it is going to now. A
  // row stays in the list once sent, reading "Sent", so the picker can send
  // to several people.
  const [sentTo, setSentTo] = useState<Set<string>>(() => new Set());
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  // The sender is the profile being acted as. This used to read the auth
  // user off the session, which stops being a profile id after ONE-21.
  const { profileId: currentUserId } = useCurrentProfile();
  const sendMessage = useSendMessage(currentUserId);

  useEffect(() => {
    if (!id) return;
    getPostById(id).then((p) => setPost(p ?? null)).catch(() => setPost(null));
  }, [id]);

  const handleSearch = async (text: string) => {
    setSearchQuery(text);
    if (text.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      return;
    }
    try {
      const users = await searchUsers(text.trim());
      setResults(users || []);
    } catch (error) {
      console.error('User search error:', error);
      setResults([]);
    }
  };

  const handleSendToUser = async (receiver: any) => {
    if (!post || !currentUserId || sendingTo || sentTo.has(receiver.id)) return;
    setSendingTo(receiver.id);
    try {
      await sendMessage.mutateAsync({ receiverId: receiver.id, post });
      setSentTo((prev) => new Set(prev).add(receiver.id));
    } catch (error) {
      console.error('Failed to share post to messages', error);
      addToast('Failed to share post.', 'error');
    } finally {
      setSendingTo(null);
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    const sent = sentTo.has(item.id);
    return (
      <ListRow
        title={item.full_name || item.username}
        subtitle={`@${item.username}`}
        avatarUri={item.avatar_url || item.avatar || null}
        verified={item.is_verified}
        trailing={
          <Button
            size="sm"
            variant={sent ? 'outline' : 'primary'}
            onPress={() => handleSendToUser(item)}
            loading={sendingTo === item.id}
            disabled={sent || !post || (sendingTo !== null && sendingTo !== item.id)}
          >
            {sent ? 'Sent' : 'Send'}
          </Button>
        }
      />
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: 'Send to' }} />

      <PostPreview post={post} />

      <View style={styles.searchBar}>
        <TextField
          value={searchQuery}
          onChangeText={handleSearch}
          placeholder="Search"
          leading={<SearchIcon color={color.textMuted} size={18} />}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          inputStyle={styles.searchInput}
          accessibilityLabel="Search people to send to"
        />
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        extraData={[sentTo, sendingTo, post]}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={styles.hint}>
            {searchQuery.trim().length < MIN_QUERY_LENGTH
              ? 'Type at least 2 characters to search'
              : `No results for "${searchQuery.trim()}"`}
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: space.lg,
    marginTop: space.md,
    padding: space.sm,
    borderWidth: 1,
    borderColor: color.border,
  },
  previewThumbnail: {
    width: PREVIEW_THUMBNAIL_SIZE,
    height: PREVIEW_THUMBNAIL_SIZE,
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
  previewText: {
    flex: 1,
    marginLeft: space.md,
  },
  previewAuthor: {
    fontFamily: type.bodyBold,
    fontSize: 15,
    color: color.text,
  },
  previewLine: {
    marginTop: 2,
    fontFamily: type.body,
    fontSize: 13,
    color: color.textMid,
  },
  skeletonGap: {
    marginTop: space.sm,
  },
  searchBar: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  searchInput: {
    minHeight: 44,
    paddingVertical: space.sm,
  },
  hint: {
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    fontFamily: type.body,
    fontSize: 15,
    color: color.textMid,
    textAlign: 'center',
  },
});
