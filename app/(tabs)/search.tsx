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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useApp } from '../../store/AppContext.native';
import { useFollowState, useToggleFollow, useCurrentProfile, searchUsers } from '../../features/profiles';
import { useExploreQuery, flattenExplorePages, type ExploreItem } from '../../features/explore';
import ExploreCard from '../../components/native/ExploreCard';
import { useHashtagsQuery } from '../../features/hashtags';
import { Button, EmptyState, ListRow, MonoLabel, Pressable, Skeleton, TextField } from '../../components/native/ui';
import { SearchIcon } from '../../components/native/Icons';
import {
  EXPLORE_COLUMNS,
  EXPLORE_GRID_GAP,
  exploreRoute,
  exploreTileGapRight,
  exploreTileSize,
  hashtagPostCount,
  matchingHashtags,
  noResultsLabel,
} from '../../lib/screens/explore';
import { color, space, type } from '../../theme/tokens';
import type { SimpleUser, Hashtag } from '../../types';

const tileSize = exploreTileSize(Dimensions.get('window').width);
/** Cells shown while the grid loads: three rows. */
const SKELETON_TILES = EXPLORE_COLUMNS * 3;
/** Placeholder people rows while a search is in flight. */
const SKELETON_ROWS = 3;
const HASH_TILE_SIZE = 40;

// ─── Sub-components ──────────────────────────────

/** The grid's shape, pulsing, while it loads. */
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

  const [userResults, setUserResults] = useState<SimpleUser[]>([]);
  const [isUserSearchLoading, setIsUserSearchLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // ─── Data loading ──────────────────────────────

  // Hashtags feed the search results; the grid is its own infinite query
  // (ONE-47), ordered and filtered on the server.
  const { data: hashtags = [], refetch: refetchHashtags } = useHashtagsQuery();
  const explore = useExploreQuery(profileId);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([explore.refetch(), refetchHashtags()]);
    setRefreshing(false);
  }, [explore, refetchHashtags]);

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

  // The server leaves out blocked accounts either way (explore_items). This
  // covers a block made since the page loaded, until the next refetch.
  const exploreItems = useMemo(
    () => flattenExplorePages(explore.data?.pages ?? []).filter(item => !isUserBlocked(item.ownerUsername)),
    [explore.data, isUserBlocked],
  );

  // ─── Navigation ────────────────────────────────

  const handleViewProfile = useCallback((username: string) => {
    router.push(`/user/${username}`);
  }, [router]);

  const handleOpenItem = useCallback((item: ExploreItem) => {
    router.push(exploreRoute(item) as never);
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
    ({ item, index }: { item: ExploreItem; index: number }) => (
      <ExploreCard
        item={item}
        size={tileSize}
        gapRight={exploreTileGapRight(index)}
        gapBottom={EXPLORE_GRID_GAP}
        onPress={() => handleOpenItem(item)}
      />
    ),
    [handleOpenItem],
  );

  const loadMore = useCallback(() => {
    // One page at a time: onEndReached can fire again before the page lands.
    if (explore.hasNextPage && !explore.isFetchingNextPage) void explore.fetchNextPage();
  }, [explore]);

  const renderGrid = () => {
    if (explore.isPending) return <GridSkeleton />;

    if (explore.isError && exploreItems.length === 0) {
      return (
        <EmptyState
          title="Couldn't load Explore"
          body="Check your connection and try again."
          action={{ label: 'Retry', onPress: () => void explore.refetch() }}
        />
      );
    }

    return (
      <FlatList
        data={exploreItems}
        renderItem={renderExploreItem}
        keyExtractor={item => item.key}
        numColumns={EXPLORE_COLUMNS}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        // The interest filter row's slot (ONE-49), above the grid.
        ListHeaderComponent={<View testID="explore-filter-slot" />}
        ListFooterComponent={explore.isFetchingNextPage ? <GridSkeleton /> : null}
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
            body="Follow people to fill your feed, or be the first to post, list a product or share a project."
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
