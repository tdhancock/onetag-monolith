// Pure Supabase access for the hashtags domain.
//
// No React, no hooks, no imports from another feature — so this file can be
// called from a hook, a script or a test without dragging a renderer along.

import { supabase } from '../../services/supabase.native';
import type { Hashtag } from './types';

/** How many recent posts are scanned for hashtags. */
export const HASHTAG_SCAN_LIMIT = 500;

/** Matches a `#word` hashtag in post content. */
const HASHTAG_PATTERN = /#(\w+)/g;

/**
 * Count each distinct hashtag across a set of post bodies.
 *
 * A tag is counted once per post no matter how many times it appears there,
 * so "#coffee #coffee #coffee" is one post's worth of interest rather than
 * three. Exported because the counting rule is the interesting part of this
 * domain and is worth testing without a network.
 */
export const countHashtags = (contents: (string | null | undefined)[]): Hashtag[] => {
  const counts: Record<string, number> = {};

  for (const content of contents) {
    if (!content) continue;

    HASHTAG_PATTERN.lastIndex = 0;
    const seenInPost: Record<string, boolean> = {};
    let match: RegExpExecArray | null;

    while ((match = HASHTAG_PATTERN.exec(content)) !== null) {
      const tag = match[1]!;
      if (seenInPost[tag]) continue;
      seenInPost[tag] = true;
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }

  return Object.entries(counts)
    .map(([tag, postCount]) => ({ tag, postCount }))
    .sort((a, b) => b.postCount - a.postCount);
};

/**
 * Every hashtag in recent posts, most used first.
 *
 * There is no hashtags table — tags are extracted from post content and
 * aggregated on the client, over a bounded window of recent posts to keep the
 * query cheap. Returns an empty list rather than throwing, matching the
 * behaviour the Explore screen has always had.
 */
export const fetchHashtags = async (): Promise<Hashtag[]> => {
  const { data, error } = await supabase
    .from('posts')
    .select('content')
    .not('content', 'is', null)
    .order('created_at', { ascending: false })
    .limit(HASHTAG_SCAN_LIMIT);

  if (error) {
    console.error('Error fetching posts for hashtags:', error.message);
    return [];
  }

  if (!data || data.length === 0) return [];

  return countHashtags(data.map((post: { content: string | null }) => post.content));
};
