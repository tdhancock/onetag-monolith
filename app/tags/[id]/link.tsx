import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStore } from '@tanstack/react-form';
import { useApp } from '../../../store/AppContext.native';
import { useCurrentProfile } from '../../../features/profiles';
import { useCreateProject, type ProjectSummary } from '../../../features/projects';
import { useLinkTag, useMyTagQuery, type OwnedTag } from '../../../features/tags';
import { Button, EmptyState, MonoLabel, TextField } from '../../../components/native/ui';
import KeyboardAvoider from '../../../components/native/KeyboardAvoider';
import FormScrollView from '../../../components/native/FormScrollView';
import OwnedDestinationList from '../../../components/native/OwnedDestinationList';
import ProjectForm, { projectFormOptions } from '../../../components/native/ProjectForm';
import { useAppForm } from '../../../components/native/form';
import { MediaUploadError } from '../../../services/mediaUpload';
import { useOwnedTagDestinations } from '../../../lib/useOwnedTagDestinations';
import { partOfForNextNewProject, rememberLinkedProject } from '../../../lib/linkParentMemory';
import { routeForDestination } from '../../../lib/screens/tagResolution';
import {
  EMPTY_PROJECT_DRAFT,
  newProjectInputFrom,
  parentChoices,
  PROJECT_PHOTO_FAILED,
  PROJECT_SAVE_FAILED,
  projectRoute,
} from '../../../lib/screens/projects';
import {
  chosenDestination,
  LINK_TAG_FAILED,
  LINK_TAG_INTRO,
  LINK_TAG_NOT_BLANK,
  LINK_TAG_TITLE,
  TAG_NAME_MAX_LENGTH,
  TAGS_DASHBOARD_ROUTE,
  tagDetailRoute,
  tagTextOrNull,
  type DraftDestination,
} from '../../../lib/screens/tags';
import { color, space, type } from '../../../theme/tokens';

/**
 * Link this tag (ONE-139): point a blank Physical Tag at something the
 * account owns, once (ONE-135). Its owner arrives here by scanning it, or
 * from its row on the Tags dashboard.
 *
 * A pushed screen, not a modal: it ends by opening the destination, and a
 * screen that leads on to another is pushed. It replaces itself with the
 * destination, so Back goes to wherever linking started.
 *
 * The destinations are the create flow's own (lib/useOwnedTagDestinations.ts):
 * only what the account owns, so RLS never refuses a choice offered here.
 *
 * Or a New project, made right here (ONE-142): most of what a house's
 * stickers go on isn't in the app yet, and stopping to create each one
 * elsewhere would break the walk from sticker to sticker.
 */
export default function LinkTagScreen() {
  const router = useRouter();
  const { addToast } = useApp();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const tagId = typeof params.id === 'string' ? params.id : '';
  const { profileId } = useCurrentProfile();
  const { data: tag, isPending, isError, refetch } = useMyTagQuery(profileId, tagId);
  const { sections, loaded, projects } = useOwnedTagDestinations();
  const linkTag = useLinkTag(profileId);

  const [step, setStep] = useState<'choose' | 'new-project'>('choose');
  const [destination, setDestination] = useState<DraftDestination | null>(null);
  // Null until the owner types: the name then follows the tag's own, or the destination's.
  const [typedName, setTypedName] = useState<string | null>(null);

  const header = <Stack.Screen options={{ headerShown: true, title: LINK_TAG_TITLE }} />;

  if (isPending || (tag && !tag.linked && !loaded)) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <ActivityIndicator style={styles.loading} color={color.textMuted} accessibilityLabel="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !tag) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <EmptyState
          title={isError ? "Couldn't load this tag" : 'Tag not found'}
          body={isError ? 'Check your connection and try again.' : "This profile doesn't own a tag with that id."}
          action={
            isError
              ? { label: 'Try again', onPress: () => void refetch() }
              : { label: 'Your tags', onPress: () => router.replace(TAGS_DASHBOARD_ROUTE) }
          }
        />
      </SafeAreaView>
    );
  }

  if (tag.linked) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <EmptyState
          title={LINK_TAG_NOT_BLANK.title}
          body={LINK_TAG_NOT_BLANK.body}
          action={{ label: 'Open the tag', onPress: () => router.replace(tagDetailRoute(tag.id)) }}
        />
      </SafeAreaView>
    );
  }

  if (step === 'new-project') {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <NewProjectStep
          tag={tag}
          projects={projects}
          onBack={() => setStep('choose')}
          onLinked={(projectId) => router.replace(projectRoute(projectId))}
        />
      </SafeAreaView>
    );
  }

  const chosenTitle = destination ? (chosenDestination(sections, destination)?.title ?? '') : '';
  const name = typedName ?? tag.name ?? chosenTitle;

  const handleLink = () => {
    if (!destination) return;
    linkTag.mutate(
      { tagId: tag.id, destination, name: tagTextOrNull(name) },
      {
        onSuccess: (linked) => {
          if (destination.kind === 'project') {
            const project = projects.find((p) => p.id === destination.id);
            if (project) rememberLinkedProject(project);
          }
          const route = linked.destination ? routeForDestination(linked.destination) : null;
          router.replace(route ?? tagDetailRoute(linked.id));
        },
        // The choice stays as it was, so trying again is one tap.
        onError: () => addToast(LINK_TAG_FAILED, 'error'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      {header}
      <KeyboardAvoider style={styles.fill}>
        <FormScrollView style={styles.fill} contentContainerStyle={styles.content}>
          <MonoLabel color="textMid">{`Physical · ${tag.shortCode}`}</MonoLabel>
          <Text style={styles.intro}>{LINK_TAG_INTRO}</Text>
          <Button variant="outline" onPress={() => setStep('new-project')} style={styles.newProject}>
            New project
          </Button>

          <OwnedDestinationList sections={sections} selected={destination} onSelect={setDestination} />

          <View style={styles.fields}>
            <TextField
              label="Name"
              value={name}
              onChangeText={setTypedName}
              placeholder="Optional, e.g. Furnace"
              maxLength={TAG_NAME_MAX_LENGTH}
              accessibilityLabel="Name"
            />
            <Button fullWidth onPress={handleLink} disabled={!destination} loading={linkTag.isPending}>
              Link tag
            </Button>
          </View>
        </FormScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

/**
 * The New project step (ONE-142): the project form, Part of included, in this
 * screen rather than another — so Back returns to the list, and saving makes
 * the project and links the tag in one go.
 *
 * Part of starts where the last tag went: that project, or the project it
 * sits inside. If the project is made but the link fails, the retry links the
 * project that now exists rather than making a second one.
 */
function NewProjectStep({
  tag,
  projects,
  onBack,
  onLinked,
}: {
  tag: OwnedTag;
  projects: ProjectSummary[];
  onBack: () => void;
  onLinked: (projectId: string) => void;
}) {
  const { addToast } = useApp();
  const { profileId, authUserId } = useCurrentProfile();
  const createProject = useCreateProject(authUserId);
  const linkTag = useLinkTag(profileId);
  const [madeProjectId, setMadeProjectId] = useState<string | null>(null);

  // A new project goes inside one with the same owner: the acting profile's own.
  const choices = parentChoices(projects.filter((project) => project.ownerProfileId === profileId));
  const remembered = partOfForNextNewProject();
  const startsInside = choices.some((choice) => choice.id === remembered) ? remembered : null;

  const form = useAppForm({
    ...projectFormOptions,
    defaultValues: { ...EMPTY_PROJECT_DRAFT, parentProjectId: startsInside },
    onSubmit: async ({ value }) => {
      if (!profileId) return;
      let projectId = madeProjectId;
      try {
        if (!projectId) {
          projectId = await createProject.mutateAsync(newProjectInputFrom(value, profileId));
          setMadeProjectId(projectId);
        }
      } catch (error) {
        addToast(error instanceof MediaUploadError ? PROJECT_PHOTO_FAILED : PROJECT_SAVE_FAILED, 'error');
        return;
      }
      try {
        await linkTag.mutateAsync({
          tagId: tag.id,
          destination: { kind: 'project', id: projectId },
          name: tagTextOrNull(value.name),
        });
      } catch {
        addToast(LINK_TAG_FAILED, 'error');
        return;
      }
      rememberLinkedProject({ id: projectId, parentProjectId: value.parentProjectId });
      onLinked(projectId);
    },
  });
  const valid = useStore(form.store, (state) => state.canSubmit);
  const saving = createProject.isPending || linkTag.isPending;

  return (
    <KeyboardAvoider style={styles.fill}>
      <FormScrollView style={styles.fill} contentContainerStyle={styles.formContent}>
        <View style={styles.formIntro}>
          <MonoLabel color="textMid">{`Physical · ${tag.shortCode} · New project`}</MonoLabel>
        </View>
        <ProjectForm form={form} parentChoices={choices} />
        <View style={styles.fields}>
          <Button fullWidth onPress={() => void form.handleSubmit()} disabled={!valid || saving} loading={saving}>
            {madeProjectId ? 'Link tag' : 'Make project and link tag'}
          </Button>
          {madeProjectId ? null : (
            <Button fullWidth variant="outline" onPress={onBack} disabled={saving}>
              Back to the list
            </Button>
          )}
        </View>
      </FormScrollView>
    </KeyboardAvoider>
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
  content: {
    padding: space.xl,
    paddingBottom: space.xxl,
  },
  intro: {
    marginTop: space.sm,
    fontFamily: type.body,
    fontSize: 15,
    lineHeight: 22,
    color: color.textMid,
  },
  fields: {
    marginTop: space.xl,
    gap: space.lg,
  },
  newProject: {
    marginTop: space.lg,
  },
  formContent: {
    paddingBottom: space.xxl,
  },
  formIntro: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
});
