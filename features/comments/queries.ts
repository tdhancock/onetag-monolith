// Read hooks for the comments domain.

import { useQuery } from '@tanstack/react-query';
import { getCommentsForPost, getCommentLikesCount, isCommentLikedByUser } from './api';
import { commentKeys } from './keys';
import type { Comment } from './types';
import type { ProfileId } from '../../types';

/**
 * Every comment on a post.
 *
 * This replaced a `Map<postId, Comment[]>` on AppContext with a hand-rolled
 * loaded flag, plus a 209-line fetch guard that deduped in-flight requests,
 * aborted stale ones and enforced a cooldown. TanStack does all of that by
 * key: two mounts of this screen share one request, and a request for the
 * previous post cannot land on the new one because it is a different key.
 */
export const useCommentsQuery = (postId: string | undefined) =>
  useQuery<Comment[]>({
    queryKey: commentKeys.forPost(postId ?? ''),
    queryFn: () => getCommentsForPost(postId!),
    enabled: Boolean(postId),
  });

/** A comment's like count, and whether the viewer is in it. */
export interface CommentLikes {
  count: number;
  isLiked: boolean;
}

/**
 * Likes for one comment.
 *
 * Disabled for an optimistic comment that has no server id yet — there is
 * nothing to count, and the id it is holding will be replaced.
 */
export const useCommentLikesQuery = (commentId: string | undefined, viewerId: ProfileId | undefined) =>
  useQuery<CommentLikes>({
    queryKey: commentKeys.likes(commentId ?? ''),
    queryFn: async () => {
      const [count, isLiked] = await Promise.all([
        getCommentLikesCount(commentId!),
        isCommentLikedByUser(commentId!, viewerId!),
      ]);

      return { count, isLiked };
    },
    enabled: Boolean(commentId && viewerId) && !commentId!.startsWith('temp-'),
  });
