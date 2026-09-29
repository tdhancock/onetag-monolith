import React from 'react';
import { StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStore } from '@tanstack/react-form';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile } from '../../features/profiles';
import { useCreateProject } from '../../features/projects';
import { MediaUploadError } from '../../services/mediaUpload';
import KeyboardAvoider from '../../components/native/KeyboardAvoider';
import FormScrollView from '../../components/native/FormScrollView';
import ModalHeader from '../../components/native/ModalHeader';
import ProjectForm, { projectFormOptions } from '../../components/native/ProjectForm';
import { useAppForm } from '../../components/native/form';
import {
  newProjectInputFrom,
  PROJECT_PHOTO_FAILED,
  PROJECT_SAVE_FAILED,
  projectRoute,
} from '../../lib/screens/projects';
import { color, space } from '../../theme/tokens';

/**
 * Start a project (ONE-41), owned by the active profile — business or
 * individual: an individual documenting their own build is as welcome as a
 * business showing a job. A modal, declared in app/_layout.tsx.
 */
export default function CreateProjectScreen() {
  const router = useRouter();
  const { addToast } = useApp();
  const { profileId, authUserId } = useCurrentProfile();
  const createProject = useCreateProject(authUserId);
  const form = useAppForm({
    ...projectFormOptions,
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
          <ProjectForm form={form} />
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
