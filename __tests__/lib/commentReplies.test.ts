//
// target: __tests__/lib/commentReplies.test.ts
//
// How the comments screen shows a thread's replies, and how a reply starts
// (lib/screens/comments).

import { deleteCommentConfirm, hiddenRepliesLabel, replyPrefill, REPLIES_SHOWN, visibleReplies } from '../../lib/screens/comments';

describe('visibleReplies', () => {
  it('shows a short thread whole', () => {
    expect(visibleReplies(['a', 'b'], false)).toEqual(['a', 'b']);
    expect(REPLIES_SHOWN).toBe(2);
  });

  it('folds a longer one until it is opened', () => {
    expect(visibleReplies(['a', 'b', 'c'], false)).toEqual([]);
    expect(visibleReplies(['a', 'b', 'c'], true)).toEqual(['a', 'b', 'c']);
  });
});

describe('hiddenRepliesLabel', () => {
  it('counts what is folded, and is nothing when nothing is', () => {
    expect(hiddenRepliesLabel(1)).toBe('View 1 reply');
    expect(hiddenRepliesLabel(4)).toBe('View 4 replies');
    expect(hiddenRepliesLabel(0)).toBeNull();
  });
});

describe('replyPrefill', () => {
  it('starts with the handle of whoever is answered', () => {
    expect(replyPrefill('ana', 'me')).toBe('@ana ');
  });

  it('is empty when answering yourself', () => {
    expect(replyPrefill('me', 'me')).toBe('');
  });
});

describe('deleteCommentConfirm', () => {
  it('asks first when replies would go with the comment, and counts them', () => {
    expect(deleteCommentConfirm(1)!.body).toBe('Its reply will be deleted too.');
    expect(deleteCommentConfirm(3)!.body).toBe('Its 3 replies will be deleted too.');
  });

  it('asks nothing of a comment nobody replied to', () => {
    expect(deleteCommentConfirm(0)).toBeNull();
  });
});
