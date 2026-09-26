import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Button, MonoLabel, Pressable, SettingsRow, TextField } from './ui';
import { ImageIcon } from './Icons';
import { pickImageFromLibrary } from '../../services/mediaPicker';
import {
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_TYPE_MAX_LENGTH,
  PROJECT_YEAR_MAX_LENGTH,
  projectNameError,
  projectVisibilityDescription,
  type ProjectDraft,
} from '../../lib/screens/projects';
import { color, space, type } from '../../theme/tokens';

export interface ProjectFormProps {
  draft: ProjectDraft;
  onChange: (draft: ProjectDraft) => void;
}

/**
 * The fields a project is created and edited with (ONE-41): a cover, its name,
 * type and year, a description, and whether it is public. The screen around
 * it owns saving.
 */
const ProjectForm: React.FC<ProjectFormProps> = ({ draft, onChange }) => {
  const [nameTouched, setNameTouched] = React.useState(false);
  const set = <K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) => onChange({ ...draft, [key]: value });

  const pickCover = async () => {
    const result = await pickImageFromLibrary({ aspect: [4, 3] });
    if (result.status === 'selected') set('coverUri', result.media.uri);
  };

  return (
    <>
      <View style={styles.section}>
        <MonoLabel color="textMid" style={styles.label}>
          Cover
        </MonoLabel>
        {draft.coverUri ? (
          <>
            <Image
              source={{ uri: draft.coverUri }}
              style={styles.cover}
              contentFit="cover"
              accessibilityLabel="Cover photo"
            />
            <View style={styles.coverActions}>
              <Button variant="outline" size="sm" onPress={() => void pickCover()} style={styles.coverAction}>
                Change cover
              </Button>
              <Button variant="outline" size="sm" onPress={() => set('coverUri', null)} style={styles.coverAction}>
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
        <TextField
          label="Name"
          value={draft.name}
          onChangeText={(value) => set('name', value)}
          onBlur={() => setNameTouched(true)}
          placeholder="What it's called"
          maxLength={PROJECT_NAME_MAX_LENGTH}
          error={nameTouched ? projectNameError(draft) : null}
          accessibilityLabel="Name"
        />
        <View style={styles.row}>
          <TextField
            label="Type"
            value={draft.projectType}
            onChangeText={(value) => set('projectType', value)}
            placeholder="e.g. Renovation"
            maxLength={PROJECT_TYPE_MAX_LENGTH}
            containerStyle={styles.type}
            accessibilityLabel="Type"
          />
          <TextField
            label="Year"
            value={draft.year}
            onChangeText={(value) => set('year', value)}
            placeholder="e.g. 2025"
            maxLength={PROJECT_YEAR_MAX_LENGTH}
            containerStyle={styles.year}
            accessibilityLabel="Year"
          />
        </View>
        <TextField
          label="Description"
          value={draft.description}
          onChangeText={(value) => set('description', value)}
          placeholder="Optional. What was built, and how."
          multiline
          maxLength={PROJECT_DESCRIPTION_MAX_LENGTH}
          inputStyle={styles.description}
          accessibilityLabel="Description"
        />
      </View>

      <SettingsRow
        title="Public"
        subtitle={projectVisibilityDescription(draft.isPublic)}
        control={
          <Switch
            value={draft.isPublic}
            onValueChange={(value) => set('isPublic', value)}
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
};

const styles = StyleSheet.create({
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
