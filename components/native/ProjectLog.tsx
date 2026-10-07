import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Avatar, Button, IconButton, MonoLabel, Pressable, Sheet, SheetRow } from './ui';
import { DotsHorizontalIcon } from './Icons';
import { RowSkeletons, SectionError } from './SectionStates';
import { useApp } from '../../store/AppContext.native';
import {
  useApproveLogEntry,
  useDeleteLogEntry,
  useRemoveMeFromLogEntry,
  type ProjectLogEntry,
} from '../../features/projects';
import {
  declineLogEntryConfirm,
  deleteLogEntryConfirm,
  formatLogCost,
  isAuthorOf,
  LOG_EMPTY,
  LOG_WRITE_LABEL,
  logEntryActions,
  logEntryDate,
  proposedBy,
  removeMeFromLogEntryConfirm,
  splitLog,
  WAITING_FOR_APPROVAL,
  WAITING_FOR_YOU,
  type LogWriteMode,
} from '../../lib/screens/projectLog';
import { color, space, type } from '../../theme/tokens';

export interface ProjectLogProps {
  /** Newest first: published entries, and the proposals the viewer may read. */
  entries: ProjectLogEntry[] | undefined;
  isPending: boolean;
  /** The read failed: say so and offer to retry, rather than claim there is nothing. */
  isError: boolean;
  onRetry: () => void;
  /** The project's owner approves and declines proposals, and edits and deletes any entry. */
  isOwner: boolean;
  /** How the viewer writes to the log, if at all (ONE-143): the empty log's button. */
  writeMode: LogWriteMode | null;
  /** The active profile, to find the entries it wrote or is named on. */
  profileId: string | undefined;
  onOpenProfile: (username: string) => void;
  /** Opens Add to log, or Propose a log entry. */
  onAdd: () => void;
  onEdit: (entry: ProjectLogEntry) => void;
}

const PHOTO = 64;

/**
 * A project's log (ONE-141), newest first: the day, what was done, who did it
 * (one tap from their profile), what it cost, notes and photos. For a home
 * record, the service history; for a build, its progress.
 *
 * Proposals come first (ONE-143): the owner's are Waiting for you, each with
 * Approve and Decline, and an author sees their own marked Waiting for
 * approval. Nobody else sees one. The owner edits or deletes a published
 * entry from its ⋯ menu, and an author their own. The profile named as who
 * did the work gets Remove me there: being named is a claim about them, and
 * this is how they withdraw it.
 */
const ProjectLog: React.FC<ProjectLogProps> = ({
  entries,
  isPending,
  isError,
  onRetry,
  isOwner,
  writeMode,
  profileId,
  onOpenProfile,
  onAdd,
  onEdit,
}) => {
  const { addToast } = useApp();
  const remove = useDeleteLogEntry();
  const removeMe = useRemoveMeFromLogEntry();
  const approve = useApproveLogEntry();
  const [selected, setSelected] = useState<ProjectLogEntry | null>(null);

  if (isPending) return <RowSkeletons count={2} />;
  if (isError) return <SectionError message="Couldn't load the log." onRetry={onRetry} />;

  const list = entries ?? [];
  if (list.length === 0) {
    // Only someone who may write sees an empty log; the page leaves it out for anyone else.
    return (
      <View style={styles.pad}>
        <Text style={styles.emptyTitle}>{LOG_EMPTY.title}</Text>
        <Text style={styles.emptyBody}>{LOG_EMPTY.body}</Text>
        {writeMode ? (
          <Button variant="outline" size="sm" onPress={onAdd} style={styles.emptyAction}>
            {LOG_WRITE_LABEL[writeMode]}
          </Button>
        ) : null}
      </View>
    );
  }

  const viewer = { isOwner, profileId };
  const actions = selected ? logEntryActions(selected, viewer) : [];
  const close = () => setSelected(null);

  const edit = (entry: ProjectLogEntry) => {
    close();
    onEdit(entry);
  };

  const confirmDelete = (entry: ProjectLogEntry) => {
    close();
    const confirm = deleteLogEntryConfirm(entry);
    Alert.alert(confirm.title, confirm.body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: confirm.confirm,
        style: 'destructive',
        onPress: () =>
          remove.mutate(entry, {
            onSuccess: () => addToast('Deleted from the log.', 'info'),
            onError: () => addToast("Couldn't delete it. Try again.", 'error'),
          }),
      },
    ]);
  };

  const confirmRemoveMe = (entry: ProjectLogEntry) => {
    close();
    const confirm = removeMeFromLogEntryConfirm;
    Alert.alert(confirm.title, confirm.body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: confirm.confirm,
        style: 'destructive',
        onPress: () =>
          removeMe.mutate(entry, {
            onSuccess: () => addToast("You're no longer named on it.", 'info'),
            onError: () => addToast("Couldn't remove your name. Try again.", 'error'),
          }),
      },
    ]);
  };

  const approveEntry = (entry: ProjectLogEntry) =>
    approve.mutate(entry, {
      onSuccess: () => addToast(`Added to the log. ${entry.author?.name ?? 'Its author'} is now a contributor.`, 'success'),
      onError: () => addToast("Couldn't approve it. Try again.", 'error'),
    });

  const confirmDecline = (entry: ProjectLogEntry) => {
    const confirm = declineLogEntryConfirm(entry);
    Alert.alert(confirm.title, confirm.body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: confirm.confirm,
        style: 'destructive',
        onPress: () =>
          remove.mutate(entry, {
            onSuccess: () => addToast('Declined.', 'info'),
            onError: () => addToast("Couldn't decline it. Try again.", 'error'),
          }),
      },
    ]);
  };

  const { waiting, published } = splitLog(list);

  const row = (entry: ProjectLogEntry, last: boolean) => {
    const cost = formatLogCost(entry.costCents, entry.currency);
    const date = logEntryDate(entry.occurredOn);
    const person = entry.performedBy;
    const proposed = entry.status === 'proposed';
    const hasMenu = logEntryActions(entry, viewer).length > 0;
    return (
      <View
        key={entry.id}
        style={[styles.entry, !last && styles.divider]}
        accessibilityLabel={[date, entry.title, cost, proposed && !isOwner ? WAITING_FOR_APPROVAL : null]
          .filter(Boolean)
          .join(', ')}
      >
        <View style={styles.head}>
          <View style={styles.headText}>
            <MonoLabel color="textMid">{date}</MonoLabel>
            <Text style={styles.title}>{entry.title}</Text>
          </View>
          {cost ? <Text style={styles.cost}>{cost}</Text> : null}
          {hasMenu ? (
            <IconButton
              icon={<DotsHorizontalIcon color={color.textMid} size={18} />}
              accessibilityLabel={`Options for ${entry.title}`}
              onPress={() => setSelected(entry)}
            />
          ) : null}
        </View>
        {proposed && !isOwner && isAuthorOf(profileId, entry) ? (
          <View style={styles.badge}>
            <MonoLabel color="inverse">{WAITING_FOR_APPROVAL}</MonoLabel>
          </View>
        ) : null}
        {person ? (
          <Pressable
            onPress={() => onOpenProfile(person.username)}
            accessibilityRole="link"
            accessibilityLabel={`Done by ${person.name}, @${person.username}`}
            hitSlop={8}
            style={styles.person}
          >
            <Avatar uri={person.avatarUrl} name={person.name} size={24} />
            <Text style={styles.personName}>{person.name}</Text>
          </Pressable>
        ) : null}
        {entry.notes ? <Text style={styles.notes}>{entry.notes}</Text> : null}
        {entry.photos.length > 0 ? (
          <View style={styles.photos}>
            {entry.photos.map((photo, photoIndex) => (
              <Image
                key={photo.id}
                source={{ uri: photo.url }}
                style={styles.photo}
                contentFit="cover"
                accessibilityLabel={`${entry.title}, photo ${photoIndex + 1} of ${entry.photos.length}`}
              />
            ))}
          </View>
        ) : null}
        {proposed && isOwner ? (
          <View>
            <Text style={styles.proposedBy}>{proposedBy(entry)}</Text>
            <View style={styles.decision}>
              <Button
                size="sm"
                onPress={() => approveEntry(entry)}
                loading={approve.isPending && approve.variables?.id === entry.id}
                accessibilityLabel={`Approve ${entry.title}`}
              >
                Approve
              </Button>
              <Button
                variant="outline"
                size="sm"
                onPress={() => confirmDecline(entry)}
                accessibilityLabel={`Decline ${entry.title}`}
              >
                Decline
              </Button>
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <>
      {waiting.length > 0 ? (
        <View style={styles.waiting} accessibilityLabel={isOwner ? WAITING_FOR_YOU : WAITING_FOR_APPROVAL}>
          {isOwner ? (
            <MonoLabel color="textMid" style={styles.groupLabel}>
              {WAITING_FOR_YOU}
            </MonoLabel>
          ) : null}
          {waiting.map((entry, index) => row(entry, index === waiting.length - 1))}
        </View>
      ) : null}
      {published.map((entry, index) => row(entry, index === published.length - 1))}

      <Sheet visible={selected !== null} onClose={close}>
        {selected && actions.includes('edit') ? <SheetRow label="Edit entry" onPress={() => edit(selected)} /> : null}
        {selected && actions.includes('remove-me') ? (
          <SheetRow
            label="Remove me"
            hint="Take your name off this entry. It stays on the log."
            destructive
            onPress={() => confirmRemoveMe(selected)}
          />
        ) : null}
        {selected && actions.includes('delete') ? (
          <SheetRow label="Delete entry" destructive onPress={() => confirmDelete(selected)} />
        ) : null}
      </Sheet>
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
  waiting: {
    backgroundColor: color.bgPanel,
    paddingTop: space.sm,
    marginBottom: space.sm,
  },
  groupLabel: {
    paddingHorizontal: space.lg,
  },
  entry: {
    marginHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.sm,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  headText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: type.bodyBold,
    fontSize: 15,
    lineHeight: 20,
    color: color.text,
  },
  cost: {
    fontFamily: type.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
    color: color.text,
    paddingTop: space.md,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: color.text,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.sm,
  },
  personName: {
    fontFamily: type.bodyMedium,
    fontSize: 14,
    color: color.text,
  },
  notes: {
    fontFamily: type.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.textMid,
  },
  photos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  photo: {
    width: PHOTO,
    height: PHOTO,
    backgroundColor: color.bgPanel,
  },
  proposedBy: {
    fontFamily: type.body,
    fontSize: 13,
    color: color.textMid,
  },
  decision: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.sm,
  },
});

export default ProjectLog;
