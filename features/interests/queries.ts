// Read hooks for interests (ONE-49).

import { useQuery } from '@tanstack/react-query';
import { fetchInterests } from './api';
import { interestKeys } from './keys';
import type { Interest } from './types';

/** The categories. They change only with a migration, so a day-old copy is fine. */
export const useInterestsQuery = () =>
  useQuery<Interest[]>({
    queryKey: interestKeys.lists(),
    queryFn: fetchInterests,
    staleTime: 24 * 60 * 60 * 1000,
  });
