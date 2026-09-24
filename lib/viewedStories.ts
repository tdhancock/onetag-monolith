// Which stories this device has already seen.
//
// Local state, not server state: it is per device, not per account, which is
// why it lives in AppContext backed by AsyncStorage rather than in a query
// (ONE-19). A story is identified by its `created_at` timestamp here, as it
// always has been.
//
// Pure, so the rehydration rules are tested without a renderer.

/** The AsyncStorage key the viewed set is written under. */
export const VIEWED_STORIES_KEY = 'onetag:viewedStoryTimestamps';

/**
 * How long a viewed mark is worth keeping: 48 hours.
 *
 * A story expires 24 hours after it is posted, so a mark older than that is
 * for a story nobody can see any more. Twice that leaves room for clock skew
 * between device and server.
 */
export const VIEWED_RETENTION_MS = 48 * 60 * 60 * 1000;

const isRecent = (timestamp: string, now: number): boolean => {
  const time = new Date(timestamp).getTime();
  return Number.isFinite(time) && time > now - VIEWED_RETENTION_MS;
};

/**
 * Turn whatever was stored into a viewed set.
 *
 * Tolerates a missing or malformed payload — `null`, an object, an array with
 * non-strings in it — by keeping what is usable and dropping the rest, and
 * drops marks for stories long expired so the set does not grow forever.
 */
export const parseViewedStoryTimestamps = (payload: unknown, now: number = Date.now()): Set<string> => {
  if (!Array.isArray(payload)) return new Set();
  return new Set(
    payload.filter((entry): entry is string => typeof entry === 'string' && isRecent(entry, now)),
  );
};

/** The viewed set as it is written to storage, expired marks pruned. */
export const serializeViewedStoryTimestamps = (viewed: Set<string>, now: number = Date.now()): string[] =>
  Array.from(viewed).filter((timestamp) => isRecent(timestamp, now));
