// Domain types for Scan History (ONE-35).
//
// A profile's Scan History is where the Tags it scanned led, and how often.
// It is private unless its profile opts in. Each entry is one destination:
// repeats collapse into a count and a latest time — the display, not the data.

/** What kind of Destination a scanned tag led to. */
export type ScanDestinationKind = 'profile' | 'product' | 'project';

/** One destination in a history, with how often and when it was last scanned. */
export interface ScanHistoryEntry {
  /** Stable across refetches: the destination's kind and id. */
  key: string;
  kind: ScanDestinationKind;
  destinationId: string;
  name: string;
  /** A profile destination's handle, to route by. Null for other kinds. */
  username: string | null;
  scanCount: number;
  lastScannedAt: string;
}

/** A row of `public.scan_history(p_profile_id)`. */
export interface ScanHistoryRow {
  dest_kind: ScanDestinationKind;
  dest_id: string;
  dest_name: string | null;
  dest_username: string | null;
  scan_count: number | string;
  last_scanned_at: string;
}
