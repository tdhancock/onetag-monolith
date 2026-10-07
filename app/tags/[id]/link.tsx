import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../../store/AppContext.native';
import { useCurrentProfile } from '../../../features/profiles';
import { useLinkTag, useMyTagQuery } from '../../../features/tags';
import { Button, EmptyState, MonoLabel, TextField } from '../../../components/native/ui';
import KeyboardAvoider from '../../../components/native/KeyboardAvoider';
import FormScrollView from '../../../components/native/FormScrollView';
import OwnedDestinationList from '../../../components/native/OwnedDestinationList';
import { useOwnedTagDestinations } from '../../../lib/useOwnedTagDestinations';
import { routeForDestination } from '../../../lib/screens/tagResolution';
import {
  chosenDestination,
  LINK_TAG_FAILED,
  LINK_TAG_INTRO,
  LINK_TAG_NOT_BLANK,
  LINK_TAG_TITLE,
  TAG_NAME_MAX_LENGTH,
  TAGS_DASHBOARD_ROUTE,
  tagDetailRoute,
  tagTextOrNull,
  type DraftDestination,
} from '../../../lib/screens/tags';
import { color, space, type } from '../../../theme/tokens';

/**
 * Link this tag (ONE-139): point a blank Physical Tag at something the
 * account owns, once (ONE-135). Its owner arrives here by scanning it, or
 * from its row on the Tags dashboard.
 *
 * A pushed screen, not a modal: it ends by opening the destination, and a
 * screen that leads on to another is pushed. It replaces itself with the
 * destination, so Back goes to wherever linking started.
 *
 * The destinations are the create flow's own (lib/useOwnedTagDestinations.ts):
 * only what the account owns, so RLS never refuses a choice offered here.
 */
export default function LinkTagScreen() {
  const router = useRouter();
  const { addToast } = useApp();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const tagId = typeof params.id === 'string' ? params.id : '';
  const { profileId } = useCurrentProfile();
  const { data: tag, isPending, isError, refetch } = useMyTagQuery(profileId, tagId);
  const { sections, loaded } = useOwnedTagDestinations();
  const linkTag = useLinkTag(profileId);

  const [destination, setDestination] = useState<DraftDestination | null>(null);
  // Null until the owner types: the name then follows the tag's own, or the destination's.
  const [typedName, setTypedName] = useState<string | null>(null);

  const header = <Stack.Screen options={{ headerShown: true, title: LINK_TAG_TITLE }} />;

  if (isPending || (tag && !tag.linked && !loaded)) {
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

  if (tag.linked) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <EmptyState
          title={LINK_TAG_NOT_BLANK.title}
          body={LINK_TAG_NOT_BLANK.body}
          action={{ label: 'Open the tag', onPress: () => router.replace(tagDetailRoute(tag.id)) }}
        />
      </SafeAreaView>
    );
  }

  const chosenTitle = destination ? (chosenDestination(sections, destination)?.title ?? '') : '';
  const name = typedName ?? tag.name ?? chosenTitle;

  const handleLink = () => {
    if (!destination) return;
    linkTag.mutate(
      { tagId: tag.id, destination, name: tagTextOrNull(name) },
      {
        onSuccess: (linked) => {
          const route = linked.destination ? routeForDestination(linked.destination) : null;
          router.replace(route ?? tagDetailRoute(linked.id));
        },
        // The choice stays as it was, so trying again is one tap.
        onError: () => addToast(LINK_TAG_FAILED, 'error'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      {header}
      <KeyboardAvoider style={styles.fill}>
        <FormScrollView style={styles.fill} contentContainerStyle={styles.content}>
          <MonoLabel color="textMid">{`Physical · ${tag.shortCode}`}</MonoLabel>
          <Text style={styles.intro}>{LINK_TAG_INTRO}</Text>

          <OwnedDestinationList sections={sections} selected={destination} onSelect={setDestination} />

          <View style={styles.fields}>
            <TextField
              label="Name"
              value={name}
              onChangeText={setTypedName}
              placeholder="Optional, e.g. Furnace"
              maxLength={TAG_NAME_MAX_LENGTH}
              accessibilityLabel="Name"
            />
            <Button fullWidth onPress={handleLink} disabled={!destination} loading={linkTag.isPending}>
              Link tag
            </Button>
          </View>
        </FormScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
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
    padding: space.xl,
    paddingBottom: space.xxl,
  },
  intro: {
    marginTop: space.sm,
    fontFamily: type.body,
    fontSize: 15,
    lineHeight: 22,
    color: color.textMid,
  },
  fields: {
    marginTop: space.xl,
    gap: space.lg,
  },
});
