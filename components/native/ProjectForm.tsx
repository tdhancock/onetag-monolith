import React, { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { formOptions, useStore } from '@tanstack/react-form';
import { Button, MonoLabel, Pressable, SettingsRow, Sheet, SheetRow } from './ui';
import InterestFilter from './InterestFilter';
import { CheckIcon, ImageIcon } from './Icons';
import { withForm } from './form';
import { pickImageFromLibrary } from '../../services/mediaPicker';
import { draftValidator } from '../../lib/formErrors';
import {
  EMPTY_PROJECT_DRAFT,
  NOT_PART_OF_ANYTHING,
  partOfLabel,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_TYPE_MAX_LENGTH,
  PROJECT_YEAR_MAX_LENGTH,
  projectDraftErrors,
  projectVisibilityDescription,
  type ProjectDraft,
  type ProjectParentChoice,
} from '../../lib/screens/projects';
import { color, space, type } from '../../theme/tokens';

const validateProject = draftValidator(projectDraftErrors);

/**
 * What Add and Edit build their project form from: the draft's shape, and its
 * rules checked from the start and on every change. Each screen adds its own
 * starting draft and what saving does.
 */
export const projectFormOptions = formOptions({
  defaultValues: EMPTY_PROJECT_DRAFT as ProjectDraft,
  validators: { onMount: validateProject, onChange: validateProject },
});

/**
 * The fields a project is created and edited with (ONE-41): a cover, its name,
 * type and year, a description, the project it is part of (ONE-134), and
 * whether it is public. The screen around it owns saving.
 *
 * `parentChoices` are the projects it may go inside: the profile's own
 * top-level projects. A project that holds others gets none, since nesting is
 * one level deep, and then Part of isn't offered at all.
 */
const ProjectForm = withForm({
  ...projectFormOptions,
  props: { parentChoices: [] as ProjectParentChoice[] },
  render: function ProjectFields({ form, parentChoices }) {
    const coverUri = useStore(form.store, (state) => state.values.coverUri);
    const interestSlug = useStore(form.store, (state) => state.values.interestSlug);
    const isPublic = useStore(form.store, (state) => state.values.isPublic);
    const parentProjectId = useStore(form.store, (state) => state.values.parentProjectId);
    const [choosingParent, setChoosingParent] = useState(false);

    const chooseParent = (id: string | null) => {
      form.setFieldValue('parentProjectId', id);
      setChoosingParent(false);
    };

    const pickCover = async () => {
      const result = await pickImageFromLibrary({ aspect: [4, 3] });
      if (result.status === 'selected') form.setFieldValue('coverUri', result.media.uri);
    };

    return (
      <>
        <View style={styles.section}>
          <MonoLabel color="textMid" style={styles.label}>
            Cover
          </MonoLabel>
          {coverUri ? (
            <>
              <Image
                source={{ uri: coverUri }}
                style={styles.cover}
                contentFit="cover"
                accessibilityLabel="Cover photo"
              />
              <View style={styles.coverActions}>
                <Button variant="outline" size="sm" onPress={() => void pickCover()} style={styles.coverAction}>
                  Change cover
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onPress={() => form.setFieldValue('coverUri', null)}
                  style={styles.coverAction}
                >
                  Remove cover
                </Button>
              </View>
            </>
          ) : (
            <Pressable
              onPress={() => void pickCover()}
              accessibilityRole="button"
              accessibilityLabel="Add a cover photo"
              style={[styles.cover, styles.addCover]}
            >
              <ImageIcon color={color.textMid} size={28} />
              <MonoLabel color="textMid" style={styles.addCoverLabel}>
                Add a cover photo
              </MonoLabel>
            </Pressable>
          )}
        </View>

        <View style={[styles.section, styles.fields]}>
          <form.AppField name="name">
            {(field) => (
              <field.TextField
                label="Name"
                placeholder="What it's called"
                maxLength={PROJECT_NAME_MAX_LENGTH}
                accessibilityLabel="Name"
              />
            )}
          </form.AppField>
          <View style={styles.row}>
            <form.AppField name="projectType">
              {(field) => (
                <field.TextField
                  label="Type"
                  placeholder="e.g. Renovation"
                  maxLength={PROJECT_TYPE_MAX_LENGTH}
                  containerStyle={styles.type}
                  accessibilityLabel="Type"
                />
              )}
            </form.AppField>
            <form.AppField name="year">
              {(field) => (
                <field.TextField
                  label="Year"
                  placeholder="e.g. 2025"
                  maxLength={PROJECT_YEAR_MAX_LENGTH}
                  containerStyle={styles.year}
                  accessibilityLabel="Year"
                />
              )}
            </form.AppField>
          </View>
          <form.AppField name="description">
            {(field) => (
              <field.TextField
                label="Description"
                placeholder="Optional. What was built, and how."
                multiline
                maxLength={PROJECT_DESCRIPTION_MAX_LENGTH}
                inputStyle={styles.description}
                accessibilityLabel="Description"
              />
            )}
          </form.AppField>
        </View>

        {/* Optional, like the composer's (ONE-49): no forced choice. */}
        <View style={styles.interest}>
          <MonoLabel color="textMid" style={styles.interestLabel}>Interest (optional)</MonoLabel>
          <InterestFilter
            selected={interestSlug}
            onSelect={(slug) => form.setFieldValue('interestSlug', slug)}
            leadingLabel="None"
            label="Interest"
          />
        </View>

        {parentChoices.length > 0 ? (
          <SettingsRow
            title="Part of"
            subtitle={partOfLabel(parentChoices, parentProjectId)}
            onPress={() => setChoosingParent(true)}
            accessibilityLabel={`Part of: ${partOfLabel(parentChoices, parentProjectId)}`}
            divider
          />
        ) : null}
        <Sheet visible={choosingParent} onClose={() => setChoosingParent(false)} title="Part of">
          <SheetRow
            label={NOT_PART_OF_ANYTHING}
            hint="It stands on its own."
            icon={parentProjectId === null ? <CheckIcon color={color.text} size={18} strokeWidth={2} /> : undefined}
            onPress={() => chooseParent(null)}
          />
          {parentChoices.map((choice) => (
            <SheetRow
              key={choice.id}
              label={choice.name}
              icon={parentProjectId === choice.id ? <CheckIcon color={color.text} size={18} strokeWidth={2} /> : undefined}
              onPress={() => chooseParent(choice.id)}
            />
          ))}
        </Sheet>

        <SettingsRow
          title="Public"
          subtitle={projectVisibilityDescription(isPublic)}
          control={
            <Switch
              value={isPublic}
              onValueChange={(value) => form.setFieldValue('isPublic', value)}
              accessibilityLabel="Public"
              trackColor={{ true: color.text, false: color.borderStrong }}
              ios_backgroundColor={color.borderStrong}
              thumbColor={color.inverse}
            />
          }
        />
        <Text style={styles.footnote}>Contributors and products are added from the project's page.</Text>
      </>
    );
  },
});

const styles = StyleSheet.create({
  interest: {
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  interestLabel: {
    paddingHorizontal: space.lg,
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
  label: {
    marginBottom: space.sm,
  },
  cover: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: color.bgPanel,
  },
  addCover: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.border,
  },
  addCoverLabel: {
    marginTop: space.sm,
  },
  coverActions: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.md,
  },
  coverAction: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    gap: space.sm,
  },
  type: {
    flex: 2,
  },
  year: {
    flex: 1,
  },
  description: {
    minHeight: 110,
  },
  footnote: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontFamily: type.body,
    fontSize: 13,
    color: color.textMid,
  },
});

export default ProjectForm;
