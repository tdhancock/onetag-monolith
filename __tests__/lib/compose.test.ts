//
// target: __tests__/lib/compose.test.ts
// The composer's counter and Post-button rules — lib/screens/compose.

import {
  COUNTER_WARNING_ZONE,
  POST_MAX_CHARS,
  canPublish,
  characterCounter,
} from '../../lib/screens/compose';

describe('characterCounter', () => {
  it('fills with the text and shows no number while there is room', () => {
    expect(characterCounter(0)).toEqual({ progress: 0, tone: 'normal', remaining: null });
    const half = characterCounter(POST_MAX_CHARS / 2);
    expect(half.progress).toBeCloseTo(0.5, 5);
    expect(half.tone).toBe('normal');
    expect(half.remaining).toBeNull();
  });

  it('warns, with the count, in the last 20 characters', () => {
    expect(COUNTER_WARNING_ZONE).toBe(20);
    expect(characterCounter(POST_MAX_CHARS - 21).tone).toBe('normal');
    expect(characterCounter(POST_MAX_CHARS - 20)).toMatchObject({ tone: 'warning', remaining: 20 });
    expect(characterCounter(POST_MAX_CHARS)).toMatchObject({ tone: 'warning', remaining: 0, progress: 1 });
  });

  it('goes over, with a negative count and a full ring, past the limit', () => {
    expect(characterCounter(POST_MAX_CHARS + 5)).toEqual({ progress: 1, tone: 'over', remaining: -5 });
  });

  it('honours a different limit', () => {
    expect(characterCounter(95, 100)).toMatchObject({ tone: 'warning', remaining: 5 });
  });
});

describe('canPublish', () => {
  it('needs text or a photo', () => {
    expect(canPublish('', false, false)).toBe(false);
    expect(canPublish('   ', false, false)).toBe(false);
    expect(canPublish('hello', false, false)).toBe(true);
    expect(canPublish('', true, false)).toBe(true);
  });

  it('refuses text over the limit, even with a photo', () => {
    expect(canPublish('x'.repeat(POST_MAX_CHARS), false, false)).toBe(true);
    expect(canPublish('x'.repeat(POST_MAX_CHARS + 1), true, false)).toBe(false);
  });

  it('refuses while already publishing', () => {
    expect(canPublish('hello', false, true)).toBe(false);
  });
});
