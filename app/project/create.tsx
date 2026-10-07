import React from 'react';
import { StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStore } from '@tanstack/react-form';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile } from '../../features/profiles';
import { useCreateProject, useOwnedProjectsQuery } from '../../features/projects';
import { MediaUploadError } from '../../services/mediaUpload';
import KeyboardAvoider from '../../components/native/KeyboardAvoider';
import FormScrollView from '../../components/native/FormScrollView';
import ModalHeader from '../../components/native/ModalHeader';
import ProjectForm, { projectFormOptions } from '../../components/native/ProjectForm';
import { useAppForm } from '../../components/native/form';
import {
  EMPTY_PROJECT_DRAFT,
  newProjectInputFrom,
  parentChoices,
  PROJECT_PHOTO_FAILED,
  PROJECT_SAVE_FAILED,
  projectRoute,
} from '../../lib/screens/projects';
import { color, space } from '../../theme/tokens';

/**
 * Start a project (ONE-41), owned by the active profile — business or
 * individual: an individual documenting their own build is as welcome as a
 * business showing a job. A modal, declared in app/_layout.tsx.
 *
 * Opened from a project's "Add a project" (ONE-134), it starts inside that
 * project. Any of the profile's own top-level projects can be chosen instead.
 */
export default function CreateProjectScreen() {
  const router = useRouter();
  const { addToast } = useApp();
  const params = useLocalSearchParams<{ parent?: string | string[] }>();
  const parent = typeof params.parent === 'string' ? params.parent : null;
  const { profileId, authUserId } = useCurrentProfile();
  const createProject = useCreateProject(authUserId);
  const owned = useOwnedProjectsQuery(profileId);
  const form = useAppForm({
    ...projectFormOptions,
    defaultValues: { ...EMPTY_PROJECT_DRAFT, parentProjectId: parent },
    onSubmit: ({ value }) => {
      if (!profileId) return;
      createProject.mutate(newProjectInputFrom(value, profileId), {
        onSuccess: (projectId) => {
          addToast('Project created.', 'success');
          router.replace(projectRoute(projectId));
        },
        onError: (error) => addToast(error instanceof MediaUploadError ? PROJECT_PHOTO_FAILED : PROJECT_SAVE_FAILED, 'error'),
      });
    },
  });
  const valid = useStore(form.store, (state) => state.canSubmit);

  const canSave = valid && Boolean(profileId) && !createProject.isPending;
  const handleSave = () => {
    if (canSave) void form.handleSubmit();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ModalHeader
        title="New project"
        onCancel={() => router.back()}
        onSave={handleSave}
        canSave={canSave}
        saving={createProject.isPending}
      />
      <KeyboardAvoider style={styles.fill}>
        <FormScrollView style={styles.fill} contentContainerStyle={styles.scroll}>
          <ProjectForm form={form} parentChoices={parentChoices(owned.data ?? [])} />
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
  scroll: {
    paddingBottom: space.xxl,
  },
});
