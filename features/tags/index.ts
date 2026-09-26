// The public surface of the tags domain.
//
// Screens and other features import from `features/tags`, never from a file
// inside it. See features/README.md.

export {
  resolveTag,
  recordScan,
  mapResolveTagRow,
  TagResolutionError,
  fetchMyTags,
  createTag,
  updateTag,
  setTagActive,
  deleteTag,
  mapTagRow,
  TAG_SELECT,
} from './api';
export { tagKeys } from './keys';
export { useTagQuery, useMyTagsQuery, useMyTagQuery } from './queries';
export {
  useRecordScan,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
  useTagActiveToggle,
  activeAfterFlip,
} from './mutations';
export type { RecordScanInput, UpdateTagInput } from './mutations';
export type {
  TagDestination,
  TagDestinationKind,
  TagResolution,
  TagResolutionFailure,
  ResolveTagRow,
  TagType,
  TagFormat,
  OwnedTag,
  OwnedTagDestination,
  NewTag,
  TagUpdates,
  TagRow,
  TagScanCountRow,
} from './types';
