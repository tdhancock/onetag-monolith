// Write hooks for stories (OneSnaps).
//
// Upload is optimistic: a local entry with a `local-` id goes into "Your
// story" the moment capture finishes, is replaced by the server copy on
// success, and is removed on failure. That is the whole of what AppContext's
// `replaceStory` existed for.
//
// The cycles are plain option builders, as in features/notifications and
// features/messages, so the tests drive them against a real QueryClient.

import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { uriToUploadBlob } from '../../services/storyUpload';
import { toggleMutationOptions, type OptimisticToggleConfig } from '../../lib/optimisticToggle';
import { messageKeys, sendMessage } from '../messages';
import {
  deleteStoryFromDatabase,
  recordStoryView,
  toggleStoryLikeInDatabase,
  uploadStory,
} from './api';
import { storyKeys } from './keys';
import type { Story, StoryAuthor, UploadStoryInput } from './types';

/** True for a story that exists only on this device, still uploading. */
export const isLocalStory = (story: Pick<Story, 'id'> | string): boolean =>
  (typeof story === 'string' ? story : story.id).startsWith('local-');

// ─── Upload ───────────────────────────────────────────────────────────

interface UploadContext {
  localId: string;
}

/** The upload cycle, as plain mutation options. */
export const uploadStoryOptions = (queryClient: QueryClient, author: StoryAuthor | undefined) => ({
  mutationFn: async (input: UploadStoryInput): Promise<Story> => {
    if (!author?.id) throw new Error('You must be signed in.');

    const file = input.imageUri ? await uriToUploadBlob(input.imageUri) : null;
    return uploadStory(file, input.caption ?? null, author.id);
  },

  onMutate: async (input: UploadStoryInput): Promise<UploadContext> => {
    const localId = `local-${Date.now()}`;
    if (!author?.id) return { localId };

    const key = storyKeys.mine(author.id);
    await queryClient.cancelQueries({ queryKey: key });

    const local: Story = {
      id: localId,
      userId: author.id,
      username: author.username,
      avatar: author.avatar,
      timestamp: new Date().toISOString(),
      imageUrl: input.imageUri,
      content: input.caption ?? undefined,
    };

    // Never creates the list — writing one would mark it fresh and stop the
    // real fetch from running.
    queryClient.setQueryData<Story[] | undefined>(key, (stories) => stories && [local, ...stories]);
    return { localId };
  },

  onSuccess: (story: Story, _input: UploadStoryInput, context?: UploadContext) => {
    if (!author?.id || !context) return;
    queryClient.setQueryData<Story[] | undefined>(storyKeys.mine(author.id), (stories) =>
      stories?.map((s) => (s.id === context.localId ? story : s)),
    );
  },

  onError: (_error: unknown, _input: UploadStoryInput, context?: UploadContext) => {
    if (!author?.id || !context) return;
    queryClient.setQueryData<Story[] | undefined>(storyKeys.mine(author.id), (stories) =>
      stories?.filter((s) => s.id !== context.localId),
    );
  },

  onSettled: () => queryClient.invalidateQueries({ queryKey: storyKeys.lists() }),
});

/** Upload a story as the signed-in user. */
export const useUploadStory = (author: StoryAuthor | undefined) => {
  const queryClient = useQueryClient();
  return useMutation(uploadStoryOptions(queryClient, author));
};

// ─── Delete ───────────────────────────────────────────────────────────

interface DeleteSnapshot {
  lists: [QueryKey, unknown][];
}

/** The delete cycle: out of every cached list at once, back into all of them on failure. */
export const deleteStoryOptions = (queryClient: QueryClient) => ({
  mutationFn: async (storyId: string): Promise<void> => {
    // A local entry never reached the server; removing it is the whole job.
    if (isLocalStory(storyId)) return;
    if (!(await deleteStoryFromDatabase(storyId))) {
      throw new Error('Failed to delete story from server.');
    }
  },

  onMutate: async (storyId: string): Promise<DeleteSnapshot> => {
    await queryClient.cancelQueries({ queryKey: storyKeys.lists() });
    const lists = queryClient.getQueriesData<Story[]>({ queryKey: storyKeys.lists() });

    for (const [key] of lists) {
      queryClient.setQueryData<Story[] | undefined>(key, (stories) =>
        stories?.filter((s) => s.id !== storyId),
      );
    }
    return { lists };
  },

  onError: (_error: unknown, _storyId: string, snapshot?: DeleteSnapshot) => {
    for (const [key, data] of snapshot?.lists ?? []) queryClient.setQueryData(key, data);
  },

  onSettled: () => queryClient.invalidateQueries({ queryKey: storyKeys.lists() }),
});

/** Delete one of the signed-in user's stories. */
export const useDeleteStory = () => {
  const queryClient = useQueryClient();
  return useMutation(deleteStoryOptions(queryClient));
};

// ─── Like ─────────────────────────────────────────────────────────────

/**
 * Story likes on the shared optimistic toggle (lib/optimisticToggle.ts).
 *
 * As with blocking, there is no record carrying a boolean: what flips is
 * whether the liked-ids list holds this story, so the list is the entity.
 */
export const storyLikeToggleConfig = (
  userId: string | undefined,
  onToggle?: (next: { isOn: boolean }) => void,
): OptimisticToggleConfig<string[]> => ({
  entityKey: () => storyKeys.liked(userId ?? ''),
  // Nothing else caches liked story ids, so there is no second copy to patch.
  listKey: storyKeys.liked(userId ?? ''),
  entityId: () => '',
  isOn: (liked, storyId) => liked.includes(storyId),
  count: (liked) => liked.length,
  apply: (liked, next, storyId) =>
    next.isOn ? [...liked, storyId] : liked.filter((id) => id !== storyId),
  mutationFn: (storyId) => {
    if (!userId) return Promise.reject(new Error('You must be signed in to like a OneSnap.'));
    return toggleStoryLikeInDatabase(storyId, userId);
  },
  onToggle,
});

export interface StoryLikeToggle {
  toggle: (storyId: string) => void;
  isPending: boolean;
}

/** Like or unlike a story, optimistically; reverts if the server refuses. */
export const useToggleStoryLike = (
  userId: string | undefined,
  onToggle?: (next: { isOn: boolean }) => void,
): StoryLikeToggle => {
  const queryClient = useQueryClient();
  const mutation = useMutation(toggleMutationOptions(queryClient, storyLikeToggleConfig(userId, onToggle)));
  const { mutate } = mutation;

  return {
    toggle: useCallback(
      (storyId: string) => {
        // A story still uploading has no row to like yet.
        if (!userId || isLocalStory(storyId)) return;
        mutate(storyId);
      },
      [userId, mutate],
    ),
    isPending: mutation.isPending,
  };
};

// ─── View ─────────────────────────────────────────────────────────────

/**
 * Record a view, as plain mutation options.
 *
 * Fire-and-forget by design: no retry, no toast, and the error is swallowed
 * here rather than left for a caller to forget about. A lost view record is
 * not worth interrupting playback for.
 */
export const recordStoryViewOptions = (userId: string | undefined) => ({
  mutationFn: async (storyId: string): Promise<void> => {
    if (!userId) return;
    await recordStoryView(storyId, userId);
  },
  retry: false,
  onError: () => undefined,
});

/** `recordView(storyId)` — records that the signed-in user saw it. Never throws. */
export const useRecordStoryView = (userId: string | undefined) => {
  const { mutate } = useMutation(recordStoryViewOptions(userId));
  return useCallback((storyId: string) => {
    if (!isLocalStory(storyId)) mutate(storyId);
  }, [mutate]);
};

// ─── Reply ────────────────────────────────────────────────────────────

export interface ReplyToStoryInput {
  story: Pick<Story, 'id' | 'userId'>;
  text: string;
}

/**
 * A reply is a direct message to the story's owner, marked as a story reply.
 * It goes through features/messages, which owns the `messages` table.
 */
export const replyToStoryOptions = (queryClient: QueryClient, userId: string | undefined) => ({
  mutationFn: ({ story, text }: ReplyToStoryInput) => {
    if (!userId) return Promise.reject(new Error('You must be signed in.'));
    return sendMessage({
      sender_id: userId,
      receiver_id: story.userId,
      text,
      replied_story_id: story.id,
    });
  },
  onSettled: () =>
    queryClient.invalidateQueries({ queryKey: messageKeys.conversations(userId ?? '') }),
});

/** Reply to a story by direct message. */
export const useReplyToStory = (userId: string | undefined) => {
  const queryClient = useQueryClient();
  return useMutation(replyToStoryOptions(queryClient, userId));
};
