import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Button, ListRow } from './ui';
import { RowSkeletons, SectionError } from './SectionStates';
import type { ProjectSummary } from '../../features/projects';
import { INCLUDES_EMPTY, PRIVATE_LABEL, projectRowSubtitle } from '../../lib/screens/projects';
import { color, space, type } from '../../theme/tokens';

export interface ProjectIncludesProps {
  /** The projects inside this one the viewer may see, newest first. */
  projects: ProjectSummary[] | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  isOwner: boolean;
  onOpen: (projectId: string) => void;
  /** The owner's "Add a project", starting inside this one. */
  onAdd: () => void;
}

/**
 * What a project holds (ONE-134): a house's furnace, AC and water heater,
 * each a project of its own with its own page and tags. One level deep, so a
 * project inside another never shows this section.
 */
const ProjectIncludes: React.FC<ProjectIncludesProps> = ({ projects, isPending, isError, onRetry, isOwner, onOpen, onAdd }) => {
  if (isPending) return <RowSkeletons count={2} />;
  if (isError) return <SectionError message="Couldn't load what this project includes." onRetry={onRetry} />;

  if (!projects || projects.length === 0) {
    return (
      <View style={styles.pad}>
        <Text style={styles.emptyTitle}>{INCLUDES_EMPTY.title}</Text>
        <Text style={styles.emptyBody}>{INCLUDES_EMPTY.body}</Text>
        <Button variant="outline" size="sm" onPress={onAdd} style={styles.emptyAction}>
          Add a project
        </Button>
      </View>
    );
  }

  return (
    <>
      {projects.map((project, index) => {
        const subtitle = [project.isPublic ? null : PRIVATE_LABEL, projectRowSubtitle(project)].filter(Boolean).join(' · ');
        return (
          <ListRow
            key={project.id}
            title={project.name}
            subtitle={subtitle}
            leading={
              project.coverUrl ? (
                <Image source={{ uri: project.coverUrl }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={styles.thumb} />
              )
            }
            accessibilityLabel={`${project.name}, ${subtitle}`}
            divider={index < projects.length - 1 || isOwner}
            onPress={() => onOpen(project.id)}
          />
        );
      })}
    </>
  );
};

const styles = StyleSheet.create({
  pad: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  emptyTitle: {
    fontFamily: type.bodyBold,
    fontSize: 15,
    color: color.text,
  },
  emptyBody: {
    marginTop: space.xs,
    fontFamily: type.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.textMid,
  },
  emptyAction: {
    marginTop: space.md,
    alignSelf: 'flex-start',
  },
  thumb: {
    width: 40,
    height: 40,
    backgroundColor: color.bgPanel,
  },
});

export default ProjectIncludes;
