// Read hooks for the hashtags domain.

import { useQuery } from '@tanstack/react-query';
import { fetchHashtags } from './api';
import { hashtagKeys } from './keys';
import type { Hashtag } from './types';

/**
 * Every hashtag in recent posts, most used first.
 *
 * Inherits the client defaults from `lib/queryClient` — a minute of
 * staleness, which suits a trending list far better than the
 * refetch-on-every-mount the Explore screen used to do.
 */
export const useHashtagsQuery = () =>
  useQuery<Hashtag[]>({
    queryKey: hashtagKeys.lists(),
    queryFn: fetchHashtags,
  });
