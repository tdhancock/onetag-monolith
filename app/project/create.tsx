import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile } from '../../features/profiles';
import { useCreateProject } from '../../features/projects';
import { MediaUploadError } from '../../services/mediaUpload';
import KeyboardAvoider from '../../components/native/KeyboardAvoider';
import ModalHeader from '../../components/native/ModalHeader';
import ProjectForm from '../../components/native/ProjectForm';
import {
  EMPTY_PROJECT_DRAFT,
  newProjectInputFrom,
  PROJECT_PHOTO_FAILED,
  PROJECT_SAVE_FAILED,
  projectDraftValid,
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
  const [draft, setDraft] = useState(EMPTY_PROJECT_DRAFT);

  const canSave = projectDraftValid(draft) && Boolean(profileId) && !createProject.isPending;

  const handleSave = () => {
    if (!canSave || !profileId) return;
    createProject.mutate(newProjectInputFrom(draft, profileId), {
      onSuccess: (projectId) => {
        addToast('Project created.', 'success');
        router.replace(projectRoute(projectId));
      },
      onError: (error) => addToast(error instanceof MediaUploadError ? PROJECT_PHOTO_FAILED : PROJECT_SAVE_FAILED, 'error'),
    });
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
        <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
          <ProjectForm draft={draft} onChange={setDraft} />
        </ScrollView>
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
