import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../../store/AppContext.native';
import { useCurrentProfile } from '../../../features/profiles';
import { useProjectQuery, useUpdateProject } from '../../../features/projects';
import { MediaUploadError } from '../../../services/mediaUpload';
import KeyboardAvoider from '../../../components/native/KeyboardAvoider';
import ModalHeader from '../../../components/native/ModalHeader';
import ProjectForm from '../../../components/native/ProjectForm';
import { EmptyState } from '../../../components/native/ui';
import {
  canManageProject,
  PROJECT_NOT_FOUND,
  PROJECT_PHOTO_FAILED,
  PROJECT_SAVE_FAILED,
  projectDraftChanged,
  projectDraftFrom,
  projectDraftValid,
  projectEditsFrom,
  type ProjectDraft,
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
  const { addToast } = useApp();
  const { profileId, authUserId } = useCurrentProfile();
  const { data: project, isPending } = useProjectQuery(projectId);
  const updateProject = useUpdateProject(authUserId);
  const [draft, setDraft] = useState<ProjectDraft | null>(null);

  // Start the form from the project once, so a refetch never wipes an edit.
  useEffect(() => {
    if (project && draft === null) setDraft(projectDraftFrom(project));
  }, [project, draft]);

  const close = () => router.back();

  if (isPending || (project && !draft)) {
    return (
      <SafeAreaView style={styles.screen}>
        <ModalHeader title="Edit project" onCancel={close} onSave={() => undefined} canSave={false} />
        <ActivityIndicator style={styles.loading} color={color.textMuted} accessibilityLabel="Loading" />
      </SafeAreaView>
    );
  }

  if (!project || !draft || !canManageProject(profileId, project)) {
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

  const canSave = projectDraftValid(draft) && projectDraftChanged(draft, project) && !updateProject.isPending;

  const handleSave = () => {
    if (!canSave) return;
    updateProject.mutate(
      { projectId: project.id, edits: projectEditsFrom(draft) },
      {
        onSuccess: () => {
          addToast('Saved.', 'success');
          close();
        },
        onError: (error) =>
          addToast(error instanceof MediaUploadError ? PROJECT_PHOTO_FAILED : PROJECT_SAVE_FAILED, 'error'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ModalHeader
        title="Edit project"
        onCancel={close}
        onSave={handleSave}
        canSave={canSave}
        saving={updateProject.isPending}
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
  loading: {
    marginTop: space.xxl,
  },
  scroll: {
    paddingBottom: space.xxl,
  },
});
