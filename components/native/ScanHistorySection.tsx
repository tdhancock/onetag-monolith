import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ListRow, MonoLabel, Pressable } from './ui';
import { useProfileScanHistoryQuery } from '../../features/scans';
import {
  PROFILE_SCAN_PREVIEW,
  routeForEntry,
  SCAN_DESTINATION_LABEL,
  scanHistoryRoute,
  scanHistorySummary,
} from '../../lib/screens/scanHistory';
import { color, space } from '../../theme/tokens';

export interface ScanHistorySectionProfile {
  id: string;
  username: string;
  scanHistoryPublic?: boolean;
}

/**
 * A profile's public Scan History, on their profile screen (ONE-35): the most
 * recent destinations and a way to see all of them.
 *
 * Entirely absent unless the profile made its history public — no empty
 * section, no "private" placeholder, nothing that would confirm scans exist.
 * Nothing is fetched for a private history either.
 */
const ScanHistorySection: React.FC<{ profile: ScanHistorySectionProfile }> = ({ profile }) => {
  const router = useRouter();
  const isPublic = profile.scanHistoryPublic === true;
  const { data } = useProfileScanHistoryQuery(profile.id, isPublic);

  if (!isPublic || !data) return null;

  const preview = data.slice(0, PROFILE_SCAN_PREVIEW);

  return (
    <View style={styles.section} accessibilityLabel="Scans">
      <View style={styles.heading}>
        <MonoLabel color="textMid">Scans</MonoLabel>
        {data.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`See all of @${profile.username}'s scans`}
            onPress={() => router.push(scanHistoryRoute(profile))}
            hitSlop={8}
          >
            <MonoLabel color="text">See all</MonoLabel>
          </Pressable>
        ) : null}
      </View>
      {preview.length === 0 ? (
        <ListRow title="Nothing scanned yet" subtitle="Tags they scan show up here." leading={<View />} />
      ) : (
        preview.map((entry, index) => {
          const route = routeForEntry(entry);
          return (
            <ListRow
              key={entry.key}
              title={entry.name}
              subtitle={`${SCAN_DESTINATION_LABEL[entry.kind]} · ${scanHistorySummary(entry)}`}
              divider={index < preview.length - 1}
              onPress={route ? () => router.push(route) : undefined}
            />
          );
        })
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    borderTopWidth: 1,
    borderTopColor: color.border,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  heading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xs,
  },
});

export default ScanHistorySection;
