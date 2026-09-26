// The public surface of the scans domain (ONE-35).
//
// Screens and other features import from `features/scans`, never from a file
// inside it. See features/README.md. Recording a scan stays with Tag
// Resolution in features/tags.

export { fetchScanHistory, mapScanHistoryRow } from './api';
export { scanKeys } from './keys';
export { useMyScanHistoryQuery, useProfileScanHistoryQuery } from './queries';
export type { ScanDestinationKind, ScanHistoryEntry, ScanHistoryRow } from './types';
