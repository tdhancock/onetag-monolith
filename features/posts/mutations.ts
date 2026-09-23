// Write hooks for the posts domain.
//
// Like, Repost and Save are the same operation over three different join
// tables, so all three are configurations of `useOptimisticToggle` — the
// rollback logic is written once, in `lib/optimisticToggle.ts`, and none of
// it is repeated here. A fourth toggle (saving a Product, following a
// Business) is another twenty lines of configuration, not another rollback.

import { useCallback } from 'react';
import { toggleLike, toggleRepost, toggleSavePost } from './api';
import { postKeys } from './keys';
import type { Post } from './types';
import { useOptimisticToggle } from '../../lib/optimisticToggle';

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
export const useLikePost = (userId: string | undefined, onToggle?: OnToggle): PostToggle => {
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
export const useRepostPost = (userId: string | undefined, onToggle?: OnToggle): PostToggle => {
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
 * A Save has no visible count on the post, so it toggles against a count of
 * zero — the helper still tracks one, which keeps the three configurations
 * identical in shape and costs nothing.
 */
export const useSavePost = (userId: string | undefined, onToggle?: OnToggle): PostToggle => {
  const mutation = useOptimisticToggle<Post>({
    ...postToggleBase,
    mutationFn: (postId) => toggleSavePost(postId, requireUser(userId)),
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
