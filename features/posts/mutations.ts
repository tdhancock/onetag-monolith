// Write hooks for the posts domain.
//
// Like, Repost and Save are the same operation over three different join
// tables, so all three are configurations of `useOptimisticToggle` — the
// rollback logic is written once, in `lib/optimisticToggle.ts`, and none of
// it is repeated here. A fourth toggle (saving a Product, following a
// Business) is another twenty lines of configuration, not another rollback.

import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  toggleLike,
  toggleRepost,
  publishPost,
  updatePost,
  deletePost,
  adminDeletePost,
} from './api';
import { postKeys } from './keys';
// Through the barrel. This used to be a raw ['profiles'] literal, because
// features/profiles imported this feature and importing back closed a cycle;
// the post mapper moving to services/postRows.ts (ONE-20) broke that loop.
import { profileKeys } from '../profiles';
import { saveKeys, toggleSave } from '../saves';
import type { Post } from './types';
import { useOptimisticToggle } from '../../lib/optimisticToggle';
import type { ProfileId } from '../../types';

/** What every post toggle has in common: where the entity lives, and how. */
const postToggleBase = {
  entityKey: (id: string) => postKeys.detail(id),
  // Every cached list under ['posts'] is patched — the feed's infinite pages
  // today, a profile grid or a search result tomorrow. Detail entries under
  // the same prefix are skipped: only data with `pages` is treated as a list.
  listKey: postKeys.all,
  entityId: (post: Post) => post.id,
};

/**
 * The signature the screens use: `toggle(postId)`, plus the pending flag.
 *
 * `mutate` rather than `mutateAsync` — a rejected promise nobody awaits is an
 * unhandled rejection, and the rollback already handles failure.
 */
export interface PostToggle {
  toggle: (postId: string) => void;
  isPending: boolean;
}

/**
 * What the caller is told the instant the cache flips, before the network
 * call: haptics and any "Saved to your collection" style feedback hang here.
 * Both used to fire inside the AppContext toggles these replace.
 */
export type OnToggle = (next: { isOn: boolean }) => void;

/** Like or unlike, optimistically. */
export const useLikePost = (userId: ProfileId | undefined, onToggle?: OnToggle): PostToggle => {
  const mutation = useOptimisticToggle<Post>({
    ...postToggleBase,
    mutationFn: (postId) => toggleLike(postId, requireUser(userId)),
    isOn: (post) => Boolean(post.isLiked),
    count: (post) => post.likes,
    apply: (post, next) => ({ ...post, isLiked: next.isOn, likes: next.count }),
    onToggle: (next) => onToggle?.(next),
  });

  return useToggle(mutation, userId);
};

/** Repost or un-repost, optimistically. */
export const useRepostPost = (userId: ProfileId | undefined, onToggle?: OnToggle): PostToggle => {
  const mutation = useOptimisticToggle<Post>({
    ...postToggleBase,
    mutationFn: (postId) => toggleRepost(postId, requireUser(userId)),
    isOn: (post) => Boolean(post.isReposted),
    count: (post) => post.reposts,
    apply: (post, next) => ({ ...post, isReposted: next.isOn, reposts: next.count }),
    onToggle: (next) => onToggle?.(next),
  });

  return useToggle(mutation, userId);
};

/**
 * Save or unsave, optimistically.
 *
 * The write is a save of a post through features/saves (ONE-39), where every
 * kind of target is saved the same way. The cache is the post's: a post's
 * save state lives on the post (`isSaved`), in every feed page that shows it,
 * so this configuration patches those — and then marks the profile's save
 * list stale, since it holds the same fact.
 *
 * A Save has no visible count on the post, so it toggles against a count of
 * zero — the helper still tracks one, which keeps the three configurations
 * identical in shape and costs nothing.
 */
export const useSavePost = (userId: ProfileId | undefined, onToggle?: OnToggle): PostToggle => {
  const queryClient = useQueryClient();
  const mutation = useOptimisticToggle<Post>({
    ...postToggleBase,
    mutationFn: async (postId) => {
      const saved = await toggleSave(requireUser(userId), { kind: 'post', id: postId });
      void queryClient.invalidateQueries({ queryKey: saveKeys.all });
      return saved;
    },
    isOn: (post) => Boolean(post.isSaved),
    count: () => 0,
    apply: (post, next) => ({ ...post, isSaved: next.isOn }),
    onToggle: (next) => onToggle?.(next),
  });

  return useToggle(mutation, userId);
};

/**
 * Signed out, there is nobody to attribute the row to. Throwing inside
 * `mutationFn` routes through the same rollback as a server refusal rather
 * than leaving the optimistic value on screen.
 */
const requireUser = (userId: string | undefined): string => {
  if (!userId) throw new Error('You must be signed in to do that.');
  return userId;
};

/** Narrow a mutation to the surface screens actually use. */
const useToggle = (
  mutation: { mutate: (postId: string) => void; isPending: boolean },
  userId: string | undefined,
): PostToggle => {
  const { mutate, isPending } = mutation;

  return {
    toggle: useCallback(
      (postId: string) => {
        // Nothing to toggle against without a viewer; the mutation would only
        // flip the cache and immediately roll it back.
        if (!userId) return;
        mutate(postId);
      },
      [mutate, userId],
    ),
    isPending,
  };
};

// ---------------------------------------------------------------------------
// Publishing, editing and deleting
// ---------------------------------------------------------------------------
//
// These were `addProfilePost` / `updateProfilePost` / `deleteProfilePost` on
// AppContext, each keeping a `profilePosts` array in sync by hand (ONE-15).
// The array is a query now, so they invalidate instead.

/**
 * Publish a post.
 *
 * Rejects when the media could not be uploaded, which is what keeps the
 * composer open with the draft intact (ONE-56).
 */
export const useCreatePost = (authorId: ProfileId | undefined) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (post: Post): Promise<Post> => {
      if (!authorId) throw new Error('You must be signed in to post.');
      const published = await publishPost(post, authorId);
      if (!published) throw new Error('API returned null post.');
      return published;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: postKeys.all });
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
};

/** Edit a post's text. */
export const useUpdatePost = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (post: Post): Promise<Post> => {
      // updatePost reports failure by returning null rather than throwing.
      const updated = await updatePost(post);
      if (!updated) throw new Error('Could not save that post.');
      return updated;
    },
    onSuccess: (_updated, post) => {
      queryClient.invalidateQueries({ queryKey: postKeys.detail(post.id) });
      queryClient.invalidateQueries({ queryKey: postKeys.all });
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
};

/**
 * Delete a post.
 *
 * `asAdmin` routes through the admin delete, which is RLS-gated on the
 * `is_admin` flag rather than on ownership.
 */
export const useDeletePost = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ postId, asAdmin = false }: { postId: string; asAdmin?: boolean }) => {
      if (asAdmin) return adminDeletePost(postId);

      // deletePost reports failure by returning false rather than throwing.
      const deleted = await deletePost(postId);
      if (!deleted) throw new Error('Could not delete that post.');
    },
    onSuccess: (_result, { postId }) => {
      queryClient.removeQueries({ queryKey: postKeys.detail(postId) });
      queryClient.invalidateQueries({ queryKey: postKeys.all });
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
};
