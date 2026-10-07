// The public surface of the tags domain.
//
// Screens and other features import from `features/tags`, never from a file
// inside it. See features/README.md.

export {
  resolveTag,
  recordScan,
  createEmbeddedTags,
  moveEmbeddedTag,
  TagNotFoundError,
  mapResolveTagRow,
  TagResolutionError,
  fetchMyTags,
  createTag,
  createBlankTags,
  MAX_BLANK_TAGS,
  linkTag,
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
  useCreateBlankTags,
  useLinkTag,
  useUpdateTag,
  useDeleteTag,
  useTagActiveToggle,
  activeAfterFlip,
  embeddedTagWriter,
} from './mutations';
export type { RecordScanInput, UpdateTagInput, CreateEmbeddedTagsInput, CreateBlankTagsInput, LinkTagInput } from './mutations';
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
  TagDestinationRef,
  TagUpdates,
  TagRow,
  TagScanCountRow,
} from './types';
