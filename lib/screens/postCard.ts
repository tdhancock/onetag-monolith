//
// Pure text logic for components/native/PostCard, extracted so the rules the
// card's copy follows — hidden zero counts, singular/plural, truncation, the
// state-bearing accessibility labels — can be pinned without mounting it.

/** Post text longer than this is cut, with a "more" control to expand it. */
export const POST_CARD_MAX_CHARS = 280;

const count = (n: number): string => n.toLocaleString('en-US');

const nonNegative = (n: number | null | undefined): number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;

/** "1 like", "128 likes" — or null at zero, so the line is hidden rather than "0". */
export const likesLabel = (likes: number | null | undefined): string | null => {
  const n = nonNegative(likes);
  if (n === 0) return null;
  return `${count(n)} ${n === 1 ? 'like' : 'likes'}`;
};

/** "1 repost", "3 reposts" — or null at zero. */
export const repostsLabel = (reposts: number | null | undefined): string | null => {
  const n = nonNegative(reposts);
  if (n === 0) return null;
  return `${count(n)} ${n === 1 ? 'repost' : 'reposts'}`;
};

/** "View 1 comment", "View all 12 comments" — or null at zero. */
export const commentsLinkLabel = (replies: number | null | undefined): string | null => {
  const n = nonNegative(replies);
  if (n === 0) return null;
  return n === 1 ? 'View 1 comment' : `View all ${count(n)} comments`;
};

export interface TruncatedContent {
  text: string;
  /** True when text was cut and a "more" control should follow it. */
  truncated: boolean;
}

/**
 * The text the card shows: the whole of it, or the first
 * `POST_CARD_MAX_CHARS` characters with an ellipsis until the reader expands.
 */
export const truncateForCard = (content: string, expanded: boolean): TruncatedContent => {
  if (expanded || content.length <= POST_CARD_MAX_CHARS) {
    return { text: content, truncated: false };
  }
  return { text: `${content.substring(0, POST_CARD_MAX_CHARS).trimEnd()}…`, truncated: true };
};

/** Accessibility labels that say the control's state, not just its name. */
export const actionLabels = (state: { liked: boolean; reposted: boolean; saved: boolean }) => ({
  like: `Like, ${state.liked ? 'liked' : 'not liked'}`,
  comment: 'Comment',
  repost: `Repost, ${state.reposted ? 'reposted' : 'not reposted'}`,
  share: 'Share to messages',
  save: `Save, ${state.saved ? 'saved' : 'not saved'}`,
});
