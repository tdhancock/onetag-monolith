import React, { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile } from '../../features/profiles';
import { useMyTagsQuery, useTagActiveToggle, type OwnedTag } from '../../features/tags';
import { EmptyState, IconButton, Skeleton } from '../../components/native/ui';
import { PlusIcon } from '../../components/native/Icons';
import FilterChips from '../../components/native/FilterChips';
import TagRow from '../../components/native/TagRow';
import {
  filterTags,
  TAG_STATE_FILTERS,
  TAG_TYPE_FILTERS,
  tagCreateRoute,
  tagDetailRoute,
  TAGS_EMPTY_STATE,
  TAGS_FILTERED_EMPTY_STATE,
  type TagStateFilter,
  type TagTypeFilter,
} from '../../lib/screens/tags';
import { color, space } from '../../theme/tokens';

/**
 * The Tags dashboard (ONE-34): every tag the active profile owns, newest
 * first, filterable by type and by state, each with its scan count and a
 * switch to pause it. Reached from the Profile tab.
 *
 * A Physical Tag is an object someone else may be holding, and this is the
 * only place its owner controls it — so an inactive tag is marked loudly,
 * and the switch answers at once.
 */
export default function TagsDashboardScreen() {
  const router = useRouter();
  const { addToast } = useApp();
  const { profileId } = useCurrentProfile();
  const tags = useMyTagsQuery(profileId);
  const toggleActive = useTagActiveToggle(profileId);

  const [typeFilter, setTypeFilter] = useState<TagTypeFilter>('all');
  const [stateFilter, setStateFilter] = useState<TagStateFilter>('all');
  const [refreshing, setRefreshing] = useState(false);

  const visible = useMemo(
    () => filterTags(tags.data ?? [], typeFilter, stateFilter),
    [tags.data, typeFilter, stateFilter],
  );

  const createTag = () => router.push(tagCreateRoute());

  const handleToggle = (tag: OwnedTag) =>
    toggleActive.mutate(tag.id, {
      onError: () =>
        addToast(`Couldn't ${tag.active ? 'deactivate' : 'activate'} the tag. It's back as it was.`, 'error'),
    });

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await tags.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const header = (
    <Stack.Screen
      options={{
        headerShown: true,
        title: 'Tags',
        headerRight: () => (
          <IconButton
            icon={<PlusIcon color={color.text} size={24} strokeWidth={1.8} />}
            accessibilityLabel="Create a tag"
            onPress={createTag}
          />
        ),
      }}
    />
  );

  if (tags.isPending) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <View style={styles.skeletons} accessibilityLabel="Loading tags">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={88} style={styles.skeleton} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  if (tags.isError) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <EmptyState
          title="Couldn't load your tags"
          body="Check your connection and try again."
          action={{ label: 'Try again', onPress: () => void tags.refetch() }}
        />
      </SafeAreaView>
    );
  }

  // No tags at all: explain what a Tag is before the filters mean anything.
  if (tags.data.length === 0) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <EmptyState
          title={TAGS_EMPTY_STATE.title}
          body={TAGS_EMPTY_STATE.body}
          action={{ label: TAGS_EMPTY_STATE.action, onPress: createTag }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      {header}
      <FlatList
        data={visible}
        keyExtractor={(tag) => tag.id}
        renderItem={({ item, index }) => (
          <TagRow
            tag={item}
            divider={index < visible.length - 1}
            onPress={() => router.push(tagDetailRoute(item.id))}
            onToggleActive={() => handleToggle(item)}
          />
        )}
        ListHeaderComponent={
          <View style={styles.filters}>
            <FilterChips label="Type" options={TAG_TYPE_FILTERS} selected={typeFilter} onSelect={setTypeFilter} />
            <FilterChips label="State" options={TAG_STATE_FILTERS} selected={stateFilter} onSelect={setStateFilter} />
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title={TAGS_FILTERED_EMPTY_STATE.title}
            body={TAGS_FILTERED_EMPTY_STATE.body}
            action={{
              label: TAGS_FILTERED_EMPTY_STATE.action,
              onPress: () => {
                setTypeFilter('all');
                setStateFilter('all');
              },
            }}
          />
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.textMuted} colors={[color.textMuted]} />
        }
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
  },
  list: {
    flexGrow: 1,
    paddingBottom: space.xxl,
  },
  filters: {
    paddingVertical: space.md,
    gap: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  skeletons: {
    padding: space.lg,
    gap: space.md,
  },
  skeleton: {
    width: '100%',
  },
});
