//
// target: __tests__/theme-consistency.test.ts
//
// Tests that the design tokens are what M1a specified, and that the
// tailwind mirror resolves to exactly the same values.
//
// What we cover:
//   1. theme/tokens.ts exports the colour, radius, space and type groups
//      with every value the ticket listed — this is the single source of
//      truth the whole re-skin builds on, so a typo here is expensive.
//   2. Radius is square across the board. It is the house style, and the
//      scale exists so components reference it instead of inventing one.
//   3. The monoLabel micro-label treatment is defined once, at the right
//      size and tracking.
//   4. tailwind.config.ts carries identical values, so a NativeWind class
//      and an inline style cannot drift apart, and the old blue and
//      display-font scales are gone.
//   5. The chrome files carry no raw hex the tokens now own.
//
// Runs in the project's plain `ts-jest` / node setup — the token module is
// pure data and pulls in no React Native.

import * as fs from 'fs';
import * as path from 'path';

import { color, radius, space, type, tokens } from '../theme/tokens';
import tailwindConfig from '../tailwind.config';

const repoRoot = path.resolve(__dirname, '..');
const read = (relative: string) =>
  fs.readFileSync(path.join(repoRoot, relative), 'utf8');

// ─── 1. Colour tokens ─────────────────────────────────────────────────

describe('design tokens — colour', () => {
  it('exports exactly the light editorial palette', () => {
    expect(color).toEqual({
      bg: '#ffffff',
      bgSub: '#fafafa',
      bgPanel: '#f5f5f5',
      border: '#e8e8e8',
      borderStrong: '#d0d0d0',
      text: '#0a0a0a',
      textMid: '#555555',
      textMuted: '#999999',
      inverse: '#ffffff',
      heart: '#e53935',
      affiliate: '#4caf50',
    });
  });

  it('is a light ground with near-black ink, not the old dark theme', () => {
    // The direction reversed in M1a: the ground used to be black with white
    // text. Anything that flips it back is a regression, not a preference.
    expect(color.bg).toBe('#ffffff');
    expect(color.text).toBe('#0a0a0a');
    expect(color.inverse).toBe(color.bg);
  });

  it('drops the blue accent the app was built from', () => {
    expect(Object.values(color)).not.toContain('#3b82f6');
  });

  it('every colour is a six-digit lowercase hex', () => {
    // Catches a shorthand or uppercase value slipping in, which would make
    // the tailwind mirror and an inline style compare unequal as strings
    // even when they render the same.
    for (const [name, value] of Object.entries(color)) {
      expect(`${name}:${value}`).toMatch(/^[a-zA-Z]+:#[0-9a-f]{6}$/);
    }
  });
});

// ─── 2. Radius is square everywhere ───────────────────────────────────

describe('design tokens — radius', () => {
  it('exposes a scale whose every step is 0', () => {
    expect(Object.values(radius).length).toBeGreaterThan(0);
    for (const value of Object.values(radius)) {
      expect(value).toBe(0);
    }
  });
});

// ─── 3. Space ─────────────────────────────────────────────────────────

describe('design tokens — space', () => {
  it('exports the 4 / 8 / 12 / 16 / 24 / 32 scale', () => {
    expect(Object.values(space)).toEqual([4, 8, 12, 16, 24, 32]);
  });

  it('is ordered ascending so the names stay meaningful', () => {
    const values = Object.values(space) as number[];
    const sorted = [...values].sort((a, b) => a - b);
    expect(values).toEqual(sorted);
  });
});

// ─── 4. Type ──────────────────────────────────────────────────────────

describe('design tokens — type', () => {
  it('names the DM Mono and DM Sans families the root layout loads', () => {
    expect(type.mono).toBe('DMMono_500Medium');
    expect(type.body).toBe('DMSans_400Regular');
    expect(type.bodyMedium).toBe('DMSans_500Medium');
    expect(type.bodyBold).toBe('DMSans_700Bold');
  });

  it('defines monoLabel once: 10px monospace, 0.18em tracking, uppercase', () => {
    // React Native takes letterSpacing in points, so 0.18em at 10px is 1.8.
    expect(type.monoLabel).toEqual({
      fontFamily: type.mono,
      fontSize: 10,
      letterSpacing: 1.8,
      textTransform: 'uppercase',
    });
    expect(type.monoLabel.letterSpacing).toBeCloseTo(
      type.monoLabel.fontSize * 0.18,
      5,
    );
  });

  it('carries none of the three display fonts the template shipped with', () => {
    const families = [type.mono, type.body, type.bodyMedium, type.bodyBold].join(' ');
    for (const stale of ['DancingScript', 'Anton', 'Fredoka']) {
      expect(families).not.toContain(stale);
    }
  });
});

// ─── 5. The grouped export ────────────────────────────────────────────

describe('design tokens — grouped export', () => {
  it('exposes colour, radius, space and type under one object', () => {
    expect(tokens).toEqual({ color, radius, space, type });
  });
});

// ─── 6. The tailwind mirror cannot drift ──────────────────────────────

const extend = tailwindConfig.theme!.extend!;

describe('tailwind mirror — colours', () => {
  it('resolves every colour to the identical token value', () => {
    expect(extend.colors).toEqual(color);
  });

  it('no longer carries the primary blue scale', () => {
    expect(extend.colors).not.toHaveProperty('primary');
    expect(read('tailwind.config.ts')).not.toContain('#3b82f6');
  });
});

describe('tailwind mirror — radius and space', () => {
  it('mirrors every radius step as 0px', () => {
    for (const key of Object.keys(radius)) {
      expect((extend.borderRadius as Record<string, string>)[key]).toBe('0px');
    }
  });

  it('mirrors every space step at the identical value', () => {
    for (const [key, value] of Object.entries(space)) {
      expect((extend.spacing as Record<string, string>)[key]).toBe(`${value}px`);
    }
  });
});

describe('tailwind mirror — type', () => {
  it('registers the four DM families and drops the old display fonts', () => {
    const families = extend.fontFamily as Record<string, string[]>;
    expect(families.mono).toEqual([type.mono]);
    expect(families.body).toEqual([type.body]);
    expect(families['body-medium']).toEqual([type.bodyMedium]);
    expect(families['body-bold']).toEqual([type.bodyBold]);

    for (const stale of ['handwriting', 'anton', 'fredoka']) {
      expect(families).not.toHaveProperty(stale);
    }
  });

  it('exposes the monoLabel size and tracking as utilities', () => {
    expect((extend.fontSize as Record<string, string>)['mono-label']).toBe(
      `${type.monoLabel.fontSize}px`,
    );
    expect((extend.letterSpacing as Record<string, string>)['mono-label']).toBe(
      `${type.monoLabel.letterSpacing}px`,
    );
  });
});

// ─── 7. Chrome files no longer hardcode what the tokens own ───────────

describe('chrome files reference tokens, not raw hex', () => {
  const chrome = ['app/_layout.tsx', 'app/(tabs)/_layout.tsx', 'tailwind.config.ts'];

  it.each(chrome)('%s contains no dark-theme or blue-accent literal', (file) => {
    const source = read(file);
    expect(source).not.toContain('#3b82f6');
    expect(source).not.toContain("'#000'");
    expect(source).not.toContain('"#000"');
  });

  it('app/_layout.tsx renders the status bar dark against the white ground', () => {
    const source = read('app/_layout.tsx');
    expect(source).toContain('<StatusBar style="dark" />');
    expect(source).toContain('backgroundColor: color.bg');
  });
});
