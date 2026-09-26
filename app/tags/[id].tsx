import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile } from '../../features/profiles';
import { useDeleteTag, useMyTagQuery, useTagActiveToggle, useUpdateTag, type OwnedTag } from '../../features/tags';
import { Button, EmptyState, MonoLabel, SettingsRow, SettingsSection, TextField } from '../../components/native/ui';
import KeyboardAvoider from '../../components/native/KeyboardAvoider';
import TagQRCode from '../../components/native/TagQRCode';
import { InactiveBadge, TagActiveSwitch } from '../../components/native/TagRow';
import { copyTagLink, shareTagLink } from '../../services/tagSharing';
import { buildTagUrl } from '../../lib/tagLinks';
import { routeForDestination } from '../../lib/screens/tagResolution';
import {
  deleteTagConfirm,
  destinationLabel,
  replacementRoute,
  scanSummary,
  TAG_NAME_MAX_LENGTH,
  TAG_NOTE_MAX_LENGTH,
  TAG_TYPE_LABEL,
  TAGS_DASHBOARD_ROUTE,
  tagExportRoute,
  tagTextOrNull,
  tagTitle,
} from '../../lib/screens/tags';
import { color, space, type } from '../../theme/tokens';

/**
 * One tag, as its owner manages it (ONE-34): its QR code or link, where it
 * points, how often it has been scanned, and the controls.
 *
 * Only the name, the note and whether it is active can change. The short code
 * is printed on objects and the destination is what people scanned to reach —
 * changing either would silently repoint something in the world — so both
 * are shown and neither is editable. Replacing a damaged tag is a new tag
 * with the same destination, not an edit.
 */
export default function TagDetailScreen() {
  const router = useRouter();
  const { addToast } = useApp();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const tagId = typeof params.id === 'string' ? params.id : '';
  const { profileId } = useCurrentProfile();
  const { data: tag, isPending, isError, refetch } = useMyTagQuery(profileId, tagId);

  const header = <Stack.Screen options={{ headerShown: true, title: tag ? tagTitle(tag) : 'Tag' }} />;

  if (isPending) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <ActivityIndicator style={styles.loading} color={color.textMuted} accessibilityLabel="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !tag) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <EmptyState
          title={isError ? "Couldn't load this tag" : 'Tag not found'}
          body={isError ? 'Check your connection and try again.' : "This profile doesn't own a tag with that id."}
          action={
            isError
              ? { label: 'Try again', onPress: () => void refetch() }
              : { label: 'Your tags', onPress: () => router.replace(TAGS_DASHBOARD_ROUTE) }
          }
        />
      </SafeAreaView>
    );
  }

  // Somewhere to go next (Waterfall Discovery): the same route a scan of it takes.
  const destinationRoute = tag.destination ? routeForDestination(tag.destination) : null;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      {header}
      <TagDetail
        tag={tag}
        onExport={() => router.push(tagExportRoute(tag.id))}
        onReplace={() => router.push(replacementRoute(tag))}
        onOpenDestination={destinationRoute ? () => router.push(destinationRoute) : undefined}
        onDeleted={() => {
          addToast('Tag deleted.', 'info');
          router.back();
        }}
      />
    </SafeAreaView>
  );
}

function TagDetail({
  tag,
  onExport,
  onReplace,
  onOpenDestination,
  onDeleted,
}: {
  tag: OwnedTag;
  onExport: () => void;
  onReplace: () => void;
  onOpenDestination?: () => void;
  onDeleted: () => void;
}) {
  const { addToast } = useApp();
  const { profileId } = useCurrentProfile();
  const toggleActive = useTagActiveToggle(profileId);
  const updateTag = useUpdateTag(profileId);
  const deleteTag = useDeleteTag(profileId);

  const [name, setName] = useState(tag.name ?? '');
  const [note, setNote] = useState(tag.note ?? '');
  // A save lands on the server's copy; start the fields from it again.
  useEffect(() => {
    setName(tag.name ?? '');
    setNote(tag.note ?? '');
  }, [tag.name, tag.note]);

  const edited = tagTextOrNull(name) !== tag.name || tagTextOrNull(note) !== tag.note;

  const handleSave = () =>
    updateTag.mutate(
      { tagId: tag.id, updates: { name: tagTextOrNull(name), note: tagTextOrNull(note) } },
      {
        onSuccess: () => addToast('Saved.', 'success'),
        onError: () => addToast("Couldn't save your changes. Try again.", 'error'),
      },
    );

  const handleToggle = () =>
    toggleActive.mutate(tag.id, {
      onError: () =>
        addToast(`Couldn't ${tag.active ? 'deactivate' : 'activate'} the tag. It's back as it was.`, 'error'),
    });

  const handleDelete = () => {
    const confirm = deleteTagConfirm(tag);
    Alert.alert(confirm.title, confirm.body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: confirm.confirm,
        style: 'destructive',
        onPress: () =>
          deleteTag.mutate(tag.id, {
            onSuccess: onDeleted,
            onError: () => addToast("Couldn't delete the tag. It's still there.", 'error'),
          }),
      },
    ]);
  };

  const url = buildTagUrl(tag.shortCode);

  return (
    <KeyboardAvoider style={styles.fill}>
      <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.top}>
          <View style={styles.labels}>
            <MonoLabel color="textMid">{`${TAG_TYPE_LABEL[tag.tagType]} Tag`}</MonoLabel>
            {tag.active ? null : <InactiveBadge />}
          </View>

          {tag.tagType === 'physical' ? (
            <>
              <View style={styles.qr}>
                <TagQRCode shortCode={tag.shortCode} size={200} />
              </View>
              <Button fullWidth onPress={onExport} style={styles.primaryAction}>
                Export QR code
              </Button>
            </>
          ) : (
            <>
              <Text style={styles.link} selectable accessibilityLabel={`Tag link, ${url}`}>
                {url}
              </Text>
              <View style={styles.linkActions}>
                <Button
                  variant="outline"
                  onPress={() => void shareTagLink(tag.shortCode).catch(() => undefined)}
                  style={styles.linkAction}
                >
                  Share link
                </Button>
                <Button
                  variant="outline"
                  onPress={() =>
                    copyTagLink(tag.shortCode).then(
                      () => addToast('Link copied.', 'success'),
                      () => addToast("Couldn't copy the link.", 'error'),
                    )
                  }
                  style={styles.linkAction}
                >
                  Copy link
                </Button>
              </View>
            </>
          )}
        </View>

        <SettingsSection title="Status">
          <SettingsRow
            title="Active"
            subtitle={
              tag.active
                ? 'Scanning or opening it goes to its destination.'
                : 'It shows as no longer active. Turn it back on at any time.'
            }
            control={<TagActiveSwitch active={tag.active} onToggle={handleToggle} tagName={tagTitle(tag)} />}
          />
        </SettingsSection>

        {/* Shown, never editable: see the screen's comment. */}
        <SettingsSection title="Tag">
          <SettingsRow title="Short code" control={<Text style={styles.code}>{tag.shortCode}</Text>} divider />
          <SettingsRow
            title="Destination"
            subtitle={destinationLabel(tag.destination)}
            onPress={onOpenDestination}
            divider
          />
          <SettingsRow title="Scans" subtitle={scanSummary(tag)} />
        </SettingsSection>

        <SettingsSection title="Details">
          <View style={styles.fields}>
            <TextField
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="Optional"
              maxLength={TAG_NAME_MAX_LENGTH}
              accessibilityLabel="Name"
            />
            <TextField
              label="Note"
              value={note}
              onChangeText={setNote}
              placeholder="Optional. Only you see this."
              multiline
              maxLength={TAG_NOTE_MAX_LENGTH}
              inputStyle={styles.note}
              accessibilityLabel="Note"
            />
            <Button onPress={handleSave} disabled={!edited} loading={updateTag.isPending}>
              Save changes
            </Button>
          </View>
        </SettingsSection>

        <SettingsSection>
          {tag.tagType === 'physical' ? (
            <SettingsRow
              title="Create a replacement"
              subtitle="A new tag with the same destination, for one that's lost or damaged. This one stays until you deactivate it."
              onPress={onReplace}
              divider
            />
          ) : null}
          <SettingsRow
            title="Delete tag"
            subtitle="Permanently. Anything carrying its code stops working for everyone."
            destructive
            onPress={handleDelete}
          />
        </SettingsSection>
      </ScrollView>
    </KeyboardAvoider>
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
  content: {
    paddingBottom: space.xxl,
    backgroundColor: color.bgSub,
    flexGrow: 1,
  },
  top: {
    padding: space.lg,
    backgroundColor: color.bg,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  labels: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  qr: {
    marginTop: space.lg,
    alignItems: 'center',
  },
  primaryAction: {
    marginTop: space.lg,
  },
  link: {
    marginTop: space.lg,
    padding: space.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.bgSub,
    fontFamily: type.mono,
    fontSize: 14,
    color: color.text,
  },
  linkActions: {
    marginTop: space.md,
    flexDirection: 'row',
    gap: space.sm,
  },
  linkAction: {
    flex: 1,
  },
  code: {
    fontFamily: type.mono,
    fontSize: 15,
    letterSpacing: 1,
    color: color.text,
  },
  fields: {
    padding: space.lg,
    gap: space.lg,
    backgroundColor: color.bg,
  },
  note: {
    minHeight: 90,
  },
});
