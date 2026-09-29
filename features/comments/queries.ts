// Read hooks for the comments domain.

import { useQuery } from '@tanstack/react-query';
import { getCommentsForPost } from './api';
import { commentKeys } from './keys';
import type { Comment } from './types';
import type { ProfileId } from '../../types';

/**
 * Every comment on a post.
 *
 * This replaced a `Map<postId, Comment[]>` on AppContext with a hand-rolled
 * loaded flag, plus a 209-line fetch guard that deduped in-flight requests,
 * aborted stale ones and enforced a cooldown. TanStack does all of that by
 * key: two mounts of this screen share one request, and a request for the
 * previous post cannot land on the new one because it is a different key.
 */
export const useCommentsQuery = (postId: string | undefined, viewerId?: ProfileId) =>
  useQuery<Comment[]>({
    // The viewer isn't in the key: a profile switch resets every comment
    // list (useProfileSwitchReset), so no list outlives the viewer it's for.
    queryKey: commentKeys.forPost(postId ?? ''),
    queryFn: () => getCommentsForPost(postId!, viewerId),
    enabled: Boolean(postId),
  });

