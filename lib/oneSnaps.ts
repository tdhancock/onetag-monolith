// Pure helpers for drawing OneSnaps (still `stories` in code and tables).
//
// Kept apart from the components so the rules — which OneSnap a reel card
// shows, which gradient a text OneSnap gets — are tested without a renderer.

import { oneSnapGradients, type OneSnapGradient } from '../theme/tokens';
import type { Story } from '../types';

/**
 * The gradient a text OneSnap is drawn on.
 *
 * The gradient picked at creation is not stored (only the text is), so the
 * choice is derived from the OneSnap's id. That keeps it stable: the reel card
 * and the viewer agree, and a OneSnap keeps its colour however the reel is
 * ordered. The viewer used to pick by position, which changed a OneSnap's
 * colour whenever one before it expired.
 */
export const gradientFor = (storyId: string): OneSnapGradient => {
  let hash = 0;
  for (let i = 0; i < storyId.length; i++) {
    hash = (hash * 31 + storyId.charCodeAt(i)) | 0;
  }
  return oneSnapGradients[Math.abs(hash) % oneSnapGradients.length];
};

/** The most recent OneSnap in a group — the one its reel card shows. */
export const latestOneSnap = <T extends Pick<Story, 'timestamp'>>(stories: readonly T[]): T | undefined => {
  let latest: T | undefined;
  let latestTime = -Infinity;
  for (const story of stories) {
    const time = new Date(story.timestamp).getTime();
    if (latest === undefined || time > latestTime) {
      latest = story;
      latestTime = Number.isFinite(time) ? time : latestTime;
    }
  }
  return latest;
};
