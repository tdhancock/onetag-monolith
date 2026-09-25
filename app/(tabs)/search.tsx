import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ScrollView,
  RefreshControl,
  Dimensions,
  Keyboard,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useApp } from '../../store/AppContext.native';
import { useFollowState, useToggleFollow, useCurrentProfile, searchUsers } from '../../features/profiles';
import { fetchTrendingPosts as getTrendingPosts } from '../../features/posts';
import { useHashtagsQuery } from '../../features/hashtags';
import { Button, EmptyState, ListRow, MonoLabel, Pressable, Skeleton, TextField } from '../../components/native/ui';
import { SearchIcon } from '../../components/native/Icons';
import {
  EXPLORE_COLUMNS,
  EXPLORE_GRID_GAP,
  exploreTileGapRight,
  exploreTileSize,
  hashtagPostCount,
  matchingHashtags,
  noResultsLabel,
} from '../../lib/screens/explore';
import { firstLine } from '../../lib/screens/profile';
import { color, space, type } from '../../theme/tokens';
import type { Post, SimpleUser, Hashtag } from '../../types';

const tileSize = exploreTileSize(Dimensions.get('window').width);
/** Tiles shown while the grid loads: four rows. */
const SKELETON_TILES = EXPLORE_COLUMNS * 4;
/** Placeholder people rows while a search is in flight. */
const SKELETON_ROWS = 3;
const HASH_TILE_SIZE = 40;

// ─── Sub-components ──────────────────────────────

/** One square of the trending grid: the photo, or a text post's first line. */
const ExploreTile: React.FC<{ post: Post; index: number; onPress: () => void }> = React.memo(
  ({ post, index, onPress }) => {
    const isTextPost = post.media_type === 'text' || !post.media;
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Post by ${post.username}`}
        style={[styles.tile, { marginRight: exploreTileGapRight(index) }]}
      >
        {isTextPost ? (
          <View style={styles.textTile}>
            <Text style={styles.textTileCopy} numberOfLines={5}>
              {firstLine(post.content)}
            </Text>
          </View>
        ) : (
          <Image
            // The preview is a 50px blur-up, not something to show on its own.
            source={{ uri: post.media }}
            placeholder={post.media_preview_url ? { uri: post.media_preview_url } : undefined}
            style={styles.fill}
            contentFit="cover"
            transition={200}
          />
        )}
      </Pressable>
    );
  },
);

/** The grid's shape, pulsing, while trending posts load. */
const GridSkeleton: React.FC = () => (
  <View style={styles.skeletonGrid}>
    {Array.from({ length: SKELETON_TILES }, (_, i) => (
      <Skeleton
        key={i}
        width={tileSize}
        height={tileSize}
        style={{ marginRight: exploreTileGapRight(i), marginBottom: EXPLORE_GRID_GAP }}
      />
    ))}
  </View>
);

/** A ListRow-shaped placeholder. */
const RowSkeleton: React.FC = () => (
  <View style={styles.skeletonRow}>
    <Skeleton circle height={40} />
    <View style={styles.skeletonText}>
      <Skeleton width={140} height={12} />
      <Skeleton width={90} height={10} style={styles.skeletonGap} />
    </View>
  </View>
);

/** The `#` square that leads a hashtag row. */
const HashTile: React.FC = () => (
  <View style={styles.hashTile}>
    <Text style={styles.hashGlyph}>#</Text>
  </View>
);

// ─── Search Screen ───────────────────────────────

export default function SearchScreen() {
  const router = useRouter();
  const { isUserBlocked } = useApp();
  const { profile: userProfile, profileId } = useCurrentProfile();
  const { isFollowing } = useFollowState(profileId);
  const follow = useToggleFollow(profileId);
  const searchRef = useRef<TextInput>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const [trendingPosts, setTrendingPosts] = useState<Post[]>([]);
  const [userResults, setUserResults] = useState<SimpleUser[]>([]);
  const [isUserSearchLoading, setIsUserSearchLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // ─── Data loading ──────────────────────────────

  // Hashtags come from the query cache; trending posts are still on the old
  // path until the feed migration ticket moves them.
  const {
    data: hashtags = [],
    isLoading: hashtagsLoading,
    refetch: refetchHashtags,
  } = useHashtagsQuery();

  const loadExploreData = useCallback(async () => {
    try {
      const postsData = await getTrendingPosts();
      setTrendingPosts(postsData);
      setLoadFailed(false);
    } catch (error) {
      console.error('Search data load error:', error);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // The grid waits on both sources, exactly as it did when they loaded
  // together.
  const isExploreLoading = loading || hashtagsLoading;

  useEffect(() => {
    loadExploreData();
  }, [loadExploreData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadExploreData(), refetchHashtags()]);
    setRefreshing(false);
  }, [loadExploreData, refetchHashtags]);

  const retry = useCallback(() => {
    setLoading(true);
    void loadExploreData();
    void refetchHashtags();
  }, [loadExploreData, refetchHashtags]);

  // ─── User search with debounce ─────────────────

  useEffect(() => {
    if (!isSearching || !searchTerm.trim()) {
      setUserResults([]);
      setIsUserSearchLoading(false);
      return;
    }

    setIsUserSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const usersFromApi = await searchUsers(searchTerm);
        const mapped: SimpleUser[] = usersFromApi.map((u: any) => ({
          id: u.id,
          name: u.full_name,
          username: u.username,
          avatar: u.avatar_url,
          isVerified: u.is_verified,
        }));
        setUserResults(mapped.filter(u => !isUserBlocked(u.username)));
      } catch (error) {
        console.error('User search error:', error);
      } finally {
        setIsUserSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm, isSearching, isUserBlocked]);

  // ─── Filtered data ─────────────────────────────

  const filteredHashtags = useMemo(() => matchingHashtags(hashtags, searchTerm), [hashtags, searchTerm]);

  const visibleExplorePosts = useMemo(
    () => trendingPosts.filter(p => !isUserBlocked(p.username)),
    [trendingPosts, isUserBlocked],
  );

  // ─── Navigation ────────────────────────────────

  const handleViewProfile = useCallback((username: string) => {
    router.push(`/user/${username}`);
  }, [router]);

  const handleViewPost = useCallback((post: Post) => {
    router.push(`/post/${post.id}`);
  }, [router]);

  const cancelSearch = () => {
    setIsSearching(false);
    setSearchTerm('');
    searchRef.current?.blur();
    Keyboard.dismiss();
  };

  // ─── Render search results ─────────────────────

  const renderPerson = (user: SimpleUser) => {
    const following = isFollowing(user.username);
    const isMe = userProfile?.username === user.username;
    return (
      <ListRow
        key={user.id || user.username}
        title={user.name || user.username}
        subtitle={`@${user.username}`}
        avatarUri={user.avatar}
        verified={user.isVerified}
        onPress={() => handleViewProfile(user.username)}
        accessibilityLabel={`View ${user.username}'s profile`}
        trailing={
          isMe ? null : (
            <Button
              size="sm"
              variant={following ? 'outline' : 'primary'}
              onPress={() => follow.toggle({ userId: user.id, username: user.username })}
              disabled={follow.isPending}
            >
              {following ? 'Following' : 'Follow'}
            </Button>
          )
        }
      />
    );
  };

  const renderHashtag = (hashtag: Hashtag) => (
    <ListRow
      key={hashtag.tag}
      title={`#${hashtag.tag}`}
      subtitle={hashtagPostCount(hashtag.postCount)}
      leading={<HashTile />}
    />
  );

  const renderSearchContent = () => {
    if (!searchTerm.trim()) {
      return <Text style={styles.hint}>Search for people and hashtags.</Text>;
    }

    const noPeople = !isUserSearchLoading && userResults.length === 0;
    if (noPeople && filteredHashtags.length === 0) {
      return <Text style={styles.hint}>{noResultsLabel(searchTerm)}</Text>;
    }

    return (
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.results}>
        {!noPeople ? (
          <View>
            <MonoLabel color="textMid" style={styles.sectionHeader}>People</MonoLabel>
            {isUserSearchLoading
              ? Array.from({ length: SKELETON_ROWS }, (_, i) => <RowSkeleton key={i} />)
              : userResults.map(renderPerson)}
          </View>
        ) : null}
        {filteredHashtags.length > 0 ? (
          <View>
            <MonoLabel color="textMid" style={styles.sectionHeader}>Hashtags</MonoLabel>
            {filteredHashtags.map(renderHashtag)}
          </View>
        ) : null}
      </ScrollView>
    );
  };

  // ─── Render explore grid ───────────────────────

  const renderExploreItem = useCallback(
    ({ item, index }: { item: Post; index: number }) => (
      <ExploreTile post={item} index={index} onPress={() => handleViewPost(item)} />
    ),
    [handleViewPost],
  );

  const renderGrid = () => {
    if (isExploreLoading) return <GridSkeleton />;

    if (loadFailed && visibleExplorePosts.length === 0) {
      return (
        <EmptyState
          title="Couldn't load Explore"
          body="Check your connection and try again."
          action={{ label: 'Retry', onPress: retry }}
        />
      );
    }

    return (
      <FlatList
        data={visibleExplorePosts}
        renderItem={renderExploreItem}
        keyExtractor={item => item.id}
        numColumns={EXPLORE_COLUMNS}
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
            title="Nothing to explore yet"
            body="As more posts are created, they will appear here."
            action={{ label: 'Create a post', onPress: () => router.push('/compose') }}
          />
        }
        contentContainerStyle={styles.fillGrow}
      />
    );
  };

  // ─── Main render ───────────────────────────────

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <TextField
          ref={searchRef}
          placeholder="Search"
          value={searchTerm}
          onChangeText={setSearchTerm}
          onFocus={() => setIsSearching(true)}
          leading={<SearchIcon color={color.textMuted} size={18} />}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          containerStyle={styles.fill}
          inputStyle={styles.searchInput}
          accessibilityLabel="Search"
        />
        {isSearching ? (
          <Pressable
            onPress={cancelSearch}
            accessibilityRole="button"
            accessibilityLabel="Cancel search"
            hitSlop={8}
            style={styles.cancel}
          >
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Content */}
      {isSearching ? renderSearchContent() : renderGrid()}
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  searchInput: {
    minHeight: 44,
    paddingVertical: space.sm,
  },
  cancel: {
    minHeight: 44,
    justifyContent: 'center',
    marginLeft: space.md,
  },
  cancelLabel: {
    fontFamily: type.bodyMedium,
    fontSize: 15,
    color: color.text,
  },
  results: {
    paddingBottom: space.xl,
  },
  sectionHeader: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  hint: {
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    fontFamily: type.body,
    fontSize: 15,
    color: color.textMid,
    textAlign: 'center',
  },
  hashTile: {
    width: HASH_TILE_SIZE,
    height: HASH_TILE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.bgPanel,
  },
  hashGlyph: {
    fontFamily: type.bodyBold,
    fontSize: 17,
    color: color.text,
  },
  tile: {
    width: tileSize,
    height: tileSize,
    marginBottom: EXPLORE_GRID_GAP,
    backgroundColor: color.bgPanel,
  },
  textTile: {
    flex: 1,
    padding: space.sm,
    justifyContent: 'center',
  },
  textTileCopy: {
    fontFamily: type.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
    color: color.text,
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
