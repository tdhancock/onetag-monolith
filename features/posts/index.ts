// The public surface of the posts domain.
//
// Screens and other features import from `features/posts`, never from a file
// inside it. See features/README.md.

export {
  toggleLike,
  toggleRepost,
  toggleSavePost,
  fetchFeedPage,
  fetchPostById,
  fetchTrendingPosts,
  nextFeedCursor,
  getFeedUserIds,
  mapPostData,
  FEED_PAGE_SIZE,
  POST_SELECT_QUERY,
} from './api';
export type { FeedCursor, FetchFeedPageArgs } from './api';

export { postKeys } from './keys';

export { useFeedQuery, usePostQuery } from './queries';

export { useLikePost, useRepostPost, useSavePost } from './mutations';
export type { PostToggle, OnToggle } from './mutations';

export { feedPosts, prependPost, replacePost, removePost } from './cache';
export type { FeedData } from './cache';

export type { Post } from './types';
