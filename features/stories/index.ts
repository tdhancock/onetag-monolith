// The public surface of the stories (OneSnaps) domain.
//
// Screens and other features import from `features/stories`, never from a
// file inside it. See features/README.md.

export {
  getStories,
  getMyStories,
  getStoryById,
  uploadStory,
  deleteStoryFromDatabase,
  fetchLikedStoryIds,
  toggleStoryLikeInDatabase,
  recordStoryView,
  getStoryViewCount,
  getStoryViewers,
  isLive,
  STORY_LIFETIME_MS,
} from './api';

export { storyKeys } from './keys';

export {
  useStoriesQuery,
  useMyStoriesQuery,
  useStoryQuery,
  useStoryViewersQuery,
  useStoryViewCountQuery,
  useLikedStoryIdsQuery,
  useIsStoryLiked,
  hasUnviewedStory,
} from './queries';

export {
  useUploadStory,
  useDeleteStory,
  useToggleStoryLike,
  useRecordStoryView,
  useReplyToStory,
  isLocalStory,
} from './mutations';
export type { StoryLikeToggle, ReplyToStoryInput } from './mutations';

export { useStoriesRealtime, removeStoryFromLists } from './realtime';

export type { Story, StoryViewer, StoryAuthor, UploadStoryInput } from './types';
