import React, { useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile } from '../../features/profiles';
import { useCreateBlankTags, type OwnedTag } from '../../features/tags';
import { Button, MonoLabel, Pressable } from '../../components/native/ui';
import { CheckIcon } from '../../components/native/Icons';
import TagQRCode from '../../components/native/TagQRCode';
import { saveTagSheetsToPhotos, shareTagSheet } from '../../services/tagSharing';
import { sheetsOf, SHEET_COLUMNS } from '../../lib/tagSheet';
import {
  BLANK_TAG_BATCHES,
  blankTagsReadyMessage,
  PHOTOS_DENIED_MESSAGE,
  PRINT_BLANK_TAGS_FAILED,
  PRINT_BLANK_TAGS_INTRO,
  PRINT_BLANK_TAGS_TITLE,
  sheetLabel,
  SHEETS_SAVED_MESSAGE,
  type BlankTagBatchSize,
} from '../../lib/screens/tags';
import { color, space, type } from '../../theme/tokens';

/** The preview sheet's widest, however wide the screen. */
const MAX_SHEET_PREVIEW = 360;

/**
 * Print blank tags (ONE-138): make a batch of blank Physical Tags, then get
 * them off the phone as sheets to print — twelve codes on US Letter, cut
 * along the dashed lines, stuck on things and linked one by one as each is
 * first scanned (ONE-135).
 *
 * A modal, declared in app/_layout.tsx and opened from the Tags dashboard.
 * It ends where it began: Done closes it, back to the dashboard, which
 * already lists the new tags as not linked.
 */
export default function PrintBlankTagsScreen() {
  const router = useRouter();
  const { addToast } = useApp();
  const { width } = useWindowDimensions();
  const { profileId } = useCurrentProfile();
  const createBlankTags = useCreateBlankTags();

  const [count, setCount] = useState<BlankTagBatchSize>(BLANK_TAG_BATCHES[0].count);
  const [made, setMade] = useState<OwnedTag[] | null>(null);
  const [busy, setBusy] = useState<'save' | number | null>(null);
  const [photosDenied, setPhotosDenied] = useState(false);

  const sheets = useMemo(() => (made ? sheetsOf(made.map((tag) => tag.shortCode)) : []), [made]);

  const handleCreate = () => {
    if (!profileId) return;
    createBlankTags.mutate(
      { ownerProfileId: profileId, count },
      { onSuccess: setMade, onError: () => addToast(PRINT_BLANK_TAGS_FAILED, 'error') },
    );
  };

  const handleSave = async () => {
    setBusy('save');
    try {
      // Permission is asked for here, on the tap, never on mount.
      const result = await saveTagSheetsToPhotos(sheets);
      setPhotosDenied(result === 'denied');
      if (result === 'saved') addToast(SHEETS_SAVED_MESSAGE, 'success');
    } catch {
      addToast("Couldn't save the sheets. Try again, or use Share.", 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleShare = async (index: number) => {
    setBusy(index);
    try {
      await shareTagSheet(sheets[index]!);
    } catch {
      addToast("Couldn't share the sheet.", 'error');
    } finally {
      setBusy(null);
    }
  };

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12} style={styles.headerSide}>
        <Text style={styles.headerAction}>{made ? 'Done' : 'Cancel'}</Text>
      </Pressable>
      <Text style={styles.headerTitle} accessibilityRole="header" numberOfLines={1}>
        {PRINT_BLANK_TAGS_TITLE}
      </Text>
      <View style={styles.headerSide} />
    </View>
  );

  if (!made) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.intro}>{PRINT_BLANK_TAGS_INTRO}</Text>
          <View style={styles.options} accessibilityRole="radiogroup">
            {BLANK_TAG_BATCHES.map((option) => {
              const selected = count === option.count;
              return (
                <Pressable
                  key={option.count}
                  onPress={() => setCount(option.count)}
                  style={[styles.option, selected && styles.optionSelected]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${option.label}, ${option.description}`}
                >
                  <View style={styles.optionHead}>
                    <Text style={styles.optionTitle}>{option.label}</Text>
                    {selected ? <CheckIcon color={color.text} size={20} strokeWidth={2} /> : null}
                  </View>
                  <Text style={styles.optionBody}>{option.description}</Text>
                </Pressable>
              );
            })}
          </View>
          <Button fullWidth onPress={handleCreate} loading={createBlankTags.isPending} disabled={!profileId}>
            {`Make ${count} tags`}
          </Button>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const sheetWidth = Math.min(width - space.xl * 2, MAX_SHEET_PREVIEW);
  const codeSize = Math.floor((sheetWidth - space.lg * 2 - space.sm * (SHEET_COLUMNS - 1)) / SHEET_COLUMNS);

  return (
    <SafeAreaView style={styles.screen}>
      {header}
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro} accessibilityLiveRegion="polite">
          {blankTagsReadyMessage(made.length)}
        </Text>

        <Button fullWidth onPress={() => void handleSave()} loading={busy === 'save'} disabled={busy !== null}>
          {sheets.length > 1 ? 'Save sheets to Photos' : 'Save sheet to Photos'}
        </Button>

        {photosDenied ? (
          <View style={styles.notice} accessibilityLiveRegion="polite">
            <Text style={styles.noticeText}>{PHOTOS_DENIED_MESSAGE}</Text>
            <Button size="sm" variant="outline" onPress={() => void Linking.openSettings()} style={styles.noticeAction}>
              Open Settings
            </Button>
          </View>
        ) : null}

        {sheets.map((sheet, index) => (
          <View key={sheet[0]} style={styles.sheetBlock}>
            <View style={styles.sheetHead}>
              <MonoLabel color="textMid">{sheetLabel(index, sheets.length)}</MonoLabel>
              <Button
                size="sm"
                variant="outline"
                onPress={() => void handleShare(index)}
                loading={busy === index}
                disabled={busy !== null}
                accessibilityLabel={`Share ${sheetLabel(index, sheets.length).toLowerCase()}`}
              >
                Share
              </Button>
            </View>
            <View style={[styles.sheet, { width: sheetWidth }]} accessibilityLabel={`${sheet.length} codes`}>
              {sheet.map((shortCode) => (
                <View key={shortCode} style={{ width: codeSize }}>
                  <TagQRCode shortCode={shortCode} size={codeSize} showCode={false} />
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
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
  content: {
    padding: space.xl,
    paddingBottom: space.xxl,
    gap: space.lg,
  },
  intro: {
    fontFamily: type.body,
    fontSize: 15,
    lineHeight: 22,
    color: color.textMid,
  },
  options: {
    gap: space.sm,
  },
  option: {
    padding: space.lg,
    borderWidth: 1,
    borderColor: color.border,
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
    marginTop: space.xs,
    fontFamily: type.body,
    fontSize: 14,
    color: color.textMid,
  },
  notice: {
    padding: space.lg,
    backgroundColor: color.bgPanel,
    gap: space.sm,
  },
  noticeText: {
    fontFamily: type.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.text,
  },
  noticeAction: {
    alignSelf: 'flex-start',
  },
  sheetBlock: {
    gap: space.sm,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // The page, as it prints: white, whatever the theme, with the codes in its grid.
  sheet: {
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    padding: space.lg,
    backgroundColor: color.inverse,
    borderWidth: 1,
    borderColor: color.border,
  },
});
