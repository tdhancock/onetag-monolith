import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button, IconButton, ListRow, Sheet, SheetRow, TextField } from './ui';
import { DotsHorizontalIcon } from './Icons';
import { RowSkeletons, SectionError } from './SectionStates';
import { useApp } from '../../store/AppContext.native';
import {
  useRemoveContributor,
  useSetContributorPublic,
  useUpdateContributorRole,
  type Contributor,
  type Project,
} from '../../features/projects';
import {
  CONTRIBUTOR_ROLE_MAX_LENGTH,
  contributorRoleOrNull,
  contributorSubtitle,
  contributorsEmptyState,
  contributorVisibilityAction,
  ownContributorLink,
  removeContributorConfirm,
  removeSelfConfirm,
} from '../../lib/screens/projects';
import { color, space, type } from '../../theme/tokens';

export interface ProjectContributorsProps {
  project: Pick<Project, 'id' | 'name' | 'isPublic' | 'ownerProfileId'>;
  contributors: Contributor[] | undefined;
  isPending: boolean;
  /** The read failed: say so and offer to retry, rather than claim there are none. */
  isError: boolean;
  onRetry: () => void;
  /** The project's owner manages every link; everyone else only reads them. */
  isOwner: boolean;
  /** The active profile, to find its own link — and offer to remove it. */
  profileId: string | undefined;
  onOpenProfile: (username: string) => void;
  /** Opens the picker. The owner's alone. */
  onAdd: () => void;
  /** After a contributor removes themselves from a private project, which they can no longer see. */
  onLeftPrivateProject: () => void;
}

/**
 * A project's Contributors (ONE-41, ONE-42): each profile Linked to it,
 * business or individual, tappable through to its profile — one direction of
 * Waterfall Discovery; the profile's own projects are the other.
 *
 * The owner adds, re-labels, hides and removes links. A contributor who is
 * not the owner gets one control, "Remove me from this project", in plain
 * sight: being named is a public claim about them, and this is how they
 * withdraw it. Everyone else only reads.
 */
const ProjectContributors: React.FC<ProjectContributorsProps> = ({
  project,
  contributors,
  isPending,
  isError,
  onRetry,
  isOwner,
  profileId,
  onOpenProfile,
  onAdd,
  onLeftPrivateProject,
}) => {
  const { addToast } = useApp();
  const remove = useRemoveContributor();
  const [selected, setSelected] = useState<Contributor | null>(null);

  if (isPending) return <RowSkeletons count={2} />;
  if (isError) return <SectionError message="Couldn't load the contributors." onRetry={onRetry} />;

  const list = (contributors ?? []).filter((contributor) => contributor.profile !== null);
  const ownLink = ownContributorLink(profileId, project, contributors);

  const removeSelf = () => {
    if (!ownLink) return;
    const confirm = removeSelfConfirm(project);
    Alert.alert(confirm.title, confirm.body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: confirm.confirm,
        style: 'destructive',
        onPress: () =>
          remove.mutate(ownLink, {
            onSuccess: () => {
              addToast("You're no longer listed on this project.", 'info');
              if (!project.isPublic) onLeftPrivateProject();
            },
            onError: () => addToast("Couldn't remove you. You're still listed.", 'error'),
          }),
      },
    ]);
  };

  if (list.length === 0) {
    const empty = contributorsEmptyState(isOwner);
    return (
      <View style={styles.pad}>
        <Text style={styles.emptyTitle}>{empty.title}</Text>
        <Text style={styles.emptyBody}>{empty.body}</Text>
        {isOwner ? (
          <Button variant="outline" size="sm" onPress={onAdd} style={styles.emptyAction}>
            Add a contributor
          </Button>
        ) : null}
      </View>
    );
  }

  return (
    <>
      {list.map((contributor, index) => {
        const profile = contributor.profile!;
        return (
          <ListRow
            key={contributor.id}
            title={profile.name}
            subtitle={contributorSubtitle(contributor)}
            avatarUri={profile.avatarUrl}
            verified={profile.isVerified}
            accessibilityLabel={`${profile.name}, ${contributorSubtitle(contributor)}`}
            trailing={
              isOwner ? (
                <IconButton
                  icon={<DotsHorizontalIcon color={color.textMid} size={18} />}
                  accessibilityLabel={`Options for ${profile.name}`}
                  onPress={() => setSelected(contributor)}
                />
              ) : null
            }
            divider={index < list.length - 1}
            onPress={() => onOpenProfile(profile.username)}
          />
        );
      })}
      {ownLink ? (
        <View style={styles.pad}>
          <Button variant="outline" size="sm" onPress={removeSelf} loading={remove.isPending} fullWidth>
            Remove me from this project
          </Button>
        </View>
      ) : null}
      {isOwner ? <ContributorOptions contributor={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
};

/**
 * The owner's options for one contributor link: its role, whether visitors
 * see it, and removing it. The role is edited in the same sheet.
 */
function ContributorOptions({ contributor, onClose }: { contributor: Contributor | null; onClose: () => void }) {
  const { addToast } = useApp();
  const updateRole = useUpdateContributorRole();
  const setPublic = useSetContributorPublic();
  const remove = useRemoveContributor();
  const [editingRole, setEditingRole] = useState(false);
  const [role, setRole] = useState('');

  useEffect(() => {
    setEditingRole(false);
    setRole(contributor?.role ?? '');
  }, [contributor]);

  if (!contributor) return null;
  const name = contributor.profile?.name ?? 'this contributor';
  const visibility = contributorVisibilityAction(contributor.isPublic);

  const saveRole = () =>
    updateRole.mutate(
      { contributor, role: contributorRoleOrNull(role) },
      {
        onSuccess: onClose,
        onError: () => addToast("Couldn't save the role. Try again.", 'error'),
      },
    );

  const toggleVisibility = () => {
    onClose();
    setPublic.mutate(
      { contributor, isPublic: !contributor.isPublic },
      { onError: () => addToast("Couldn't change who sees them. It's as it was.", 'error') },
    );
  };

  const confirmRemove = () => {
    onClose();
    const confirm = removeContributorConfirm(name);
    Alert.alert(confirm.title, confirm.body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: confirm.confirm,
        style: 'destructive',
        onPress: () =>
          remove.mutate(contributor, { onError: () => addToast(`Couldn't remove ${name}. They're still listed.`, 'error') }),
      },
    ]);
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={editingRole ? `${name}'s role` : name}
      onBack={editingRole ? () => setEditingRole(false) : undefined}
    >
      {editingRole ? (
        <View style={styles.roleEditor}>
          <TextField
            label="Role"
            value={role}
            onChangeText={setRole}
            placeholder="Optional, e.g. Architect"
            maxLength={CONTRIBUTOR_ROLE_MAX_LENGTH}
            accessibilityLabel="Role"
          />
          <Button onPress={saveRole} loading={updateRole.isPending} style={styles.roleSave}>
            Save role
          </Button>
        </View>
      ) : (
        <>
          <SheetRow label={contributor.role ? 'Edit role' : 'Add a role'} onPress={() => setEditingRole(true)} />
          <SheetRow label={visibility.label} hint={visibility.hint} onPress={toggleVisibility} />
          <SheetRow label="Remove from project" destructive onPress={confirmRemove} />
        </>
      )}
    </Sheet>
  );
}

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
  roleEditor: {
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
  },
  roleSave: {
    marginTop: space.md,
  },
});

export default ProjectContributors;
