// The only place story query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('stories');

export const storyKeys = {
  ...base,
  /** The reel: live stories from everyone this viewer follows, and their own. */
  reel: (viewerId: string) => [...base.lists(), 'reel', viewerId] as const,
  /** One user's own stories — "Your story". */
  mine: (userId: string) => [...base.lists(), 'mine', userId] as const,
  /** The ids of the stories this user has liked. */
  liked: (userId: string) => [...base.all, 'liked', userId] as const,
  /** Who has viewed one story. Only its owner asks. */
  viewers: (storyId: string) => [...base.all, 'viewers', storyId] as const,
  /** How many have viewed one story. */
  viewCount: (storyId: string) => [...base.all, 'viewCount', storyId] as const,
};
