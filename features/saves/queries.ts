// Read hooks for Saves.

import { useQuery } from '@tanstack/react-query';
import { fetchSaves, saveKeyOf } from './api';
import { saveKeys } from './keys';
import type { Save, SaveTarget } from './types';

/**
 * Every save a profile has made, newest first (ONE-39). Keyed by the profile,
 * so a profile switch lists the newly active profile's saves.
 */
export const useSavesQuery = (profileId: string | undefined) =>
  useQuery<Save[]>({
    queryKey: saveKeys.mine(profileId ?? ''),
    queryFn: () => fetchSaves(profileId!),
    enabled: Boolean(profileId),
  });

/**
 * Whether a profile has saved a target — read from its save list, the same
 * cached copy `useToggleSave` flips, so the two can never disagree.
 */
export const useIsSaved = (profileId: string | undefined, target: SaveTarget): boolean => {
  const key = saveKeyOf(target);
  const { data } = useQuery<Save[], Error, boolean>({
    queryKey: saveKeys.mine(profileId ?? ''),
    queryFn: () => fetchSaves(profileId!),
    enabled: Boolean(profileId),
    select: (saves) => saves.some((save) => saveKeyOf(save.target) === key),
  });
  return data === true;
};
