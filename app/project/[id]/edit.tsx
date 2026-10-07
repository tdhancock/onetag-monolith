import React from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStore } from '@tanstack/react-form';
import { useApp } from '../../../store/AppContext.native';
import { useCurrentProfile } from '../../../features/profiles';
import {
  useChildProjectsQuery,
  useOwnedProjectsQuery,
  useProjectQuery,
  useUpdateProject,
  type Project,
} from '../../../features/projects';
import { MediaUploadError } from '../../../services/mediaUpload';
import KeyboardAvoider from '../../../components/native/KeyboardAvoider';
import FormScrollView from '../../../components/native/FormScrollView';
import ModalHeader from '../../../components/native/ModalHeader';
import ProjectForm, { projectFormOptions } from '../../../components/native/ProjectForm';
import { useAppForm } from '../../../components/native/form';
import { EmptyState } from '../../../components/native/ui';
import {
  canManageProject,
  parentChoices,
  PROJECT_NOT_FOUND,
  PROJECT_PHOTO_FAILED,
  PROJECT_SAVE_FAILED,
  projectDraftChanged,
  projectDraftFrom,
  projectEditsFrom,
} from '../../../lib/screens/projects';
import { color, space } from '../../../theme/tokens';

/**
 * Edit a project (ONE-41): its cover, fields and visibility. A modal,
 * declared in app/_layout.tsx. Only the profile that owns it gets the form.
 */
export default function EditProjectScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const projectId = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const { profileId } = useCurrentProfile();
  const { data: project, isPending } = useProjectQuery(projectId);

  const close = () => router.back();

  if (isPending) {
    return (
      <SafeAreaView style={styles.screen}>
        <ModalHeader title="Edit project" onCancel={close} onSave={() => undefined} canSave={false} />
        <ActivityIndicator style={styles.loading} color={color.textMuted} accessibilityLabel="Loading" />
      </SafeAreaView>
    );
  }

  if (!project || !canManageProject(profileId, project)) {
    return (
      <SafeAreaView style={styles.screen}>
        <ModalHeader title="Edit project" onCancel={close} onSave={() => undefined} canSave={false} />
        <EmptyState
          title={project ? "You can't edit this project" : PROJECT_NOT_FOUND.title}
          body={
            project ? 'Only the profile that owns it can. Switch to it to make changes.' : PROJECT_NOT_FOUND.body
          }
          action={{ label: 'Back', onPress: close }}
        />
      </SafeAreaView>
    );
  }

  return <EditProjectForm project={project} onDone={close} />;
}

/**
 * The form, once the project has loaded. It starts from the project; a
 * refetch moves it along until the owner starts editing, and never after.
 */
function EditProjectForm({ project, onDone }: { project: Project; onDone: () => void }) {
  const { addToast } = useApp();
  const { authUserId } = useCurrentProfile();
  const updateProject = useUpdateProject(authUserId);
  // Part of (ONE-134): the owner's other top-level projects — and none for a
  // project that holds others, since nesting is one level deep.
  const owned = useOwnedProjectsQuery(project.ownerProfileId);
  const inside = useChildProjectsQuery(project.id);
  const choices = (inside.data ?? []).length > 0 ? [] : parentChoices(owned.data ?? [], project.id);
  const form = useAppForm({
    ...projectFormOptions,
    defaultValues: projectDraftFrom(project),
    onSubmit: ({ value }) =>
      updateProject.mutate(
        { project, edits: projectEditsFrom(value) },
        {
          onSuccess: () => {
            addToast('Saved.', 'success');
            onDone();
          },
          onError: (error) =>
            addToast(error instanceof MediaUploadError ? PROJECT_PHOTO_FAILED : PROJECT_SAVE_FAILED, 'error'),
        },
      ),
  });
  const valid = useStore(form.store, (state) => state.canSubmit);
  // Save waits for something to save, not just for a valid draft.
  const changed = useStore(form.store, (state) => projectDraftChanged(state.values, project));

  const canSave = valid && changed && !updateProject.isPending;
  const handleSave = () => {
    if (canSave) void form.handleSubmit();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ModalHeader
        title="Edit project"
        onCancel={onDone}
        onSave={handleSave}
        canSave={canSave}
        saving={updateProject.isPending}
      />
      <KeyboardAvoider style={styles.fill}>
        <FormScrollView style={styles.fill} contentContainerStyle={styles.scroll}>
          <ProjectForm form={form} parentChoices={choices} />
        </FormScrollView>
      </KeyboardAvoider>
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
  scroll: {
    paddingBottom: space.xxl,
  },
});
