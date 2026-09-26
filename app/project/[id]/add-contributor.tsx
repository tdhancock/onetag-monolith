import React, { useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../../store/AppContext.native';
import {
  PROFILE_SEARCH_MIN_LENGTH,
  useCurrentProfile,
  useProfileSearchQuery,
  type ProfileSearchResult,
} from '../../../features/profiles';
import { useAddContributor, useContributorsQuery, useProjectQuery } from '../../../features/projects';
import KeyboardAvoider from '../../../components/native/KeyboardAvoider';
import ModalHeader from '../../../components/native/ModalHeader';
import { RowSkeletons, SectionError } from '../../../components/native/SectionStates';
import { Button, EmptyState, ListRow, TextField } from '../../../components/native/ui';
import { SearchIcon } from '../../../components/native/Icons';
import { useDebouncedValue } from '../../../lib/useDebouncedValue';
import {
  canManageProject,
  CONTRIBUTOR_ROLE_MAX_LENGTH,
  contributorCandidates,
  contributorRoleOrNull,
  PROJECT_NOT_FOUND,
} from '../../../lib/screens/projects';
import { color, space, type } from '../../../theme/tokens';

const kindLabel = (profile: ProfileSearchResult): string => (profile.profileType === 'business' ? 'Business' : 'Individual');

/**
 * Add a Contributor to a project (ONE-42): find a profile — business or
 * individual — then give it an optional role. The link is immediate; the
 * contributor can remove it from the project's page.
 *
 * Profiles already Linked are left out rather than refused by the database.
 * The owner's own profile is offered like any other: an owner may add
 * themselves, a business that both ran and supplied a job.
 */
export default function AddContributorScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const projectId = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const { addToast } = useApp();
  const { profileId } = useCurrentProfile();
  const { data: project, isPending } = useProjectQuery(projectId);
  const contributors = useContributorsQuery(projectId);
  const add = useAddContributor();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<ProfileSearchResult | null>(null);
  const [role, setRole] = useState('');
  const search = useProfileSearchQuery(useDebouncedValue(query));

  const close = () => router.back();

  if (isPending) {
    return (
      <SafeAreaView style={styles.screen}>
        <ModalHeader title="Add a contributor" onCancel={close} onSave={() => undefined} canSave={false} saveLabel="Add" />
        <ActivityIndicator style={styles.loading} color={color.textMuted} accessibilityLabel="Loading" />
      </SafeAreaView>
    );
  }

  if (!project || !canManageProject(profileId, project)) {
    return (
      <SafeAreaView style={styles.screen}>
        <ModalHeader title="Add a contributor" onCancel={close} onSave={() => undefined} canSave={false} saveLabel="Add" />
        <EmptyState
          title={project ? "You can't change this project" : PROJECT_NOT_FOUND.title}
          body={project ? 'Only the profile that owns it can add contributors.' : PROJECT_NOT_FOUND.body}
          action={{ label: 'Back', onPress: close }}
        />
      </SafeAreaView>
    );
  }

  const submit = () => {
    if (!chosen || add.isPending) return;
    add.mutate(
      { projectId: project.id, profileId: chosen.id, role: contributorRoleOrNull(role) },
      {
        onSuccess: () => {
          addToast(`Added ${chosen.name} as a contributor.`, 'success');
          close();
        },
        onError: () => addToast(`Couldn't add ${chosen.name}. Try again.`, 'error'),
      },
    );
  };

  const header = (
    <ModalHeader
      title="Add a contributor"
      onCancel={close}
      onSave={submit}
      canSave={Boolean(chosen) && !add.isPending}
      saving={add.isPending}
      saveLabel="Add"
    />
  );

  if (chosen) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <KeyboardAvoider style={styles.fill}>
          <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled">
            <ListRow
              title={chosen.name}
              subtitle={`@${chosen.username} · ${kindLabel(chosen)}`}
              avatarUri={chosen.avatarUrl}
              verified={chosen.isVerified}
              divider
            />
            <View style={styles.form}>
              <TextField
                label="Role"
                value={role}
                onChangeText={setRole}
                placeholder="Optional, e.g. Architect, Supplied the tile"
                maxLength={CONTRIBUTOR_ROLE_MAX_LENGTH}
                accessibilityLabel="Role"
              />
              <Text style={styles.hint}>
                {`${chosen.name} will be listed on ${project.name} as a contributor, and it will show on their profile. They can remove themselves at any time.`}
              </Text>
              <Button onPress={submit} loading={add.isPending} fullWidth style={styles.submit}>
                Add as contributor
              </Button>
              <Button variant="outline" onPress={() => setChosen(null)} fullWidth style={styles.back}>
                Choose someone else
              </Button>
            </View>
          </ScrollView>
        </KeyboardAvoider>
      </SafeAreaView>
    );
  }

  const searching = query.trim().length >= PROFILE_SEARCH_MIN_LENGTH;
  const candidates = searching ? contributorCandidates(search.data, contributors.data) : [];

  return (
    <SafeAreaView style={styles.screen}>
      {header}
      <View style={styles.search}>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder="Search profiles by handle"
          autoCapitalize="none"
          autoCorrect={false}
          leading={<SearchIcon color={color.textMuted} size={18} />}
          accessibilityLabel="Search profiles"
        />
        <Text style={styles.hint}>A person or a business: anyone who worked on the project.</Text>
      </View>
      <FlatList
        data={candidates}
        keyExtractor={(profile) => profile.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item, index }) => (
          <ListRow
            title={item.name}
            subtitle={`@${item.username} · ${kindLabel(item)}`}
            avatarUri={item.avatarUrl}
            verified={item.isVerified}
            accessibilityLabel={`Choose ${item.name}, @${item.username}, ${kindLabel(item)}`}
            divider={index < candidates.length - 1}
            onPress={() => setChosen(item)}
          />
        )}
        ListEmptyComponent={
          !searching ? null : search.isFetching && !search.data ? (
            <RowSkeletons />
          ) : search.isError ? (
            <SectionError message="Couldn't search profiles." onRetry={() => void search.refetch()} />
          ) : (
            <EmptyState title="No one to add" body="No profile with that handle, or everyone found is already listed." />
          )
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
  fill: {
    flex: 1,
  },
  loading: {
    marginTop: space.xxl,
  },
  search: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  hint: {
    marginTop: space.sm,
    fontFamily: type.body,
    fontSize: 13,
    lineHeight: 18,
    color: color.textMid,
  },
  form: {
    padding: space.lg,
  },
  submit: {
    marginTop: space.xl,
  },
  back: {
    marginTop: space.sm,
  },
});
