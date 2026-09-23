// The only place comment query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('comments');

export const commentKeys = {
  ...base,
  /**
   * Every comment on one post.
   *
   * This key is what makes the hand-rolled fetch guard unnecessary: TanStack
   * dedupes in-flight queries by key, so two mounts of the same screen share
   * one request rather than racing and needing an abort (ONE-14).
   */
  forPost: (postId: string) => [...base.all, 'post', postId] as const,
  /** Whether the viewer liked one comment, and how many likes it has. */
  likes: (commentId: string) => [...base.all, 'likes', commentId] as const,
};
