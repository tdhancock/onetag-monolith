//
// target: __tests__/lib/conversationPreview.test.ts
//
// The line under a name in the Messages list: the conversation's latest
// message, marked as yours when you sent it.

import { conversationPreview } from '../../lib/screens/messages';

const ME = 'p-me';

describe('conversationPreview', () => {
  it('is their latest message as they wrote it, on one line', () => {
    expect(conversationPreview({ text: 'See you\n\nthen  ', type: 'text', senderId: 'p-ana' }, ME)).toBe('See you then');
  });

  it('starts with "You:" when you sent it', () => {
    expect(conversationPreview({ text: 'On my way', type: 'text', senderId: ME }, ME)).toBe('You: On my way');
  });

  it('says what was shared when a share carries no text', () => {
    expect(conversationPreview({ text: null, type: 'post_share', senderId: 'p-ana' }, ME)).toBe('Sent a post');
    expect(conversationPreview({ text: '', type: 'profile_share', senderId: ME }, ME)).toBe('You: Sent a profile');
    expect(conversationPreview({ text: null, type: 'story_reply', senderId: 'p-ana' }, ME)).toBe('Replied to a OneSnap');
  });

  it('keeps what was said with a share', () => {
    expect(conversationPreview({ text: 'Look at this', type: 'post_share', senderId: 'p-ana' }, ME)).toBe('Look at this');
  });

  it('is nothing when there is nothing to preview, and the row shows the handle', () => {
    expect(conversationPreview(null, ME)).toBeNull();
    expect(conversationPreview({ text: '   ', type: 'text', senderId: 'p-ana' }, ME)).toBeNull();
  });
});
