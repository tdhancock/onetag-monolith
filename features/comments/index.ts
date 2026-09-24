// The public surface of the comments domain.
//
// Screens and other features import from `features/comments`, never from a
// file inside it. See features/README.md.

export {
  getCommentsForPost,
  addComment,
  deleteComment,
  isCommentLikedByUser,
  getCommentLikesCount,
  toggleCommentLike,
} from './api';

export { commentKeys } from './keys';

export { useCommentsQuery, useCommentLikesQuery } from './queries';
export type { CommentLikes } from './queries';

export { useAddComment, useDeleteComment, useToggleCommentLike } from './mutations';
export type { AddCommentVariables, DeleteCommentVariables, CommentLikeToggle } from './mutations';

export type { Comment } from './types';
