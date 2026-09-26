// Pure Supabase access for Scan History (ONE-35).
//
// No React, no hooks, nothing from another feature's internals.
//
// A scanner cannot read the tags they scanned — tags are owner-only (ONE-82)
// — so a history is read through `scan_history`, which returns where each
// tag led and nothing of the tag itself. It answers only for a history the
// caller may read: their own, or one its profile made public. The database
// decides; nothing here filters.

import { supabase } from '../../services/supabase.native';
import type { ScanHistoryEntry, ScanHistoryRow } from './types';

/** A `scan_history` row as a history entry. */
export const mapScanHistoryRow = (row: ScanHistoryRow): ScanHistoryEntry => ({
  key: `${row.dest_kind}:${row.dest_id}`,
  kind: row.dest_kind,
  destinationId: row.dest_id,
  name: row.dest_name || row.dest_username || 'Unnamed',
  username: row.dest_username,
  scanCount: Number(row.scan_count) || 0,
  lastScannedAt: row.last_scanned_at,
});

/**
 * A profile's scan history, most recently scanned first — or nothing, if the
 * caller may not read it. An empty result never says which.
 */
export const fetchScanHistory = async (profileId: string): Promise<ScanHistoryEntry[]> => {
  const { data, error } = await supabase.rpc('scan_history', { p_profile_id: profileId });
  if (error) throw error;
  return ((data ?? []) as ScanHistoryRow[]).map(mapScanHistoryRow);
};
