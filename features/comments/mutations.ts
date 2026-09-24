// Write hooks for the comments domain.
//
// Adding and deleting are optimistic, and both move the post's `replies`
// count wherever that post is cached — the feed's infinite pages and its own
// detail entry — using the same reach the toggle helper established. A
// comment that appears instantly beside a reply count that only catches up on
// the next refetch is the kind of small wrongness this migration is for.
//
// Liking a comment is a boolean-and-count toggle, so it is a configuration of
// `lib/optimisticToggle.ts` rather than a fourth rollback.

import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { addComment, deleteComment, toggleCommentLike } from './api';
import { commentKeys } from './keys';
import type { Comment } from './types';
import type { CommentLikes } from './queries';
import { postKeys, type Post } from '../posts';
import { patchLists, useOptimisticToggle } from '../../lib/optimisticToggle';

/**
 * Move a post's reply count everywhere it is cached.
 *
 * Returns nothing: the callers undo it by calling again with the opposite
 * delta, which keeps the correction in the same shape as the change.
 */
const moveReplyCount = (queryClient: QueryClient, postId: string, delta: number): void => {
  const bump = (post: Post): Post => ({ ...post, replies: Math.max(0, post.replies + delta) });

  queryClient.setQueryData<Post>(postKeys.detail(postId), (post) => (post ? bump(post) : post));

  for (const [key] of queryClient.getQueriesData({ queryKey: postKeys.all })) {
    queryClient.setQueryData(key, (data: unknown) =>
      patchLists<Post>(data, postId, (post) => post.id, bump),
    );
  }
};

/** A comment the user has just written, before the server has seen it. */
const optimisticComment = (
  text: string,
  author: { id?: string; username: string; avatar?: string | null },
): Comment => ({
  id: `temp-${Date.now()}`,
  userId: author.id ?? '',
  username: author.username,
  avatar: author.avatar ?? null,
  text,
  timestamp: new Date(),
  likes: 0,
  isLiked: false,
  replies: [],
} as unknown as Comment);

export interface AddCommentVariables {
  postId: string;
  text: string;
  author: { id?: string; username: string; avatar?: string | null };
}

/**
 * Post a comment.
 *
 * The comment appears immediately with a temporary id and the reply count
 * moves with it; on success the server row replaces the placeholder, and on
 * failure both are taken back.
 */
export const useAddComment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ postId, text, author }: AddCommentVariables) => {
      if (!author.id) throw new Error('You must be signed in to comment.');
      return addComment(postId, author.id, text);
    },

    onMutate: async ({ postId, text, author }: AddCommentVariables) => {
      const listKey = commentKeys.forPost(postId);
      await queryClient.cancelQueries({ queryKey: listKey });

      const previous = queryClient.getQueryData<Comment[]>(listKey);
      const pending = optimisticComment(text, author);

      queryClient.setQueryData<Comment[]>(listKey, (comments) => [pending, ...(comments ?? [])]);
      moveReplyCount(queryClient, postId, 1);

      return { previous, pendingId: pending.id };
    },

    onError: (_error, { postId }, context) => {
      if (!context) return;

      queryClient.setQueryData(commentKeys.forPost(postId), context.previous);
      moveReplyCount(queryClient, postId, -1);
    },

    onSettled: (_data, _error, { postId }) => {
      // Replaces the placeholder with the stored row, timestamps and all.
      queryClient.invalidateQueries({ queryKey: commentKeys.forPost(postId) });
    },
  });
};

export interface DeleteCommentVariables {
  postId: string;
  commentId: string;
}

/** Remove a comment, optimistically. */
export const useDeleteComment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ commentId }: DeleteCommentVariables) => {
      // A comment that never reached the server has nothing to delete; it is
      // dropped from the cache by onMutate and that is the whole operation.
      if (commentId.startsWith('temp-')) return Promise.resolve();
      return deleteComment(commentId);
    },

    onMutate: async ({ postId, commentId }: DeleteCommentVariables) => {
      const listKey = commentKeys.forPost(postId);
      await queryClient.cancelQueries({ queryKey: listKey });

      const previous = queryClient.getQueryData<Comment[]>(listKey);
      const existed = Boolean(previous?.some((comment) => comment.id === commentId));

      queryClient.setQueryData<Comment[]>(listKey, (comments) =>
        (comments ?? []).filter((comment) => comment.id !== commentId),
      );

      if (existed) moveReplyCount(queryClient, postId, -1);

      return { previous, existed };
    },

    onError: (_error, { postId }, context) => {
      if (!context) return;

      queryClient.setQueryData(commentKeys.forPost(postId), context.previous);
      if (context.existed) moveReplyCount(queryClient, postId, 1);
    },

    onSettled: (_data, _error, { postId }) => {
      queryClient.invalidateQueries({ queryKey: commentKeys.forPost(postId) });
    },
  });
};

export interface CommentLikeToggle {
  toggle: (commentId: string) => void;
  isPending: boolean;
}

/**
 * Like or unlike a comment.
 *
 * A configuration of the shared helper: the entity is the comment's own
 * likes entry, `isOn` is the boolean on it and `count` the number beside it.
 * The helper also replaces the hand-rolled double-tap guard the comments
 * screen used to keep: a second tap while the first is in flight is gated by
 * the mutation's own pending state.
 */
export const useToggleCommentLike = (onHaptic?: () => void): CommentLikeToggle => {
  const mutation = useOptimisticToggle<CommentLikes>({
    mutationFn: (commentId) => toggleCommentLike(commentId),
    entityKey: (commentId) => commentKeys.likes(commentId),
    listKey: commentKeys.all,
    entityId: () => '',
    isOn: (likes) => likes.isLiked,
    count: (likes) => likes.count,
    apply: (likes, next) => ({ isLiked: next.isOn, count: next.count }),
    onToggle: () => onHaptic?.(),
  });

  const { mutate, isPending } = mutation;

  return {
    toggle: useCallback(
      (commentId: string) => {
        // Nothing to like until the server has given it an id.
        if (!commentId || commentId.startsWith('temp-') || isPending) return;
        mutate(commentId);
      },
      [mutate, isPending],
    ),
    isPending,
  };
};
