
//
// target: __tests__/components/UserAvatar.utils.test.ts
// UserAvatar username → colour assignment, via components/native/UserAvatar.
//
// Repointed from the deleted web fork. The fork exported
// `getColorForUsername` directly; the native twin keeps the same algorithm
// and the same 14-colour palette but holds it module-private, so these
// tests drive it through the component's public surface instead: render
// the avatar with no avatarUrl and read the backgroundColor it assigns.
// (Per ONE-5 requirement 4, the test adapts to the native API — the
// component is not widened just to be testable.)

import React from 'react';

// ─── 1. Mock the native runtime ─────────────────────────────────────────

jest.mock('react-native', () => {
  const React = require('react');
  const passthrough = (name: string) => {
    const C: React.FC<Record<string, unknown>> = props =>
      React.createElement(name, props, props.children as React.ReactNode);
    C.displayName = name;
    return C;
  };
  return { __esModule: true, View: passthrough('div'), Text: passthrough('span') };
}, { virtual: true });

jest.mock('expo-image', () => {
  const React = require('react');
  const Image: React.FC<Record<string, unknown>> = () => null;
  Image.displayName = 'Image';
  return { __esModule: true, Image };
}, { virtual: true });

import UserAvatar from '../../components/native/UserAvatar';

// ─── 2. Helpers ─────────────────────────────────────────────────────────

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

// The palette in components/native/UserAvatar.tsx, pinned here so a change
// to it is a deliberate, visible edit rather than a silent drift.
const COLORS = [
  '#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', '#10b981',
  '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#d946ef', '#ec4899',
];

const FALLBACK_COLOR = '#64748b';

type AvatarProps = {
  username: string | null | undefined;
  avatarUrl: string | null | undefined;
  size?: number;
  className?: string;
};

const render = (props: AvatarProps) =>
  (UserAvatar as unknown as (p: AvatarProps) => React.ReactElement<{
    style: Record<string, unknown>;
    children?: React.ReactElement<{ children?: unknown; style?: Record<string, unknown> }>;
  }>)(props);

/**
 * The colour the avatar assigns to a username. Goes through the same
 * initials branch the app renders when a profile has no picture.
 */
const colorFor = (username: string | null | undefined): string => {
  const el = render({ username, avatarUrl: null });
  return el.props.style.backgroundColor as string;
};

/** The initial glyph the avatar shows for a username. */
const initialFor = (username: string | null | undefined): unknown =>
  render({ username, avatarUrl: null }).props.children?.props.children;

// ─── 3. Tests ───────────────────────────────────────────────────────────

describe('native UserAvatar — username colour assignment', () => {
  it('returns a valid hex color for any non-empty username', () => {
    ['alice', 'bob', 'charlie', 'dave', 'eve', 'frank'].forEach(u => {
      expect(colorFor(u)).toMatch(HEX_REGEX);
    });
  });

  it('same username always returns the same color (deterministic)', () => {
    const results = Array.from({ length: 20 }, () => colorFor('deterministicUser'));
    results.forEach(c => expect(c).toBe(results[0]));
  });

  it('empty string returns the slate fallback', () => {
    expect(colorFor('')).toBe(FALLBACK_COLOR);
  });

  it('null and undefined usernames also take the fallback', () => {
    // The component coerces both to '' before hashing, so a profile with
    // no username still gets a stable swatch rather than crashing.
    expect(colorFor(null)).toBe(FALLBACK_COLOR);
    expect(colorFor(undefined)).toBe(FALLBACK_COLOR);
  });

  it('different usernames can return different colors', () => {
    const colors = ['alice', 'bob', 'charlie', 'dave', 'eve'].map(colorFor);
    // Not guaranteed for an arbitrary small set, but reliable for these.
    expect(new Set(colors).size).toBeGreaterThanOrEqual(3);
  });

  it('all 14 colors in the palette are reachable', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const username = `user${i}-${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(65 + (i % 26))}`;
      seen.add(colorFor(username));
    }
    COLORS.forEach(c => expect(seen.has(c)).toBe(true));
  });

  it('only ever assigns colors from the pinned palette', () => {
    const allowed = new Set([...COLORS, FALLBACK_COLOR]);
    for (let i = 0; i < 200; i++) {
      expect(allowed.has(colorFor(`sample_${i}`))).toBe(true);
    }
  });

  it('very long username (1000+ chars) does not crash', () => {
    const long = 'a'.repeat(1050);
    expect(() => colorFor(long)).not.toThrow();
    expect(colorFor(long)).toMatch(HEX_REGEX);
  });

  it('unicode usernames work', () => {
    ['ñuñoa', 'über', '中文', '日本語', '한국어', 'русский', 'عربي', 'emoji_😀_user'].forEach(u => {
      expect(colorFor(u)).toMatch(HEX_REGEX);
    });
  });

  it('single-character username works', () => {
    const color = colorFor('x');
    expect(color).toMatch(HEX_REGEX);
    expect(color).not.toBe(FALLBACK_COLOR);
  });

  it('username with numbers and underscores works', () => {
    ['user_123', 'my_name_42', '_test_', '1_2_3', 'hello_world_99'].forEach(u => {
      expect(colorFor(u)).toMatch(HEX_REGEX);
    });
  });

  it('palette has exactly 14 entries', () => {
    expect(COLORS).toHaveLength(14);
  });
});

describe('native UserAvatar — initial glyph', () => {
  it('uses the uppercased first character of the username', () => {
    expect(initialFor('alice')).toBe('A');
    expect(initialFor('Bob')).toBe('B');
    expect(initialFor('_underscore')).toBe('_');
  });

  it('falls back to "?" when there is no username', () => {
    expect(initialFor('')).toBe('?');
    expect(initialFor(null)).toBe('?');
    expect(initialFor(undefined)).toBe('?');
  });
});
