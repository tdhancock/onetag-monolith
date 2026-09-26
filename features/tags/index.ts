// The public surface of the tags domain.
//
// Screens and other features import from `features/tags`, never from a file
// inside it. See features/README.md.

export {
  resolveTag,
  recordScan,
  createEmbeddedTags,
  mapResolveTagRow,
  TagResolutionError,
  fetchMyTags,
  createTag,
  updateTag,
  setTagActive,
  deleteTag,
  mapTagRow,
  fetchDestinationScanCount,
  TAG_SELECT,
} from './api';
export { tagKeys } from './keys';
export { useTagQuery, useMyTagsQuery, useMyTagQuery, useDestinationScanCountQuery } from './queries';
export {
  useRecordScan,
  useCreateEmbeddedTags,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
  useTagActiveToggle,
  activeAfterFlip,
} from './mutations';
export type { RecordScanInput, UpdateTagInput, CreateEmbeddedTagsInput } from './mutations';
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
  NewEmbeddedTag,
  TagUpdates,
  TagRow,
  TagScanCountRow,
} from './types';
