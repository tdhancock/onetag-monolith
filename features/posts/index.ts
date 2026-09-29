// The public surface of the posts domain.
//
// Screens and other features import from `features/posts`, never from a file
// inside it. See features/README.md.

export {
  toggleLike,
  toggleRepost,
  publishPost,
  updatePost,
  deletePost,
  adminDeletePost,
  fetchFeedPage,
  fetchPostById,
  nextFeedCursor,
  mapPostData,
  getPostLikers,
  getPostReposters,
  FEED_PAGE_SIZE,
  POST_SELECT_QUERY,
} from './api';
export type { FeedCursor, FetchFeedPageArgs } from './api';

export { postKeys } from './keys';

export {
  useFeedQuery,
  useNewestFeedPostQuery,
  usePostQuery,
  usePostLikersQuery,
  usePostRepostersQuery,
  NEW_POSTS_CHECK_MS,
} from './queries';

export {
  useLikePost,
  useRepostPost,
  useSavePost,
  useCreatePost,
  useUpdatePost,
  useDeletePost,
} from './mutations';
export type { PostToggle, OnToggle } from './mutations';

export { feedPosts, findCachedPost, prependPost, replacePost, removePost } from './cache';
export type { FeedData } from './cache';

export type { Post } from './types';
