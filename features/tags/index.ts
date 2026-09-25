// The public surface of the tags domain.
//
// Screens and other features import from `features/tags`, never from a file
// inside it. See features/README.md.

export { resolveTag, recordScan, mapResolveTagRow, TagResolutionError } from './api';
export { tagKeys } from './keys';
export { useTagQuery } from './queries';
export { useRecordScan } from './mutations';
export type { RecordScanInput } from './mutations';
export type {
  TagDestination,
  TagDestinationKind,
  TagResolution,
  TagResolutionFailure,
  ResolveTagRow,
} from './types';
