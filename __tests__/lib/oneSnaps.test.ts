//
// target: __tests__/lib/oneSnaps.test.ts
// OneSnap drawing rules — lib/oneSnaps, plus the withAlpha token helper the
// OneSnap screens lean on for their overlays.

import { gradientFor, isOneSnapGradientKey, latestOneSnap } from '../../lib/oneSnaps';
import { color, oneSnapGradientKeys, oneSnapGradients, withAlpha } from '../../theme/tokens';

const allGradients = Object.values(oneSnapGradients);
const unset = (id: string) => ({ id, background: null });

describe('gradientFor — the stored choice (ONE-78)', () => {
  it('draws the gradient the author picked', () => {
    // The third gradient, as in the acceptance criterion.
    const third = oneSnapGradientKeys[2];
    expect(gradientFor({ id: 'any', background: third })).toBe(oneSnapGradients[third]);
    expect(gradientFor({ id: 'other', background: 'plum' })).toBe(oneSnapGradients.plum);
  });

  it('falls back to the id for a key this build does not know', () => {
    expect(gradientFor({ id: 'story-abc', background: 'sunset' })).toBe(gradientFor(unset('story-abc')));
  });

  it('recognises only its own keys', () => {
    expect(isOneSnapGradientKey('navy')).toBe(true);
    expect(isOneSnapGradientKey('sunset')).toBe(false);
    expect(isOneSnapGradientKey('toString')).toBe(false);
    expect(isOneSnapGradientKey(null)).toBe(false);
  });
});

describe('gradientFor — OneSnaps posted before a choice was stored', () => {
  it('always gives the same OneSnap the same gradient', () => {
    expect(gradientFor(unset('story-abc'))).toBe(gradientFor(unset('story-abc')));
    expect(gradientFor({ id: 'story-abc' })).toBe(gradientFor(unset('story-abc')));
  });

  it('only ever picks from the token gradients', () => {
    for (let i = 0; i < 200; i++) {
      expect(allGradients).toContain(gradientFor(unset(`story-${i}`)));
    }
  });

  it('spreads OneSnaps across the gradients rather than piling onto one', () => {
    const used = new Set(Array.from({ length: 200 }, (_, i) => gradientFor(unset(`id-${i}`))));
    expect(used.size).toBe(oneSnapGradientKeys.length);
  });

  it('copes with an empty id', () => {
    expect(allGradients).toContain(gradientFor(unset('')));
  });
});

describe('oneSnapGradients', () => {
  it('keys are key-shaped, as the stories.background check requires', () => {
    for (const key of oneSnapGradientKeys) {
      expect(key).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
    }
  });

  it('keeps every key the app has ever stored', () => {
    // Keys are written to the database with each text OneSnap. Removing or
    // renaming one would repaint those OneSnaps with the fallback.
    expect(oneSnapGradientKeys).toEqual(
      expect.arrayContaining(['navy', 'plum', 'pine', 'ember', 'violet', 'orchid', 'teal']),
    );
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
