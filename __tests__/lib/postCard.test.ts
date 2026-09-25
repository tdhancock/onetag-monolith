//
// target: __tests__/lib/postCard.test.ts
// The post card's copy rules — lib/screens/postCard.

import {
  POST_CARD_MAX_CHARS,
  actionLabels,
  commentsLinkLabel,
  likesLabel,
  repostsLabel,
  truncateForCard,
} from '../../lib/screens/postCard';

describe('likesLabel', () => {
  it('hides a zero count rather than showing "0"', () => {
    expect(likesLabel(0)).toBeNull();
    expect(likesLabel(undefined)).toBeNull();
    expect(likesLabel(null)).toBeNull();
    expect(likesLabel(-4)).toBeNull();
  });

  it('reads "N likes", singular at one', () => {
    expect(likesLabel(1)).toBe('1 like');
    expect(likesLabel(128)).toBe('128 likes');
  });

  it('groups thousands', () => {
    expect(likesLabel(12345)).toBe('12,345 likes');
  });
});

describe('repostsLabel', () => {
  it('hides zero and reads "N reposts"', () => {
    expect(repostsLabel(0)).toBeNull();
    expect(repostsLabel(1)).toBe('1 repost');
    expect(repostsLabel(3)).toBe('3 reposts');
  });
});

describe('commentsLinkLabel', () => {
  it('hides zero', () => {
    expect(commentsLinkLabel(0)).toBeNull();
    expect(commentsLinkLabel(undefined)).toBeNull();
  });

  it('reads "View all N comments", or "View 1 comment"', () => {
    expect(commentsLinkLabel(1)).toBe('View 1 comment');
    expect(commentsLinkLabel(12)).toBe('View all 12 comments');
  });
});

describe('truncateForCard', () => {
  const long = 'word '.repeat(80); // 400 characters

  it('leaves text at or under the limit alone', () => {
    const exact = 'x'.repeat(POST_CARD_MAX_CHARS);
    expect(truncateForCard(exact, false)).toEqual({ text: exact, truncated: false });
    expect(truncateForCard('short', false)).toEqual({ text: 'short', truncated: false });
  });

  it('cuts longer text at the limit with an ellipsis', () => {
    const { text, truncated } = truncateForCard(long, false);
    expect(truncated).toBe(true);
    expect(text.endsWith('…')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(POST_CARD_MAX_CHARS + 1);
  });

  it('shows everything once expanded', () => {
    expect(truncateForCard(long, true)).toEqual({ text: long, truncated: false });
  });
});

describe('actionLabels', () => {
  it('states each toggle action\'s state', () => {
    expect(actionLabels({ liked: true, reposted: false, saved: false })).toMatchObject({
      like: 'Like, liked',
      repost: 'Repost, not reposted',
      save: 'Save, not saved',
    });
    expect(actionLabels({ liked: false, reposted: true, saved: true })).toMatchObject({
      like: 'Like, not liked',
      repost: 'Repost, reposted',
      save: 'Save, saved',
    });
  });

  it('names the stateless actions', () => {
    const labels = actionLabels({ liked: false, reposted: false, saved: false });
    expect(labels.comment).toBe('Comment');
    expect(labels.share).toBe('Share to messages');
  });
});
