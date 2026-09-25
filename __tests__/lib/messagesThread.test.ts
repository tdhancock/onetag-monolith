//
// target: __tests__/lib/messagesThread.test.ts
//
// The thread's layout rules (ONE-70): bubble spacing by sender, which bubble
// carries the time, and the status line under your newest message.

import {
  bubbleGapAbove,
  endsRun,
  formatMessageTime,
  lastOwnMessageId,
  messageMetaLabel,
  MESSAGE_SENDING_LABEL,
} from '../../lib/screens/messages';
import { space } from '../../theme/tokens';

const at = (h: number, m: number) => new Date(2026, 8, 24, h, m).toISOString();
const m = (id: string, sender: string, time = at(9, 5)) => ({ id, sender_id: sender, created_at: time });

const thread = [m('1', 'ana'), m('2', 'ana'), m('3', 'me'), m('4', 'me'), m('5', 'ana')];

describe('bubbleGapAbove', () => {
  it('puts nothing above the first bubble', () => {
    expect(bubbleGapAbove(thread, 0)).toBe(0);
  });

  it('keeps a run tight (xs) and opens a turn (md)', () => {
    expect(bubbleGapAbove(thread, 1)).toBe(space.xs);
    expect(bubbleGapAbove(thread, 2)).toBe(space.md);
    expect(bubbleGapAbove(thread, 3)).toBe(space.xs);
    expect(bubbleGapAbove(thread, 4)).toBe(space.md);
  });
});

describe('endsRun', () => {
  it('is true for the last bubble of each sender run and the last overall', () => {
    expect(thread.map((_, i) => endsRun(thread, i))).toEqual([false, true, false, true, true]);
  });
});

describe('lastOwnMessageId', () => {
  it('finds your newest message', () => {
    expect(lastOwnMessageId(thread, 'me')).toBe('4');
  });

  it('is null when you have sent nothing, or there is no you', () => {
    expect(lastOwnMessageId(thread, 'bo')).toBeNull();
    expect(lastOwnMessageId(thread, undefined)).toBeNull();
  });
});

describe('formatMessageTime', () => {
  it('is 24-hour HH:MM', () => {
    expect(formatMessageTime(at(9, 5))).toBe('09:05');
    expect(formatMessageTime(at(21, 40))).toBe('21:40');
  });

  it('is empty for an unreadable date', () => {
    expect(formatMessageTime('not a date')).toBe('');
  });
});

describe('messageMetaLabel', () => {
  const message = m('4', 'me', at(14, 30));

  it('says "Sending…" under your newest message while it is pending', () => {
    expect(messageMetaLabel({ message, endsRun: true, isLastOwn: true, isPending: true })).toBe(MESSAGE_SENDING_LABEL);
  });

  it('says "Sent" with the time once the server has it', () => {
    expect(messageMetaLabel({ message, endsRun: true, isLastOwn: true, isPending: false })).toBe('Sent · 14:30');
  });

  it('gives the end of any other run just its time', () => {
    expect(messageMetaLabel({ message, endsRun: true, isLastOwn: false, isPending: false })).toBe('14:30');
  });

  it('leaves the middle of a run bare', () => {
    expect(messageMetaLabel({ message, endsRun: false, isLastOwn: false, isPending: false })).toBeNull();
  });
});
