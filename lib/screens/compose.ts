//
// Pure logic for app/compose.tsx and app/edit-post.tsx, extracted so the
// counter's rules — when it warns, when it shows a number — and the Post
// button's rule are tested without a renderer.

/** The most characters a post may carry. */
export const POST_MAX_CHARS = 280;

/** The counter warns, and shows how many are left, inside this many characters of the limit. */
export const COUNTER_WARNING_ZONE = 20;

export type CounterTone = 'normal' | 'warning' | 'over';

export interface CharacterCounter {
  /** How much of the ring is filled, 0 to 1. */
  progress: number;
  tone: CounterTone;
  /** What the counter reads, or null while there is room to spare. Negative once over. */
  remaining: number | null;
}

/**
 * The counter beside the composer: a ring that fills as you type, turning
 * `heart` in the last 20 characters and past the limit, with the remaining
 * count shown only then.
 */
export const characterCounter = (length: number, max: number = POST_MAX_CHARS): CharacterCounter => {
  const left = max - length;
  const tone: CounterTone = left < 0 ? 'over' : left <= COUNTER_WARNING_ZONE ? 'warning' : 'normal';
  return {
    progress: Math.min(Math.max(length / max, 0), 1),
    tone,
    remaining: tone === 'normal' ? null : left,
  };
};

/**
 * Whether the composer's Post button is live: something to post, within the
 * limit, and not already publishing.
 */
export const canPublish = (
  text: string,
  hasMedia: boolean,
  publishing: boolean,
  max: number = POST_MAX_CHARS,
): boolean => (text.trim().length > 0 || hasMedia) && text.length <= max && !publishing;
