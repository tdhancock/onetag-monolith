// Pure helpers for drawing OneSnaps (still `stories` in code and tables).
//
// Kept apart from the components so the rules — which OneSnap a reel card
// shows, which gradient a text OneSnap gets — are tested without a renderer.

import {
  oneSnapGradientKeys,
  oneSnapGradients,
  type OneSnapGradient,
  type OneSnapGradientKey,
} from '../theme/tokens';
import type { Story } from '../types';

/** Whether a stored background is one this build knows how to draw. */
export const isOneSnapGradientKey = (key: unknown): key is OneSnapGradientKey =>
  typeof key === 'string' && Object.prototype.hasOwnProperty.call(oneSnapGradients, key);

/**
 * The gradient a text OneSnap is drawn on: the one its author picked, stored
 * as `background` since ONE-78.
 *
 * A OneSnap posted before then carries none, and one from a newer build may
 * carry a key this build does not know. Either way the gradient is derived
 * from the OneSnap's id instead, so it is stable — the reel card and the
 * viewer agree, whatever order the reel is in.
 */
export const gradientFor = (story: Pick<Story, 'id' | 'background'>): OneSnapGradient => {
  if (isOneSnapGradientKey(story.background)) return oneSnapGradients[story.background];

  let hash = 0;
  for (let i = 0; i < story.id.length; i++) {
    hash = (hash * 31 + story.id.charCodeAt(i)) | 0;
  }
  return oneSnapGradients[oneSnapGradientKeys[Math.abs(hash) % oneSnapGradientKeys.length]];
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

// ─── Playing them ───────────────────────────────────────────────────────

/** How long one OneSnap shows before the next, in milliseconds. */
export const ONESNAP_DURATION_MS = 15000;

/** The left share of the screen a tap goes back from; anywhere else goes on. */
export const ONESNAP_BACK_ZONE = 0.3;

/**
 * Where a tap on a playing OneSnap goes. Holding pauses it, so a tap only
 * ever moves: back from the left edge, on from anywhere else.
 */
export const oneSnapTapTarget = (x: number, screenWidth: number): 'previous' | 'next' =>
  x < screenWidth * ONESNAP_BACK_ZONE ? 'previous' : 'next';

/**
 * How long is left to play of a OneSnap that has played `progress` (0 to 1)
 * of its time: all of it when it starts, the rest when it resumes after a
 * hold, so a pause never sends it back to the start.
 */
export const oneSnapRemainingMs = (progress: number, duration: number = ONESNAP_DURATION_MS): number =>
  Math.max(0, Math.round(duration * (1 - Math.min(1, Math.max(0, progress)))));
