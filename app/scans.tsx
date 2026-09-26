import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCurrentProfile } from '../features/profiles';
import { useMyScanHistoryQuery, useProfileScanHistoryQuery, type ScanHistoryEntry } from '../features/scans';
import { EmptyState, ListRow, MonoLabel, Pressable } from '../components/native/ui';
import {
  publicScanHistoryDescription,
  routeForEntry,
  SCAN_DESTINATION_LABEL,
  SCAN_HISTORY_EMPTY_STATE,
  scanHistorySummary,
} from '../lib/screens/scanHistory';
import { color, space, type } from '../theme/tokens';

const param = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

/**
 * Scan History (ONE-35): where the Tags a profile scanned led, most recent
 * first, each destination once with how often and when last. Every row routes
 * to its destination, as scanning the tag again would.
 *
 * With no `profile` param it is the active profile's own history, whatever
 * its setting. With one, it is that profile's public history — reached only
 * from a profile that made it public; the database returns nothing otherwise.
 */
export default function ScanHistoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ profile?: string | string[]; username?: string | string[] }>();
  const { profileId, profile } = useCurrentProfile();

  const otherId = param(params.profile);
  const isOwn = !otherId || otherId === profileId;
  const username = param(params.username);

  const mine = useMyScanHistoryQuery(isOwn ? profileId : undefined);
  const theirs = useProfileScanHistoryQuery(isOwn ? undefined : otherId, !isOwn);
  const history = isOwn ? mine : theirs;

  const title = isOwn ? 'Scan history' : username ? `@${username}'s scans` : 'Scans';
  const header = <Stack.Screen options={{ headerShown: true, title }} />;

  if (history.isPending) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <ActivityIndicator style={styles.loading} color={color.textMuted} accessibilityLabel="Loading" />
      </SafeAreaView>
    );
  }

  if (history.isError) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <EmptyState
          title="Couldn't load scans"
          body="Check your connection and try again."
          action={{ label: 'Try again', onPress: () => void history.refetch() }}
        />
      </SafeAreaView>
    );
  }

  const visibility = isOwn ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${publicScanHistoryDescription(Boolean(profile.scanHistoryPublic))} Change in Settings`}
      onPress={() => router.push('/settings')}
      style={({ pressed }) => [styles.notice, pressed && styles.pressed]}
    >
      <MonoLabel color="textMid">{profile.scanHistoryPublic ? 'Public' : 'Private'}</MonoLabel>
      <Text style={styles.noticeText}>
        {publicScanHistoryDescription(Boolean(profile.scanHistoryPublic))} Change in Settings.
      </Text>
    </Pressable>
  ) : null;

  const renderItem = ({ item, index }: { item: ScanHistoryEntry; index: number }) => {
    const route = routeForEntry(item);
    return (
      <ListRow
        title={item.name}
        subtitle={`${SCAN_DESTINATION_LABEL[item.kind]} · ${scanHistorySummary(item)}`}
        divider={index < history.data.length - 1}
        onPress={route ? () => router.push(route) : undefined}
        accessibilityLabel={`${item.name}, ${SCAN_DESTINATION_LABEL[item.kind]}, ${scanHistorySummary(item)}`}
      />
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      {header}
      <FlatList
        data={history.data}
        keyExtractor={(entry) => entry.key}
        renderItem={renderItem}
        ListHeaderComponent={visibility}
        ListEmptyComponent={
          <EmptyState
            title={SCAN_HISTORY_EMPTY_STATE.title}
            body={isOwn ? SCAN_HISTORY_EMPTY_STATE.body : 'Nothing has been scanned yet.'}
          />
        }
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
  },
  loading: {
    marginTop: space.xxl,
  },
  list: {
    flexGrow: 1,
    paddingBottom: space.xxl,
  },
  notice: {
    padding: space.lg,
    gap: space.xs,
    backgroundColor: color.bgSub,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  pressed: {
    backgroundColor: color.bgPanel,
  },
  noticeText: {
    fontFamily: type.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.textMid,
  },
});
