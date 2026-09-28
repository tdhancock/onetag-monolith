import React, { useState, useCallback, useMemo, useRef } from 'react';
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
import { useFollowState, useToggleFollow, useCurrentProfile } from '../../features/profiles';
import {
  useProfileResultsQuery,
  usePostResultsQuery,
  useProductResultsQuery,
  useProjectResultsQuery,
  type SearchProfile,
  type SearchPost,
  type SearchProduct,
  type SearchProject,
} from '../../features/search';
import FilterChips from '../../components/native/FilterChips';
import InterestFilter, { useInterestName } from '../../components/native/InterestFilter';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { productRoute } from '../../lib/screens/products';
import { projectRoute } from '../../lib/screens/projects';
import { firstLine, followButton } from '../../lib/screens/profile';
import { useExploreQuery, flattenExplorePages, type ExploreItem } from '../../features/explore';
import ExploreCard from '../../components/native/ExploreCard';
import { useHashtagsQuery } from '../../features/hashtags';
import { Button, EmptyState, ListRow, MonoLabel, Pressable, Sheet, SheetRow, Skeleton, TextField } from '../../components/native/ui';
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
  NO_RESULTS_HINT,
  SEARCH_TABS,
  ALL_TAB_PREVIEW,
  categoriesOf,
  categoryFilterLabel,
  type SearchTab,
} from '../../lib/screens/explore';
import { color, space, type } from '../../theme/tokens';
import type { Hashtag } from '../../types';

const tileSize = exploreTileSize(Dimensions.get('window').width);
/** Cells shown while the grid loads: three rows. */
const SKELETON_TILES = EXPLORE_COLUMNS * 3;
/** Placeholder result rows while a search is in flight. */
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
  const { isFollowing, isRequested } = useFollowState(profileId);
  const follow = useToggleFollow(profileId);
  const searchRef = useRef<TextInput>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<SearchTab>('all');
  const [productCategory, setProductCategory] = useState<string | null>(null);
  const [projectCategory, setProjectCategory] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  // ─── Data loading ──────────────────────────────

  // Hashtags feed the search results; the grid is its own infinite query
  // (ONE-47), ordered and filtered on the server.
  const { data: hashtags = [], refetch: refetchHashtags } = useHashtagsQuery();
  // View state, reset on launch (ONE-49); narrows explore_items itself.
  const [interest, setInterest] = useState<string | null>(null);
  const interestName = useInterestName(interest);
  const explore = useExploreQuery(profileId, interest);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([explore.refetch(), refetchHashtags()]);
    setRefreshing(false);
  }, [explore, refetchHashtags]);

  // ─── Search (ONE-48) ───────────────────────────
  //
  // One query per content type on the debounced term: typing waits out the
  // pause, and TanStack Query dedupes identical requests in flight — no
  // hand-written guard. Blocks and private projects are filtered in the
  // database; the client filter below covers a block made moments ago.

  const term = useDebouncedValue(searchTerm).trim();
  const profileResults = useProfileResultsQuery(term);
  const postResults = usePostResultsQuery(term);
  const productResults = useProductResultsQuery(term, productCategory);
  const projectResults = useProjectResultsQuery(term, projectCategory);

  const profiles = useMemo(
    () => (profileResults.data ?? []).filter(p => !isUserBlocked(p.username)),
    [profileResults.data, isUserBlocked],
  );
  const posts = useMemo(
    () => (postResults.data ?? []).filter(p => !isUserBlocked(p.authorUsername)),
    [postResults.data, isUserBlocked],
  );
  const products = useMemo(
    () => (productResults.data ?? []).filter(p => !isUserBlocked(p.businessUsername)),
    [productResults.data, isUserBlocked],
  );
  const projects = useMemo(
    () => (projectResults.data ?? []).filter(p => !isUserBlocked(p.ownerUsername)),
    [projectResults.data, isUserBlocked],
  );

  // ─── Filtered data ─────────────────────────────

  // Hashtag search is unchanged: the known tags, matched as they are typed.
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
    setTab('all');
    setProductCategory(null);
    setProjectCategory(null);
    searchRef.current?.blur();
    Keyboard.dismiss();
  };

  // ─── Render search results ─────────────────────

  const renderPerson = (user: SearchProfile) => {
    const button = followButton(isFollowing(user.username), isRequested(user.username));
    const isMe = userProfile?.username === user.username;
    return (
      <ListRow
        key={user.id}
        title={user.name}
        subtitle={`@${user.username} · ${user.profileType === 'business' ? 'Business' : 'Individual'}`}
        avatarUri={user.avatarUrl}
        verified={user.isVerified}
        onPress={() => handleViewProfile(user.username)}
        accessibilityLabel={`View ${user.username}'s profile`}
        trailing={
          isMe ? null : (
            <Button
              size="sm"
              variant={button.variant}
              onPress={() => follow.toggle({ userId: user.id, username: user.username, isPrivate: user.isPrivate })}
              disabled={follow.isPending}
            >
              {button.label}
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

  const renderPost = (post: SearchPost) => (
    <ListRow
      key={post.id}
      title={firstLine(post.content) || 'Photo'}
      subtitle={`Post · @${post.authorUsername}`}
      avatarUri={post.imageUrl ?? post.authorAvatarUrl}
      onPress={() => router.push(`/post/${encodeURIComponent(post.id)}` as never)}
      accessibilityLabel={`Post by @${post.authorUsername}: ${firstLine(post.content)}`}
    />
  );

  const renderProduct = (product: SearchProduct) => (
    <ListRow
      key={product.id}
      title={product.name}
      subtitle={['Product', product.businessName, product.category].filter(Boolean).join(' · ')}
      avatarUri={product.imageUrl}
      onPress={() => router.push(productRoute(product.id) as never)}
      accessibilityLabel={`Product: ${product.name}, from ${product.businessName}`}
    />
  );

  const renderProject = (project: SearchProject) => (
    <ListRow
      key={project.id}
      title={project.name}
      subtitle={['Project', `@${project.ownerUsername}`, project.category].filter(Boolean).join(' · ')}
      avatarUri={project.coverUrl}
      onPress={() => router.push(projectRoute(project.id) as never)}
      accessibilityLabel={`Project: ${project.name}, by @${project.ownerUsername}`}
    />
  );

  /** A section of results: a mono header, the rows, and on All a way into its tab. */
  const section = <T,>(title: string, items: T[], render: (item: T) => React.ReactNode, target?: SearchTab) => {
    if (items.length === 0) return null;
    const preview = tab === 'all' && target ? items.slice(0, ALL_TAB_PREVIEW) : items;
    return (
      <View key={title}>
        <MonoLabel color="textMid" style={styles.sectionHeader}>{title}</MonoLabel>
        {preview.map(render)}
        {tab === 'all' && target && items.length > ALL_TAB_PREVIEW ? (
          <Pressable
            onPress={() => setTab(target)}
            accessibilityRole="button"
            accessibilityLabel={`See all ${title.toLowerCase()}`}
            style={styles.seeAll}
          >
            <MonoLabel>{`See all ${title.toLowerCase()}`}</MonoLabel>
          </Pressable>
        ) : null}
      </View>
    );
  };

  // The filter sheet (products and projects only): the categories in the
  // results, and a way back to every category.
  const filterCategory = tab === 'products' ? productCategory : tab === 'projects' ? projectCategory : null;
  const setFilterCategory = tab === 'products' ? setProductCategory : setProjectCategory;
  const filterOptions = categoriesOf(tab === 'products' ? products : tab === 'projects' ? projects : []);

  const renderSearchContent = () => {
    const loading = [profileResults, postResults, productResults, projectResults].some(q => q.isPending && q.isFetching);
    const nothing =
      !loading &&
      profiles.length === 0 &&
      posts.length === 0 &&
      products.length === 0 &&
      projects.length === 0 &&
      filteredHashtags.length === 0;

    return (
      <View style={styles.fill}>
        <View style={styles.tabs}>
          <FilterChips label="Show" options={SEARCH_TABS} selected={tab} onSelect={setTab} />
        </View>

        {(tab === 'products' || tab === 'projects') ? (
          <View style={styles.filterBar}>
            <Button size="sm" variant={filterCategory ? 'primary' : 'outline'} onPress={() => setFilterOpen(true)}>
              {categoryFilterLabel(filterCategory)}
            </Button>
          </View>
        ) : null}

        {loading && nothing ? (
          <View>{Array.from({ length: SKELETON_ROWS }, (_, i) => <RowSkeleton key={i} />)}</View>
        ) : nothing ? (
          <View style={styles.noResults}>
            <Text style={styles.hint}>{noResultsLabel(searchTerm)}</Text>
            <Text style={styles.hintSub}>{NO_RESULTS_HINT}</Text>
          </View>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.results}>
            {(tab === 'all' || tab === 'profiles') && section('Profiles', profiles, renderPerson, 'profiles')}
            {(tab === 'all' || tab === 'posts') && section('Hashtags', filteredHashtags, renderHashtag, 'posts')}
            {(tab === 'all' || tab === 'posts') && section('Posts', posts, renderPost, 'posts')}
            {(tab === 'all' || tab === 'products') && section('Products', products, renderProduct, 'products')}
            {(tab === 'all' || tab === 'projects') && section('Projects', projects, renderProject, 'projects')}
          </ScrollView>
        )}

        <Sheet visible={filterOpen} onClose={() => setFilterOpen(false)} title="Filter by category">
          <SheetRow
            label="All categories"
            onPress={() => {
              setFilterCategory(null);
              setFilterOpen(false);
            }}
          />
          {filterOptions.map(category => (
            <SheetRow
              key={category}
              label={category}
              onPress={() => {
                setFilterCategory(category);
                setFilterOpen(false);
              }}
            />
          ))}
        </Sheet>
      </View>
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
    if (explore.isPending && !interest) return <GridSkeleton />;

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
        // The interest filter row, in the slot ONE-47 kept above the grid.
        ListHeaderComponent={
          <View testID="explore-filter-slot">
            <InterestFilter selected={interest} onSelect={setInterest} />
          </View>
        }
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
          interest ? (
            explore.isPending ? (
              <GridSkeleton />
            ) : (
              <EmptyState
                title={`Nothing in ${interestName} yet`}
                body="When people post or share projects about this, they'll show up here."
                action={{ label: 'Show all', onPress: () => setInterest(null) }}
              />
            )
          ) : (
          <EmptyState
            title="Nothing to explore yet"
            body="Follow people to fill your feed, or be the first to post, list a product or share a project."
            action={{ label: 'Create a post', onPress: () => router.push('/compose') }}
          />
          )
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
      {/* An empty input shows the grid, even while the field is focused (ONE-48). */}
      {isSearching && searchTerm.trim() ? renderSearchContent() : renderGrid()}
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
  tabs: {
    paddingBottom: space.sm,
  },
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  seeAll: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  noResults: {
    paddingTop: space.xl,
  },
  hintSub: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    fontFamily: type.body,
    fontSize: 13,
    color: color.textMuted,
    textAlign: 'center',
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
