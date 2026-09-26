// Write hooks for the tags domain.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTag, deleteTag, recordScan, setTagActive, updateTag } from './api';
import { tagKeys } from './keys';
import type { NewTag, OwnedTag, TagUpdates } from './types';
import type { ProfileId } from '../../types';
import { useOptimisticToggle } from '../../lib/optimisticToggle';
import { scanKeys } from '../scans';

export interface RecordScanInput {
  tagId: string;
  /** The active profile, or null for a scan by someone signed out. */
  scannerProfileId: ProfileId | null;
}

/**
 * Record a Scan, fire-and-forget (ONE-30).
 *
 * Call `mutate`, never await it: a slow or failed insert must never delay or
 * prevent anyone reaching the Destination. Its errors are swallowed here —
 * there is no one to tell, and nothing they could do — and it is not retried,
 * so one resolution can never write two rows.
 *
 * A recorded scan marks the scanner's history stale (ONE-35), so it is there
 * the next time they open it.
 */
export const useRecordScan = () => {
  const queryClient = useQueryClient();
  return useMutation<void, unknown, RecordScanInput>({
    mutationFn: ({ tagId, scannerProfileId }) => recordScan(tagId, scannerProfileId),
    retry: 0,
    onSuccess: (_data, { scannerProfileId }) => {
      if (scannerProfileId) void queryClient.invalidateQueries({ queryKey: scanKeys.history(scannerProfileId) });
    },
    onError: () => undefined,
  });
};

/**
 * Create a Physical or Digital tag (ONE-32).
 *
 * Not optimistic: a tag is worthless until its short code exists, and the
 * database issues that code when it writes the row. The screen shows a
 * pending state until the row comes back. On success the new tag joins its
 * owner's cached list at once — the screens that open next read it from
 * there — and the lists are invalidated to pick up the server's copy.
 */
export const useCreateTag = () => {
  const queryClient = useQueryClient();
  return useMutation<OwnedTag, unknown, NewTag>({
    mutationFn: createTag,
    onSuccess: (tag) => {
      queryClient.setQueryData<OwnedTag[]>(tagKeys.mine(tag.ownerProfileId), (list) =>
        list ? [tag, ...list.filter((existing) => existing.id !== tag.id)] : list,
      );
      void queryClient.invalidateQueries({ queryKey: tagKeys.lists() });
    },
  });
};

/** Replace one tag in a profile's cached list. */
const patchTag = (list: OwnedTag[] | undefined, tagId: string, patch: Partial<OwnedTag>) =>
  list?.map((tag) => (tag.id === tagId ? { ...tag, ...patch } : tag));

export interface UpdateTagInput {
  tagId: string;
  updates: TagUpdates;
}

/**
 * Save a tag's name and note (ONE-34). The only fields an owner edits: the
 * short code is printed on objects and the destination is what people
 * scanned to reach, so neither is ever sent.
 */
export const useUpdateTag = (ownerProfileId: ProfileId | undefined) => {
  const queryClient = useQueryClient();
  const key = tagKeys.mine(ownerProfileId ?? '');
  return useMutation<void, unknown, UpdateTagInput>({
    mutationFn: ({ tagId, updates }) => updateTag(tagId, updates),
    onSuccess: (_data, { tagId, updates }) => {
      queryClient.setQueryData<OwnedTag[]>(key, (list) => patchTag(list, tagId, updates));
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
};

/**
 * Delete a tag (ONE-34). Irreversible, so never optimistic: the row leaves
 * the list only once the server has removed it.
 */
export const useDeleteTag = (ownerProfileId: ProfileId | undefined) => {
  const queryClient = useQueryClient();
  const key = tagKeys.mine(ownerProfileId ?? '');
  return useMutation<void, unknown, string>({
    mutationFn: deleteTag,
    onSuccess: (_data, tagId) => {
      queryClient.setQueryData<OwnedTag[]>(key, (list) => list?.filter((tag) => tag.id !== tagId));
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
};

/**
 * Whether a tag is active after onMutate has flipped it in the cached list —
 * read off the cache, so there is no separate record of intent to disagree
 * with it. Undefined when the tag is not in the list: nothing was flipped,
 * and nothing is sent.
 */
export const activeAfterFlip = (list: OwnedTag[] | undefined, tagId: string): boolean | undefined =>
  list?.find((tag) => tag.id === tagId)?.active;

/**
 * Pause or resume a tag, optimistically (ONE-34): `mutate(tagId)`.
 *
 * The same boolean toggle as a like or a save, so it runs on the shared
 * helper rather than growing its own rollback. Like blocking, there is no
 * detail record to flip — every tag screen reads the profile's one cached
 * list — so the list is the entity, and the tag id says which row.
 */
export const useTagActiveToggle = (ownerProfileId: ProfileId | undefined) => {
  const queryClient = useQueryClient();
  const key = tagKeys.mine(ownerProfileId ?? '');

  return useOptimisticToggle<OwnedTag[]>({
    entityKey: () => key,
    // Nothing else caches a profile's tags, so there is no second copy to patch.
    listKey: key,
    entityId: () => '',

    isOn: (list, tagId) => activeAfterFlip(list, tagId) ?? false,
    count: (list) => list.filter((tag) => tag.active).length,
    apply: (list, next, tagId) => patchTag(list, tagId, { active: next.isOn }) ?? list,

    mutationFn: async (tagId: string) => {
      const active = activeAfterFlip(queryClient.getQueryData<OwnedTag[]>(key), tagId);
      if (active === undefined) throw new Error('Tag not loaded.');
      return setTagActive(tagId, active);
    },
  });
};
