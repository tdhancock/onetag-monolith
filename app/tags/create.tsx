import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile, useMyProfilesQuery } from '../../features/profiles';
import { useCreateTag, type OwnedTag } from '../../features/tags';
import { Button, Card, ListRow, MonoLabel, TextField } from '../../components/native/ui';
import { CheckIcon } from '../../components/native/Icons';
import KeyboardAvoider from '../../components/native/KeyboardAvoider';
import TagQRCode from '../../components/native/TagQRCode';
import { copyTagLink, shareTagLink } from '../../services/tagSharing';
import { buildTagUrl } from '../../lib/tagLinks';
import {
  canContinue,
  chosenDestination,
  CREATABLE_TAG_TYPES,
  CREATE_TAG_FAILED,
  destinationSections,
  EMPTY_TAG_DRAFT,
  initialTagCreate,
  newTagFromDraft,
  nextStep,
  previousStep,
  stepIndex,
  stepProgressLabel,
  TAG_CREATE_STEPS,
  TAG_CREATE_STEP_TITLE,
  TAG_NAME_MAX_LENGTH,
  TAG_NOTE_MAX_LENGTH,
  TAG_TYPE_LABEL,
  tagExportRoute,
  tagTitle,
  type TagCreateStep,
  type TagDraft,
} from '../../lib/screens/tags';
import { color, space, type } from '../../theme/tokens';

const param = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * Create a Physical or Digital Tag (ONE-32): choose its type, choose its
 * Destination, name it, confirm. One flow for both kinds, branching only at
 * the end — a Physical Tag hands off to its QR export, a Digital one to its
 * link.
 *
 * A modal, declared in app/_layout.tsx. Reached from the Tags dashboard and a
 * business profile's own view; "Create a replacement" on a Physical Tag opens
 * it with the type and destination already chosen.
 *
 * Every step's answer lives in one draft, so Back and Continue move through
 * the steps without losing anything, and a failed create is retried as is.
 */
export default function CreateTagScreen() {
  const router = useRouter();
  const { addToast } = useApp();
  const params = useLocalSearchParams<{ type?: string | string[]; destination?: string | string[] }>();
  const { profileId, authUserId } = useCurrentProfile();
  const { data: profiles } = useMyProfilesQuery(authUserId);
  const createTag = useCreateTag();

  // Only the account's own profiles: a destination RLS would refuse is never offered.
  const sections = useMemo(() => destinationSections(profiles ?? []), [profiles]);

  const [draft, setDraft] = useState<TagDraft>(EMPTY_TAG_DRAFT);
  const [step, setStep] = useState<TagCreateStep>('type');
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [created, setCreated] = useState<OwnedTag | null>(null);

  // Apply a replacement's pre-fill once the account's profiles are known, so
  // a destination it doesn't own is dropped rather than offered.
  const prefillType = param(params.type);
  const prefillDestination = param(params.destination);
  useEffect(() => {
    if (started || !profiles) return;
    const initial = initialTagCreate({ type: prefillType, destination: prefillDestination }, sections);
    setDraft(initial.draft);
    setStep(initial.step);
    setStarted(true);
  }, [started, profiles, sections, prefillType, prefillDestination]);

  const update = (patch: Partial<TagDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const handleCreate = async () => {
    const newTag = profileId ? newTagFromDraft(draft, profileId) : null;
    if (!newTag || createTag.isPending) return;
    setFailed(false);
    try {
      setCreated(await createTag.mutateAsync(newTag));
    } catch {
      // The draft is untouched: Create again sends the same tag.
      setFailed(true);
      addToast(CREATE_TAG_FAILED, 'error');
    }
  };

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12} style={styles.headerSide}>
        <Text style={styles.headerAction}>{created ? 'Done' : 'Cancel'}</Text>
      </Pressable>
      <Text style={styles.headerTitle} accessibilityRole="header" numberOfLines={1}>
        {created ? 'Tag created' : 'New tag'}
      </Text>
      <View style={styles.headerSide} />
    </View>
  );

  if (created) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <CreatedTag
          tag={created}
          onExport={() => router.replace(tagExportRoute(created.id))}
          onCopy={() =>
            copyTagLink(created.shortCode).then(
              () => addToast('Link copied.', 'success'),
              () => addToast("Couldn't copy the link.", 'error'),
            )
          }
          onShare={() => void shareTagLink(created.shortCode).catch(() => undefined)}
          onDone={() => router.back()}
        />
      </SafeAreaView>
    );
  }

  if (!started) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <ActivityIndicator style={styles.loading} color={color.textMuted} accessibilityLabel="Loading" />
      </SafeAreaView>
    );
  }

  const back = previousStep(step);
  const next = nextStep(step);
  const ready = canContinue(step, draft, sections);

  return (
    <SafeAreaView style={styles.screen}>
      {header}
      <Progress step={step} />

      <KeyboardAvoider style={styles.fill}>
        <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
          <Text style={styles.stepTitle} accessibilityRole="header">
            {TAG_CREATE_STEP_TITLE[step]}
          </Text>

          {step === 'type' ? (
            <View style={styles.options} accessibilityRole="radiogroup">
              {CREATABLE_TAG_TYPES.map((option) => {
                const selected = draft.tagType === option.type;
                return (
                  <Card
                    key={option.type}
                    onPress={() => update({ tagType: option.type })}
                    style={[styles.option, selected && styles.optionSelected]}
                  >
                    <View style={styles.optionHead}>
                      <Text style={styles.optionTitle}>{option.label}</Text>
                      {selected ? <CheckIcon color={color.text} size={20} strokeWidth={2} /> : null}
                    </View>
                    <Text style={styles.optionBody}>{option.description}</Text>
                  </Card>
                );
              })}
            </View>
          ) : null}

          {step === 'destination' ? (
            <View style={styles.sections}>
              {sections.map((section) => (
                <View key={section.kind}>
                  <MonoLabel color="textMid" style={styles.sectionTitle}>
                    {section.title}
                  </MonoLabel>
                  {section.options.map((option, index) => {
                    const selected =
                      draft.destination?.kind === option.destination.kind &&
                      draft.destination.id === option.destination.id;
                    return (
                      <ListRow
                        key={option.destination.id}
                        title={option.title}
                        subtitle={option.subtitle}
                        avatarUri={option.avatarUri}
                        divider={index < section.options.length - 1}
                        onPress={() => update({ destination: option.destination })}
                        accessibilityLabel={`${option.title}${selected ? ', selected' : ''}`}
                        trailing={selected ? <CheckIcon color={color.text} size={20} strokeWidth={2} /> : null}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          ) : null}

          {step === 'details' ? (
            <View style={styles.fields}>
              <TextField
                label="Name"
                value={draft.name}
                onChangeText={(name) => update({ name })}
                placeholder="Optional, e.g. Front door"
                maxLength={TAG_NAME_MAX_LENGTH}
                accessibilityLabel="Name"
              />
              <TextField
                label="Note"
                value={draft.note}
                onChangeText={(note) => update({ note })}
                placeholder="Optional. Only you see this."
                multiline
                maxLength={TAG_NOTE_MAX_LENGTH}
                inputStyle={styles.note}
                accessibilityLabel="Note"
              />
            </View>
          ) : null}

          {step === 'confirm' ? (
            <Summary draft={draft} destination={chosenDestination(sections, draft.destination)?.title ?? ''} />
          ) : null}

          {step === 'confirm' && createTag.isPending ? (
            // No short code until the row comes back: it is the database's to issue.
            <Text style={styles.pending} accessibilityLiveRegion="polite">
              Creating your tag. Its code is issued once it is saved.
            </Text>
          ) : null}
          {step === 'confirm' && failed && !createTag.isPending ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {CREATE_TAG_FAILED}
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          {back ? (
            <Button variant="outline" onPress={() => setStep(back)} disabled={createTag.isPending} style={styles.footerButton}>
              Back
            </Button>
          ) : null}
          {next ? (
            <Button onPress={() => setStep(next)} disabled={!ready} style={styles.footerButton}>
              Continue
            </Button>
          ) : (
            <Button
              onPress={handleCreate}
              loading={createTag.isPending}
              disabled={!ready || !profileId}
              style={styles.footerButton}
            >
              {failed ? 'Try again' : 'Create tag'}
            </Button>
          )}
        </View>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

/** Where the flow is: one segment per step, and the step in words. */
function Progress({ step }: { step: TagCreateStep }) {
  const current = stepIndex(step);
  return (
    <View style={styles.progress} accessible accessibilityLabel={stepProgressLabel(step)}>
      <View style={styles.segments}>
        {TAG_CREATE_STEPS.map((s, i) => (
          <View key={s} style={[styles.segment, i <= current && styles.segmentDone]} />
        ))}
      </View>
      <MonoLabel color="textMuted">{stepProgressLabel(step)}</MonoLabel>
    </View>
  );
}

/** The confirm step: everything the tag will be, before it is written. */
function Summary({ draft, destination }: { draft: TagDraft; destination: string }) {
  const rows: [string, string][] = [
    ['Type', draft.tagType ? `${TAG_TYPE_LABEL[draft.tagType]} Tag` : ''],
    ['Destination', destination],
    ['Name', draft.name.trim() || 'None'],
    ['Note', draft.note.trim() || 'None'],
  ];
  return (
    <View style={styles.summary}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.summaryRow}>
          <MonoLabel color="textMuted">{label}</MonoLabel>
          <Text style={styles.summaryValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The end of the flow, where the two kinds part: a Physical Tag shows its QR
 * and the way to export it, a Digital Tag its link with copy and share.
 */
function CreatedTag({
  tag,
  onExport,
  onCopy,
  onShare,
  onDone,
}: {
  tag: OwnedTag;
  onExport: () => void;
  onCopy: () => void;
  onShare: () => void;
  onDone: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <MonoLabel color="textMid">{`${TAG_TYPE_LABEL[tag.tagType]} Tag · ${tag.shortCode}`}</MonoLabel>
      <Text style={styles.stepTitle}>{tagTitle(tag)}</Text>

      {tag.tagType === 'physical' ? (
        <>
          <View style={styles.qr}>
            <TagQRCode shortCode={tag.shortCode} size={220} />
          </View>
          <Text style={styles.body}>Export it at print resolution to save it to Photos or share it.</Text>
          <View style={styles.actions}>
            <Button fullWidth onPress={onExport}>
              Export QR code
            </Button>
            <Button fullWidth variant="outline" onPress={onDone}>
              Done
            </Button>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.link} selectable accessibilityLabel={`Tag link, ${buildTagUrl(tag.shortCode)}`}>
            {buildTagUrl(tag.shortCode)}
          </Text>
          <Text style={styles.body}>Share it wherever you like. Whoever opens it lands on this tag's destination.</Text>
          <View style={styles.actions}>
            <Button fullWidth onPress={onShare}>
              Share link
            </Button>
            <Button fullWidth variant="outline" onPress={onCopy}>
              Copy link
            </Button>
            <Button fullWidth variant="outline" onPress={onDone}>
              Done
            </Button>
          </View>
        </>
      )}
    </ScrollView>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  headerSide: {
    minWidth: 64,
  },
  headerAction: {
    fontFamily: type.body,
    fontSize: 16,
    color: color.text,
  },
  headerTitle: {
    flexShrink: 1,
    fontFamily: type.bodyBold,
    fontSize: 17,
    color: color.text,
  },
  loading: {
    marginTop: space.xxl,
  },
  progress: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.sm,
  },
  segments: {
    flexDirection: 'row',
    gap: space.xs,
  },
  segment: {
    flex: 1,
    height: 2,
    backgroundColor: color.border,
  },
  segmentDone: {
    backgroundColor: color.text,
  },
  scroll: {
    padding: space.lg,
    paddingBottom: space.xxl,
  },
  stepTitle: {
    marginTop: space.xs,
    fontFamily: type.bodyBold,
    fontSize: 22,
    lineHeight: 28,
    color: color.text,
  },
  options: {
    marginTop: space.lg,
    gap: space.md,
  },
  option: {
    gap: space.xs,
  },
  optionSelected: {
    borderColor: color.text,
  },
  optionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionTitle: {
    fontFamily: type.bodyBold,
    fontSize: 16,
    color: color.text,
  },
  optionBody: {
    fontFamily: type.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.textMid,
  },
  sections: {
    marginTop: space.lg,
    gap: space.lg,
  },
  sectionTitle: {
    marginBottom: space.xs,
  },
  fields: {
    marginTop: space.lg,
    gap: space.lg,
  },
  note: {
    minHeight: 90,
  },
  summary: {
    marginTop: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  summaryRow: {
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    gap: space.xs,
  },
  summaryValue: {
    fontFamily: type.body,
    fontSize: 15,
    color: color.text,
  },
  pending: {
    marginTop: space.lg,
    fontFamily: type.body,
    fontSize: 14,
    color: color.textMid,
  },
  error: {
    marginTop: space.lg,
    fontFamily: type.bodyMedium,
    fontSize: 14,
    color: color.text,
  },
  footer: {
    flexDirection: 'row',
    gap: space.sm,
    padding: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  footerButton: {
    flex: 1,
  },
  qr: {
    marginTop: space.xl,
    alignItems: 'center',
  },
  body: {
    marginTop: space.lg,
    fontFamily: type.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.textMid,
  },
  link: {
    marginTop: space.xl,
    padding: space.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.bgSub,
    fontFamily: type.mono,
    fontSize: 14,
    color: color.text,
  },
  actions: {
    marginTop: space.xl,
    gap: space.md,
  },
});
