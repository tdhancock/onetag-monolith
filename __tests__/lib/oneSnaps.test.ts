//
// target: __tests__/lib/oneSnaps.test.ts
// OneSnap drawing rules — lib/oneSnaps, plus the withAlpha token helper the
// OneSnap screens lean on for their overlays.

import { gradientFor, latestOneSnap } from '../../lib/oneSnaps';
import { color, oneSnapGradients, withAlpha } from '../../theme/tokens';

describe('gradientFor', () => {
  it('always gives the same OneSnap the same gradient', () => {
    expect(gradientFor('story-abc')).toBe(gradientFor('story-abc'));
  });

  it('only ever picks from the token gradients', () => {
    for (let i = 0; i < 200; i++) {
      expect(oneSnapGradients).toContain(gradientFor(`story-${i}`));
    }
  });

  it('spreads OneSnaps across the gradients rather than piling onto one', () => {
    const used = new Set(Array.from({ length: 200 }, (_, i) => gradientFor(`id-${i}`)));
    expect(used.size).toBe(oneSnapGradients.length);
  });

  it('copes with an empty id', () => {
    expect(oneSnapGradients).toContain(gradientFor(''));
  });
});

describe('latestOneSnap', () => {
  const at = (id: string, timestamp: string) => ({ id, timestamp });

  it('picks the most recent, whatever the order', () => {
    const stories = [
      at('a', '2026-09-24T08:00:00Z'),
      at('c', '2026-09-24T12:00:00Z'),
      at('b', '2026-09-24T10:00:00Z'),
    ];
    expect(latestOneSnap(stories)?.id).toBe('c');
  });

  it('returns undefined for an empty group', () => {
    expect(latestOneSnap([])).toBeUndefined();
  });

  it('falls back to a readable timestamp over an unreadable one', () => {
    expect(latestOneSnap([at('bad', 'not a date'), at('good', '2026-09-24T08:00:00Z')])?.id).toBe('good');
  });
});

describe('withAlpha', () => {
  it('turns a token into an rgba() at the given strength', () => {
    expect(withAlpha(color.text, 0.7)).toBe('rgba(10, 10, 10, 0.7)');
    expect(withAlpha(color.inverse, 0.4)).toBe('rgba(255, 255, 255, 0.4)');
  });

  it('clamps the strength to 0–1', () => {
    expect(withAlpha(color.inverse, 2)).toBe('rgba(255, 255, 255, 1)');
    expect(withAlpha(color.inverse, -1)).toBe('rgba(255, 255, 255, 0)');
  });

  it('refuses anything but a six-digit hex', () => {
    expect(() => withAlpha('red', 0.5)).toThrow();
    expect(() => withAlpha('#fff', 0.5)).toThrow();
  });
});
