import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Avatar, Button, IconButton, MonoLabel, Pressable, Sheet, SheetRow } from './ui';
import { DotsHorizontalIcon } from './Icons';
import { RowSkeletons, SectionError } from './SectionStates';
import { useApp } from '../../store/AppContext.native';
import { useDeleteLogEntry, useRemoveMeFromLogEntry, type ProjectLogEntry } from '../../features/projects';
import {
  deleteLogEntryConfirm,
  formatLogCost,
  LOG_EMPTY,
  logEntryActions,
  logEntryDate,
  removeMeFromLogEntryConfirm,
} from '../../lib/screens/projectLog';
import { color, space, type } from '../../theme/tokens';

export interface ProjectLogProps {
  entries: ProjectLogEntry[] | undefined;
  isPending: boolean;
  /** The read failed: say so and offer to retry, rather than claim there is nothing. */
  isError: boolean;
  onRetry: () => void;
  /** The project's owner adds, edits and deletes entries. */
  isOwner: boolean;
  /** The active profile, to find the entries naming it — and offer Remove me. */
  profileId: string | undefined;
  onOpenProfile: (username: string) => void;
  /** Opens Add to log. The owner's alone. */
  onAdd: () => void;
  onEdit: (entry: ProjectLogEntry) => void;
}

const PHOTO = 64;

/**
 * A project's log (ONE-141), newest first: the day, what was done, who did it
 * (one tap from their profile), what it cost, notes and photos. For a home
 * record, the service history; for a build, its progress.
 *
 * The owner edits or deletes an entry from its ⋯ menu. The profile named as
 * who did the work gets Remove me there: being named is a claim about them,
 * and this is how they withdraw it.
 */
const ProjectLog: React.FC<ProjectLogProps> = ({
  entries,
  isPending,
  isError,
  onRetry,
  isOwner,
  profileId,
  onOpenProfile,
  onAdd,
  onEdit,
}) => {
  const { addToast } = useApp();
  const remove = useDeleteLogEntry();
  const removeMe = useRemoveMeFromLogEntry();
  const [selected, setSelected] = useState<ProjectLogEntry | null>(null);

  if (isPending) return <RowSkeletons count={2} />;
  if (isError) return <SectionError message="Couldn't load the log." onRetry={onRetry} />;

  const list = entries ?? [];
  if (list.length === 0) {
    // Only the owner sees an empty log; the page leaves it out for anyone else.
    return (
      <View style={styles.pad}>
        <Text style={styles.emptyTitle}>{LOG_EMPTY.title}</Text>
        <Text style={styles.emptyBody}>{LOG_EMPTY.body}</Text>
        <Button variant="outline" size="sm" onPress={onAdd} style={styles.emptyAction}>
          Add to log
        </Button>
      </View>
    );
  }

  const actions = selected ? logEntryActions(selected, { isOwner, profileId }) : [];
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

  return (
    <>
      {list.map((entry, index) => {
        const cost = formatLogCost(entry.costCents, entry.currency);
        const date = logEntryDate(entry.occurredOn);
        const person = entry.performedBy;
        const hasMenu = logEntryActions(entry, { isOwner, profileId }).length > 0;
        return (
          <View
            key={entry.id}
            style={[styles.entry, index < list.length - 1 && styles.divider]}
            accessibilityLabel={[date, entry.title, cost].filter(Boolean).join(', ')}
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
          </View>
        );
      })}

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
});

export default ProjectLog;
