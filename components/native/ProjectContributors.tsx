import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ListRow, Skeleton } from './ui';
import { contributorsEmptyState } from '../../lib/screens/projects';
import type { Contributor } from '../../features/projects';
import { color, space, type } from '../../theme/tokens';

export interface ProjectContributorsProps {
  contributors: Contributor[] | undefined;
  isPending: boolean;
  /** The project's owner sees a prompt where a visitor sees an explanation. */
  isOwner: boolean;
  onOpenProfile: (username: string) => void;
}

/** "Architect · Business", or just the kind. */
const contributorSubtitle = (contributor: Contributor): string =>
  [contributor.role, contributor.profile?.profileType === 'business' ? 'Business' : 'Individual']
    .filter(Boolean)
    .join(' · ');

/**
 * A project's Contributors (ONE-41): each profile Linked to it, business or
 * individual, tappable through to its profile — one direction of Waterfall
 * Discovery.
 */
const ProjectContributors: React.FC<ProjectContributorsProps> = ({ contributors, isPending, isOwner, onOpenProfile }) => {
  if (isPending) {
    return (
      <View style={styles.pad}>
        <Skeleton height={40} />
      </View>
    );
  }

  const list = (contributors ?? []).filter((contributor) => contributor.profile !== null);
  if (list.length === 0) {
    const empty = contributorsEmptyState(isOwner);
    return (
      <View style={styles.pad}>
        <Text style={styles.emptyTitle}>{empty.title}</Text>
        <Text style={styles.emptyBody}>{empty.body}</Text>
      </View>
    );
  }

  return (
    <>
      {list.map((contributor, index) => (
        <ListRow
          key={contributor.id}
          title={contributor.profile!.name}
          subtitle={contributorSubtitle(contributor)}
          avatarUri={contributor.profile!.avatarUrl}
          verified={contributor.profile!.isVerified}
          divider={index < list.length - 1}
          onPress={() => onOpenProfile(contributor.profile!.username)}
        />
      ))}
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
});

export default ProjectContributors;
