// Pure logic for Scan History (ONE-35): where an entry routes, how it reads,
// and what turning the history public says. Kept out of the screens so it is
// tested without mounting anything.

import type { ScanHistoryEntry } from '../../features/scans';
import type { TagDestination } from '../../features/tags';
import { routeForDestination } from './tagResolution';
import { getTimeAgo } from '../timeAgo';

export const SCAN_DESTINATION_LABEL: Record<ScanHistoryEntry['kind'], string> = {
  profile: 'Profile',
  product: 'Product',
  project: 'Project',
};

/**
 * An entry's destination, in the terms Tag Resolution routes by — so a
 * history row goes exactly where scanning the tag again would.
 *
 * A profile entry needs its handle to route by; one whose profile is gone has
 * none, and shows without routing anywhere.
 */
export const destinationOfEntry = (entry: ScanHistoryEntry): TagDestination | null => {
  if (entry.kind === 'profile') {
    return entry.username ? { kind: 'profile', profileId: entry.destinationId, username: entry.username } : null;
  }
  if (entry.kind === 'product') return { kind: 'product', productId: entry.destinationId };
  return { kind: 'project', projectId: entry.destinationId };
};

/** Where tapping an entry goes, or null when it has nowhere to go. */
export const routeForEntry = (entry: ScanHistoryEntry): string | null => {
  const destination = destinationOfEntry(entry);
  return destination ? routeForDestination(destination) : null;
};

/** "Scanned 10 times · 2h", "Scanned once · 3d". */
export const scanHistorySummary = (entry: Pick<ScanHistoryEntry, 'scanCount' | 'lastScannedAt'>): string => {
  const times = entry.scanCount === 1 ? 'Scanned once' : `Scanned ${entry.scanCount} times`;
  const when = getTimeAgo(entry.lastScannedAt);
  return when ? `${times} · ${when}` : times;
};

/** The settings row. */
export const PUBLIC_SCAN_HISTORY_LABEL = 'Public scan history';

export const publicScanHistoryDescription = (isPublic: boolean): string =>
  isPublic
    ? 'Anyone can see the tags you have scanned, on your profile.'
    : 'Only you can see the tags you have scanned.';

/**
 * Said before a history is opened, so nobody is surprised later: everything
 * already scanned becomes visible too, not only what comes next.
 */
export const MAKE_SCAN_HISTORY_PUBLIC = {
  title: 'Make your scan history public?',
  body:
    'Anyone will be able to see every tag you have scanned on your profile: all of your past scans, ' +
    'and every future one while this is on. You can turn it off at any time, and your history is ' +
    'hidden again at once.',
  confirm: 'Make public',
} as const;

export const SCAN_HISTORY_EMPTY_STATE = {
  title: 'No scans yet',
  body: 'Tags you scan with your camera show up here, with where they led.',
} as const;
