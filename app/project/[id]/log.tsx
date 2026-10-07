import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { formOptions, useStore } from '@tanstack/react-form';
import { useApp } from '../../../store/AppContext.native';
import { useCurrentProfile } from '../../../features/profiles';
import {
  useCreateLogEntry,
  useProjectLogQuery,
  useProjectQuery,
  useUpdateLogEntry,
  type Project,
  type ProjectLogEntry,
} from '../../../features/projects';
import { MediaUploadError } from '../../../services/mediaUpload';
import { pickImageFromLibrary } from '../../../services/mediaPicker';
import KeyboardAvoider from '../../../components/native/KeyboardAvoider';
import FormScrollView from '../../../components/native/FormScrollView';
import ModalHeader from '../../../components/native/ModalHeader';
import DateField from '../../../components/native/DateField';
import LogPersonPicker from '../../../components/native/LogPersonPicker';
import { useAppForm } from '../../../components/native/form';
import { EmptyState, MonoLabel, Pressable, SettingsRow, Sheet, SheetRow } from '../../../components/native/ui';
import { PlusIcon } from '../../../components/native/Icons';
import { draftValidator } from '../../../lib/formErrors';
import { canManageProject, PROJECT_NOT_FOUND } from '../../../lib/screens/projects';
import { newDraftKey } from '../../../lib/screens/products';
import {
  emptyLogEntryDraft,
  LOG_NOTES_MAX_LENGTH,
  LOG_PHOTO_FAILED,
  LOG_PHOTOS_MAX,
  LOG_SAVE_FAILED,
  LOG_TITLE_MAX_LENGTH,
  logEntryDraftChanged,
  logEntryDraftErrors,
  logEntryDraftFrom,
  logEntryEditsFrom,
  newLogEntryInputFrom,
  type LogEntryDraft,
} from '../../../lib/screens/projectLog';
import { color, space, type } from '../../../theme/tokens';

const validateLogEntry = draftValidator((draft: LogEntryDraft) => logEntryDraftErrors(draft));

const logEntryFormOptions = formOptions({
  defaultValues: emptyLogEntryDraft() as LogEntryDraft,
  validators: { onMount: validateLogEntry, onChange: validateLogEntry },
});

const PHOTO_TILE = 72;

/**
 * Add to log, or edit one entry (ONE-141): what was done, on which day, by
 * whom, what it cost and photos of it. A modal, declared in app/_layout.tsx;
 * who did it is chosen in a Sheet inside it, since a modal never pushes a
 * screen. Only the project's owner gets the form.
 */
export default function LogEntryScreen() {
  const params = useLocalSearchParams<{ id?: string | string[]; entry?: string | string[] }>();
  const projectId = typeof params.id === 'string' ? params.id : '';
  const entryId = typeof params.entry === 'string' ? params.entry : undefined;
  const router = useRouter();
  const { profileId } = useCurrentProfile();
  const project = useProjectQuery(projectId);
  const log = useProjectLogQuery(entryId ? projectId : undefined);
  const title = entryId ? 'Edit log entry' : 'Add to log';

  const close = () => router.back();

  if (project.isPending || (entryId && log.isPending)) {
    return (
      <SafeAreaView style={styles.screen}>
        <ModalHeader title={title} onCancel={close} onSave={() => undefined} canSave={false} />
        <ActivityIndicator style={styles.loading} color={color.textMuted} accessibilityLabel="Loading" />
      </SafeAreaView>
    );
  }

  const entry = entryId ? log.data?.find((candidate) => candidate.id === entryId) : undefined;
  if (!project.data || !canManageProject(profileId, project.data) || (entryId && !entry)) {
    return (
      <SafeAreaView style={styles.screen}>
        <ModalHeader title={title} onCancel={close} onSave={() => undefined} canSave={false} />
        <EmptyState
          title={
            !project.data ? PROJECT_NOT_FOUND.title : entryId && !entry ? 'Entry not found' : "You can't change this log"
          }
          body={
            !project.data
              ? PROJECT_NOT_FOUND.body
              : entryId && !entry
                ? 'It may have been deleted.'
                : "Only the profile that owns the project can add to its log. Switch to it to add one."
          }
          action={{ label: 'Back', onPress: close }}
        />
      </SafeAreaView>
    );
  }

  return <LogEntryForm project={project.data} entry={entry} title={title} onDone={close} />;
}

function LogEntryForm({
  project,
  entry,
  title,
  onDone,
}: {
  project: Project;
  entry: ProjectLogEntry | undefined;
  title: string;
  onDone: () => void;
}) {
  const { addToast } = useApp();
  const { authUserId } = useCurrentProfile();
  const create = useCreateLogEntry(authUserId);
  const update = useUpdateLogEntry(authUserId);
  const saving = create.isPending || update.isPending;
  const [choosingPerson, setChoosingPerson] = useState(false);
  // The photo whose options are open.
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);

  const done = () => {
    addToast(entry ? 'Saved.' : 'Added to the log.', 'success');
    onDone();
  };
  const failed = (error: unknown) => addToast(error instanceof MediaUploadError ? LOG_PHOTO_FAILED : LOG_SAVE_FAILED, 'error');

  const form = useAppForm({
    ...logEntryFormOptions,
    defaultValues: entry ? logEntryDraftFrom(entry) : emptyLogEntryDraft(),
    onSubmit: ({ value }) =>
      entry
        ? update.mutate({ entry, edits: logEntryEditsFrom(value) }, { onSuccess: done, onError: failed })
        : create.mutate(newLogEntryInputFrom(value, project.id), { onSuccess: done, onError: failed }),
  });
  const valid = useStore(form.store, (state) => state.canSubmit);
  // An edit waits for something to save, not just for a valid draft.
  const changed = useStore(form.store, (state) => !entry || logEntryDraftChanged(state.values, entry));
  const performedBy = useStore(form.store, (state) => state.values.performedBy);
  const photos = useStore(form.store, (state) => state.values.photos);

  const canSave = valid && changed && !saving;
  const handleSave = () => {
    if (canSave) void form.handleSubmit();
  };

  const addPhoto = async () => {
    const result = await pickImageFromLibrary({ aspect: [4, 3] });
    if (result.status === 'selected') form.pushFieldValue('photos', { key: newDraftKey(), uri: result.media.uri });
  };
  const movePhoto = (from: number, to: number) => {
    form.moveFieldValues('photos', from, to);
    setPhotoIndex(null);
  };
  const removePhoto = (index: number) => {
    void form.removeFieldValue('photos', index);
    setPhotoIndex(null);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ModalHeader title={title} onCancel={onDone} onSave={handleSave} canSave={canSave} saving={saving} />
      <KeyboardAvoider style={styles.fill}>
        <FormScrollView style={styles.fill} contentContainerStyle={styles.scroll}>
          <View style={[styles.section, styles.fields]}>
            <Text style={styles.project}>{project.name}</Text>
            <form.Field name="occurredOn">
              {(field) => (
                <DateField
                  label="When"
                  value={field.state.value}
                  onChange={field.handleChange}
                  maximumDate={new Date()}
                  error={field.state.meta.errors.find((e): e is string => typeof e === 'string') ?? null}
                  accessibilityLabel="When"
                />
              )}
            </form.Field>
            <form.AppField name="title">
              {(field) => (
                <field.TextField
                  label="What was done"
                  placeholder="e.g. Replaced the igniter"
                  maxLength={LOG_TITLE_MAX_LENGTH}
                  accessibilityLabel="What was done"
                />
              )}
            </form.AppField>
          </View>

          <SettingsRow
            title="Who did it"
            subtitle={performedBy ? performedBy.name : 'Optional: the business or person'}
            onPress={() => setChoosingPerson(true)}
            accessibilityLabel={`Who did it: ${performedBy ? performedBy.name : 'no one named'}`}
            divider
          />
          <LogPersonPicker
            visible={choosingPerson}
            current={performedBy}
            onPick={(person) => {
              form.setFieldValue('performedBy', person);
              setChoosingPerson(false);
            }}
            onClose={() => setChoosingPerson(false)}
          />

          <View style={[styles.section, styles.fields]}>
            <View>
              <View style={styles.costRow}>
                <form.AppField name="cost">
                  {(field) => (
                    <field.TextField
                      label="Cost"
                      placeholder="Optional"
                      keyboardType="decimal-pad"
                      containerStyle={styles.cost}
                      errorWhileTyping
                      accessibilityLabel="Cost"
                    />
                  )}
                </form.AppField>
                <form.AppField name="currency">
                  {(field) => (
                    <field.TextField
                      label="Currency"
                      format={(value) => value.toUpperCase()}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      maxLength={3}
                      containerStyle={styles.currency}
                      errorWhileTyping
                      accessibilityLabel="Currency"
                    />
                  )}
                </form.AppField>
              </View>
              <Text style={styles.hint}>A record of what it cost. Nothing is paid through OneTag.</Text>
            </View>
            <form.AppField name="notes">
              {(field) => (
                <field.TextField
                  label="Notes"
                  placeholder="Optional. Parts, settings, what to watch for."
                  multiline
                  maxLength={LOG_NOTES_MAX_LENGTH}
                  inputStyle={styles.notes}
                  accessibilityLabel="Notes"
                />
              )}
            </form.AppField>
          </View>

          <View style={styles.section}>
            <MonoLabel color="textMid">Photos</MonoLabel>
            <Text style={styles.hint}>Up to {LOG_PHOTOS_MAX}: the work, a part, the receipt. Tap one to move or remove it.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
              {photos.map((photo, index) => (
                <Pressable
                  key={photo.key}
                  onPress={() => setPhotoIndex(index)}
                  accessibilityRole="button"
                  accessibilityLabel={`Photo ${index + 1} of ${photos.length}`}
                  accessibilityHint="Opens options to move or remove it"
                  style={styles.photo}
                >
                  <Image source={{ uri: photo.uri }} style={styles.photoImage} contentFit="cover" />
                </Pressable>
              ))}
              {photos.length < LOG_PHOTOS_MAX ? (
                <Pressable
                  onPress={() => void addPhoto()}
                  accessibilityRole="button"
                  accessibilityLabel="Add a photo"
                  style={[styles.photo, styles.addPhoto]}
                >
                  <PlusIcon color={color.text} size={22} />
                </Pressable>
              ) : null}
            </ScrollView>
          </View>
          <Sheet visible={photoIndex !== null} onClose={() => setPhotoIndex(null)}>
            {photoIndex !== null && photoIndex > 0 ? (
              <SheetRow label="Move earlier" onPress={() => movePhoto(photoIndex, photoIndex - 1)} />
            ) : null}
            {photoIndex !== null && photoIndex < photos.length - 1 ? (
              <SheetRow label="Move later" onPress={() => movePhoto(photoIndex, photoIndex + 1)} />
            ) : null}
            <SheetRow label="Remove photo" destructive onPress={() => photoIndex !== null && removePhoto(photoIndex)} />
          </Sheet>
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
  loading: {
    marginTop: space.xxl,
  },
  section: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  fields: {
    gap: space.lg,
  },
  project: {
    fontFamily: type.bodyBold,
    fontSize: 15,
    color: color.text,
  },
  costRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  cost: {
    flex: 2,
  },
  currency: {
    flex: 1,
  },
  hint: {
    marginTop: space.xs,
    fontFamily: type.body,
    fontSize: 13,
    lineHeight: 18,
    color: color.textMid,
  },
  notes: {
    minHeight: 90,
  },
  photos: {
    gap: space.sm,
    paddingTop: space.md,
  },
  photo: {
    width: PHOTO_TILE,
    height: PHOTO_TILE,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.bgPanel,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  addPhoto: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.bg,
  },
});
