// Live stories, through the shared bridge.
//
// Before ONE-19 the home screen subscribed with a raw `['stories']` key and
// re-read the whole reel on every event. A delete is now a targeted cache
// write. An insert or update still re-reads: the row carries no author
// username or avatar — those sit behind a join — so there is nothing
// renderable to write.

import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useRealtimeSync } from '../../lib/realtimeBridge';
import { storyKeys } from './keys';
import type { Story } from './types';

/** Take one story out of every cached list — the reel, "Your story" — without refetching. */
export const removeStoryFromLists = (queryClient: QueryClient, storyId: string): void => {
  for (const [key] of queryClient.getQueriesData<Story[]>({ queryKey: storyKeys.lists() })) {
    queryClient.setQueryData<Story[] | undefined>(key, (stories) =>
      stories?.filter((story) => story.id !== storyId),
    );
  }
};

/** Keep the cached story lists current while the home screen is mounted. */
export const useStoriesRealtime = (): void => {
  const queryClient = useQueryClient();
  const reread = () => {
    queryClient.invalidateQueries({ queryKey: storyKeys.lists() });
    return true;
  };

  useRealtimeSync({
    table: 'stories',
    filter: '',
    queryKey: storyKeys.lists(),
    onInsert: reread,
    onUpdate: reread,
    onDelete: (row) => {
      const id = typeof row.id === 'string' ? row.id : undefined;
      if (!id) return false;
      removeStoryFromLists(queryClient, id);
      return true;
    },
  });
};
