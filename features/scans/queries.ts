// Read hooks for Scan History (ONE-35).

import { useQuery } from '@tanstack/react-query';
import { fetchScanHistory } from './api';
import { scanKeys } from './keys';
import type { ScanHistoryEntry } from './types';

/**
 * The active profile's own scan history, whatever its setting. Keyed by the
 * profile, so a profile switch reads the other's.
 */
export const useMyScanHistoryQuery = (profileId: string | undefined) =>
  useQuery<ScanHistoryEntry[]>({
    queryKey: scanKeys.history(profileId ?? ''),
    queryFn: () => fetchScanHistory(profileId!),
    enabled: Boolean(profileId),
  });

/**
 * Someone's public scan history. Asked for only when their profile says it is
 * public: for a private one there is nothing to show — not an empty list, not
 * a placeholder — so there is nothing to fetch. The database refuses a
 * private history either way.
 */
export const useProfileScanHistoryQuery = (profileId: string | undefined, isPublic: boolean) =>
  useQuery<ScanHistoryEntry[]>({
    queryKey: scanKeys.history(profileId ?? ''),
    queryFn: () => fetchScanHistory(profileId!),
    enabled: Boolean(profileId) && isPublic,
  });
