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
import { addToThreads, findInThreads, patchInThreads, removeFromThreads } from './thread';
import type { Comment } from './types';
import { postKeys, type Post } from '../posts';
import { patchLists, useOptimisticToggle } from '../../lib/optimisticToggle';
import type { ProfileId } from '../../types';

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
  author: CommentAuthor,
  parentId: string | null,
): Comment => ({
  id: `temp-${Date.now()}`,
  userId: author.id ?? '',
  username: author.username,
  avatar: author.avatar ?? null,
  text,
  timestamp: new Date(),
  likes: 0,
  isLiked: false,
  parentId,
  replies: [],
} as unknown as Comment);

/** Who is commenting: the profile being acted as, and what to show for it. */
export interface CommentAuthor {
  id?: ProfileId;
  username: string;
  avatar?: string | null;
}

export interface AddCommentVariables {
  postId: string;
  text: string;
  author: CommentAuthor;
  /** The comment this replies to: the opening comment of its thread. */
  parentId?: string | null;
}

/**
 * Post a comment, or a reply to one.
 *
 * The comment appears immediately with a temporary id — a new thread at the
 * top, or a reply at the foot of its thread — and the post's comment count
 * moves with it; on success the server row replaces the placeholder, and on
 * failure both are taken back.
 */
export const useAddComment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ postId, text, author, parentId }: AddCommentVariables) => {
      if (!author.id) throw new Error('You must be signed in to comment.');
      return addComment(postId, author.id, text, parentId);
    },

    onMutate: async ({ postId, text, author, parentId }: AddCommentVariables) => {
      const listKey = commentKeys.forPost(postId);
      await queryClient.cancelQueries({ queryKey: listKey });

      const previous = queryClient.getQueryData<Comment[]>(listKey);
      const pending = optimisticComment(text, author, parentId ?? null);

      queryClient.setQueryData<Comment[]>(listKey, (comments) => addToThreads(comments ?? [], pending, parentId));
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

/**
 * Remove a comment, optimistically. Removing the comment a thread opens with
 * removes its replies too, as the database does, and the post's count drops
 * by all of them.
 */
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
      const { threads, removed } = removeFromThreads(previous ?? [], commentId);

      queryClient.setQueryData<Comment[]>(listKey, threads);
      if (removed > 0) moveReplyCount(queryClient, postId, -removed);

      return { previous, removed };
    },

    onError: (_error, { postId }, context) => {
      if (!context) return;

      queryClient.setQueryData(commentKeys.forPost(postId), context.previous);
      if (context.removed > 0) moveReplyCount(queryClient, postId, context.removed);
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
 * A configuration of the shared helper. The comment lives in its post's
 * comment list, as threads, which is where its like and count are read from
 * and flipped: `isLiked` and `likes` on the comment. The list is refetched
 * once the server answers, one request, where each row used to read and
 * refetch its own likes. The helper also replaces the hand-rolled
 * double-tap guard the comments screen used to keep: a second tap while the
 * first is in flight is gated by the mutation's own pending state.
 */
export const useToggleCommentLike = (
  viewerId: ProfileId | undefined,
  onHaptic?: () => void,
): CommentLikeToggle => {
  const mutation = useOptimisticToggle<Comment>({
    mutationFn: (commentId) => {
      if (!viewerId) return Promise.reject(new Error('You must be signed in to like a comment.'));
      return toggleCommentLike(commentId, viewerId);
    },
    // A comment has no entry of its own; it's patched in the lists.
    entityKey: (commentId) => commentKeys.likes(commentId),
    listKey: commentKeys.posts(),
    entityId: (comment) => comment.id,
    isOn: (comment) => comment.isLiked,
    count: (comment) => comment.likes,
    apply: (comment, next) => ({ ...comment, isLiked: next.isOn, likes: next.count }),
    otherLists: {
      find: (data, id) => (Array.isArray(data) ? findInThreads(data as Comment[], id) : undefined),
      patch: (data, id, transform) => (Array.isArray(data) ? patchInThreads(data as Comment[], id, transform) : data),
    },
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
