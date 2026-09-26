import React, { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { EmptyState, ListRow, MonoLabel, Pressable } from './ui';
import FilterChips from './FilterChips';
import { GridTile, ProductTile, ProfileGridSkeleton } from './ProfileGrid';
import { RowSkeletons, SectionError } from './SectionStates';
import { useProfilePostsQuery } from '../../features/profiles';
import { useBusinessProductsQuery } from '../../features/products';
import { useContributedProjectsQuery, useOwnedProjectsQuery, type ProjectSummary } from '../../features/projects';
import { useSavedItemsQuery, type SavedItem } from '../../features/saves';
import { useMyScanHistoryQuery, useProfileScanHistoryQuery, type ScanHistoryEntry } from '../../features/scans';
import {
  filterSavedItems,
  firstLine,
  PROFILE_GRID_COLUMNS,
  PROFILE_PROJECT_VIEWS,
  profileEmptyState,
  SAVES_FILTERS,
  type ProfileEmptyState,
  type ProfileProjectsView,
  type ProfileTab,
  type SavesFilter,
} from '../../lib/screens/profile';
import { productKindLabel, productRoute } from '../../lib/screens/products';
import { PRIVATE_LABEL, projectKindLabel, projectRoute, projectRowSubtitle } from '../../lib/screens/projects';
import {
  publicScanHistoryDescription,
  routeForEntry,
  SCAN_DESTINATION_LABEL,
  scanHistorySummary,
} from '../../lib/screens/scanHistory';
import { color, space, type } from '../../theme/tokens';

export interface ProfileTabListProfile {
  id: string;
  username: string;
  scanHistoryPublic?: boolean;
}

export interface ProfileTabListProps {
  tab: ProfileTab;
  profile: ProfileTabListProfile;
  isOwnProfile: boolean;
  /** The profile header and the tab strip, above whichever tab is showing. */
  header: React.ReactElement;
  /** Re-read what the header shows — the profile, its counts — on pull to refresh. */
  onRefreshHeader: () => Promise<unknown>;
}

/**
 * The content of a profile's selected tab (ONE-43), below its header.
 *
 * Every tab is its own component with its own query, mounted only while it is
 * selected: nothing is fetched for a tab until someone opens it, and the query
 * cache holds what was fetched, so going back to a tab within the stale
 * window shows it again without asking the server. Every item in every tab
 * leads to its own screen.
 */
const ProfileTabList: React.FC<ProfileTabListProps> = (props) => {
  switch (props.tab) {
    case 'posts':
    case 'media':
      return <PostsTab {...props} />;
    case 'products':
      return <ProductsTab {...props} />;
    case 'projects':
      return <ProjectsTab {...props} />;
    case 'saves':
      return <SavesTab {...props} />;
    case 'scans':
      return <ScansTab {...props} />;
  }
};

// ─── Shared ─────────────────────────────────────────────────────────────

interface TabQuery {
  isPending: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

/** Pull to refresh: the header's data and the tab's own. */
const useTabRefresh = (onRefreshHeader: () => Promise<unknown>, query: TabQuery) => {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([onRefreshHeader(), query.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.textMuted} colors={[color.textMuted]} />
  );
};

/** What a tab shows with nothing to list: its loading shape, its error, or its empty state. */
function TabFallback({ query, empty, loading }: { query: TabQuery; empty: ProfileEmptyState; loading: React.ReactElement }) {
  const router = useRouter();
  if (query.isPending) return loading;
  if (query.isError) return <SectionError message="Couldn't load this." onRetry={() => void query.refetch()} />;
  const action = empty.action;
  return (
    <EmptyState
      title={empty.title}
      body={empty.body}
      action={action ? { label: action.label, onPress: () => router.push(action.target) } : undefined}
    />
  );
}

const THUMB = 40;

/** A square thumbnail in a row's leading slot: an image, or an empty panel. */
const Thumb: React.FC<{ uri: string | null | undefined }> = ({ uri }) =>
  uri ? <Image source={{ uri }} style={styles.thumb} contentFit="cover" /> : <View style={styles.thumb} />;

// ─── Posts and Media ────────────────────────────────────────────────────

/** The profile's posts as the grid always showed them: Posts on an individual, Media on a business. */
function PostsTab({ tab, profile, isOwnProfile, header, onRefreshHeader }: ProfileTabListProps) {
  const router = useRouter();
  const posts = useProfilePostsQuery(profile.id);
  const refreshControl = useTabRefresh(onRefreshHeader, posts);

  return (
    <FlatList
      data={posts.data ?? []}
      keyExtractor={(post) => post.id}
      numColumns={PROFILE_GRID_COLUMNS}
      renderItem={({ item, index }) => (
        <GridTile post={item} index={index} onPress={() => router.push(`/post/${item.id}`)} />
      )}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <TabFallback query={posts} empty={profileEmptyState(tab, isOwnProfile)} loading={<ProfileGridSkeleton />} />
      }
      refreshControl={refreshControl}
      contentContainerStyle={styles.list}
    />
  );
}

// ─── Products ───────────────────────────────────────────────────────────

/** A business's products as a grid, each leading to its page. */
function ProductsTab({ profile, isOwnProfile, header, onRefreshHeader }: ProfileTabListProps) {
  const router = useRouter();
  const products = useBusinessProductsQuery(profile.id);
  const refreshControl = useTabRefresh(onRefreshHeader, products);

  return (
    <FlatList
      data={products.data ?? []}
      keyExtractor={(product) => product.id}
      numColumns={PROFILE_GRID_COLUMNS}
      renderItem={({ item, index }) => (
        <ProductTile product={item} index={index} onPress={() => router.push(productRoute(item.id))} />
      )}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <TabFallback
          query={products}
          empty={profileEmptyState('products', isOwnProfile)}
          loading={<ProfileGridSkeleton />}
        />
      }
      refreshControl={refreshControl}
      contentContainerStyle={styles.list}
    />
  );
}

// ─── Projects ───────────────────────────────────────────────────────────

/**
 * The profile's projects, Owned or Contributed. Each view is its own list
 * with its own query, so the one not showing is not fetched.
 */
function ProjectsTab(props: ProfileTabListProps) {
  const [view, setView] = useState<ProfileProjectsView>('owned');
  const header = (
    <View>
      {props.header}
      <View style={styles.subheader}>
        <FilterChips label="Projects" options={PROFILE_PROJECT_VIEWS} selected={view} onSelect={setView} />
      </View>
    </View>
  );
  return view === 'owned' ? <OwnedProjects {...props} header={header} /> : <ContributedProjects {...props} header={header} />;
}

function OwnedProjects(props: ProfileTabListProps) {
  const query = useOwnedProjectsQuery(props.profile.id);
  return <ProjectsList {...props} query={query} view="owned" />;
}

function ContributedProjects(props: ProfileTabListProps) {
  const query = useContributedProjectsQuery(props.profile.id);
  return <ProjectsList {...props} query={query} view="contributed" />;
}

function ProjectsList({
  query,
  view,
  isOwnProfile,
  header,
  onRefreshHeader,
}: ProfileTabListProps & { query: TabQuery & { data?: ProjectSummary[] }; view: ProfileProjectsView }) {
  const router = useRouter();
  const refreshControl = useTabRefresh(onRefreshHeader, query);
  const projects = query.data ?? [];

  return (
    <FlatList
      data={projects}
      keyExtractor={(project) => project.id}
      renderItem={({ item, index }) => {
        // Only someone who may see a private project is ever shown one.
        const subtitle = [item.isPublic ? null : PRIVATE_LABEL, projectRowSubtitle(item)].filter(Boolean).join(' · ');
        return (
          <ListRow
            title={item.name}
            subtitle={subtitle}
            leading={<Thumb uri={item.coverUrl} />}
            accessibilityLabel={`${item.name}, ${subtitle}`}
            divider={index < projects.length - 1}
            onPress={() => router.push(projectRoute(item.id))}
          />
        );
      }}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <TabFallback
          query={query}
          empty={profileEmptyState('projects', isOwnProfile, { projectsView: view })}
          loading={<RowSkeletons />}
        />
      }
      refreshControl={refreshControl}
      contentContainerStyle={styles.list}
    />
  );
}

// ─── Saves ──────────────────────────────────────────────────────────────

/** What a saved item's row shows, and where it leads. */
const savedRow = (item: SavedItem): { title: string; subtitle: string; leading?: React.ReactElement; avatarUri?: string | null; route: string } => {
  switch (item.kind) {
    case 'post': {
      const post = item.post;
      const isPhoto = post.media_type === 'image' && Boolean(post.media);
      return {
        title: firstLine(post.content) || (isPhoto ? 'Photo post' : 'Post'),
        subtitle: `Post · @${post.username}`,
        leading: isPhoto ? <Thumb uri={post.media} /> : <View style={styles.thumb} />,
        route: `/post/${post.id}`,
      };
    }
    case 'product':
      return {
        title: item.product.name,
        subtitle: productKindLabel(item.product),
        leading: <Thumb uri={item.product.imageUrl} />,
        route: productRoute(item.product.id),
      };
    case 'project':
      return {
        title: item.project.name,
        subtitle: projectKindLabel(item.project),
        leading: <Thumb uri={item.project.coverUrl} />,
        route: projectRoute(item.project.id),
      };
    case 'profile':
      return {
        title: item.profile.name,
        subtitle: `Profile · @${item.profile.username}`,
        avatarUri: item.profile.avatarUrl,
        route: `/user/${encodeURIComponent(item.profile.username)}`,
      };
  }
};

/**
 * Everything the profile saved — posts, products, projects and profiles —
 * newest first, filterable by kind. Only ever on your own profile: saves are
 * private (ONE-39).
 */
function SavesTab({ profile, header, onRefreshHeader }: ProfileTabListProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<SavesFilter>('all');
  const saved = useSavedItemsQuery(profile.id);
  const refreshControl = useTabRefresh(onRefreshHeader, saved);
  const items = filterSavedItems(saved.data ?? [], filter);

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.saveId}
      renderItem={({ item, index }) => {
        const row = savedRow(item);
        return (
          <ListRow
            title={row.title}
            subtitle={row.subtitle}
            leading={row.leading}
            avatarUri={row.avatarUri}
            accessibilityLabel={`${row.title}, ${row.subtitle}`}
            divider={index < items.length - 1}
            onPress={() => router.push(row.route)}
          />
        );
      }}
      ListHeaderComponent={
        <View>
          {header}
          <View style={styles.subheader}>
            <FilterChips label="Show" options={SAVES_FILTERS} selected={filter} onSelect={setFilter} />
          </View>
        </View>
      }
      ListEmptyComponent={
        <TabFallback
          query={saved}
          empty={profileEmptyState('saves', true, { savesFilter: filter })}
          loading={<RowSkeletons />}
        />
      }
      refreshControl={refreshControl}
      contentContainerStyle={styles.list}
    />
  );
}

// ─── Scans ──────────────────────────────────────────────────────────────

/**
 * The profile's Scan History (ONE-35): its own, whatever the setting, or
 * someone's public one — the tab only exists for a visitor while it is
 * public. Each row leads where scanning the tag again would.
 */
function ScansTab({ profile, isOwnProfile, header, onRefreshHeader }: ProfileTabListProps) {
  const router = useRouter();
  const mine = useMyScanHistoryQuery(isOwnProfile ? profile.id : undefined);
  const theirs = useProfileScanHistoryQuery(isOwnProfile ? undefined : profile.id, !isOwnProfile && profile.scanHistoryPublic === true);
  const history = isOwnProfile ? mine : theirs;
  const refreshControl = useTabRefresh(onRefreshHeader, history);
  const entries = history.data ?? [];
  const isPublic = profile.scanHistoryPublic === true;

  const renderItem = ({ item, index }: { item: ScanHistoryEntry; index: number }) => {
    const route = routeForEntry(item);
    const summary = `${SCAN_DESTINATION_LABEL[item.kind]} · ${scanHistorySummary(item)}`;
    return (
      <ListRow
        title={item.name}
        subtitle={summary}
        accessibilityLabel={`${item.name}, ${SCAN_DESTINATION_LABEL[item.kind]}, ${scanHistorySummary(item)}`}
        divider={index < entries.length - 1}
        onPress={route ? () => router.push(route) : undefined}
      />
    );
  };

  return (
    <FlatList
      data={entries}
      keyExtractor={(entry) => entry.key}
      renderItem={renderItem}
      ListHeaderComponent={
        <View>
          {header}
          {isOwnProfile ? (
            // Who can see it, said where it is seen, with the way to change it.
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${publicScanHistoryDescription(isPublic)} Change in Settings`}
              onPress={() => router.push('/settings')}
              style={({ pressed }) => [styles.notice, pressed && styles.pressed]}
            >
              <MonoLabel color="textMid">{isPublic ? 'Public' : 'Private'}</MonoLabel>
              <Text style={styles.noticeText}>{publicScanHistoryDescription(isPublic)} Change in Settings.</Text>
            </Pressable>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <TabFallback query={history} empty={profileEmptyState('scans', isOwnProfile)} loading={<RowSkeletons />} />
      }
      refreshControl={refreshControl}
      contentContainerStyle={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flexGrow: 1,
    backgroundColor: color.bg,
  },
  subheader: {
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    backgroundColor: color.bg,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    backgroundColor: color.bgPanel,
  },
  notice: {
    padding: space.lg,
    gap: space.xs,
    backgroundColor: color.bgSub,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  pressed: {
    opacity: 0.7,
  },
  noticeText: {
    fontFamily: type.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.textMid,
  },
});

export default ProfileTabList;
