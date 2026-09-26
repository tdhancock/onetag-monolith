//
// target: __tests__/components/ui/Avatar.test.ts
// The circular avatar with an initials fallback — components/native/ui/Avatar.
//
// Two branches: an expo-image <Image> when a uri is present, a <View>/<Text>
// initials badge when it is not. Both are exercised, along with the initials
// derivation itself, which is the part every screen will lean on.

import React from 'react';

// ─── 1. Mock the native runtime ─────────────────────────────────────────

jest.mock('react-native', () => {
  const React = require('react');
  const passthrough = (name: string) => {
    const C: React.FC<Record<string, unknown>> = (props) =>
      React.createElement(name, props, props.children as React.ReactNode);
    C.displayName = name;
    return C;
  };
  return {
    __esModule: true,
    View: passthrough('div'),
    Text: passthrough('span'),
    StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
  };
});

jest.mock('expo-image', () => require('../../support/expoImageStub'));

import Avatar, {
  initialsFrom,
  DEFAULT_AVATAR_SIZE,
  INITIALS_FALLBACK,
} from '../../../components/native/ui/Avatar';
import type { AvatarProps } from '../../../components/native/ui/Avatar';
import { color, type } from '../../../theme/tokens';

// ─── 2. Helpers ─────────────────────────────────────────────────────────

type AvatarElement = React.ReactElement<{
  style: unknown;
  source?: { uri: string };
  contentFit?: string;
  accessibilityLabel?: string;
  children?: React.ReactElement<{ children: React.ReactNode; style: unknown }>;
}> & { type: { displayName?: string } };

const render = (props: AvatarProps = {}): AvatarElement =>
  (Avatar as unknown as (p: AvatarProps) => AvatarElement)(props);

const flatten = (style: unknown): Record<string, unknown> => {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, entry) => Object.assign(acc, flatten(entry)),
      {},
    );
  }
  if (style && typeof style === 'object') return style as Record<string, unknown>;
  return {};
};

const styleOf = (props: AvatarProps = {}) => flatten(render(props).props.style);

/** The initials string a fallback avatar actually displays. */
const displayedInitials = (props: AvatarProps) =>
  render(props).props.children?.props.children;

// ─── 3. Renders ─────────────────────────────────────────────────────────

describe('Avatar — rendering', () => {
  it('renders without crashing with no props at all', () => {
    expect(() => render()).not.toThrow();
  });

  it('renders the initials badge when there is no uri', () => {
    expect(render({ name: 'Jordan Reeves' }).type.displayName).toBe('div');
  });

  it('renders an image when a uri is present', () => {
    const el = render({ uri: 'https://example.test/a.jpg', name: 'Jordan Reeves' });
    expect(el.type.displayName).toBe('Image');
    expect(el.props.source).toEqual({ uri: 'https://example.test/a.jpg' });
    expect(el.props.contentFit).toBe('cover');
  });

  it('labels the image with the name for assistive tech', () => {
    const el = render({ uri: 'https://example.test/a.jpg', name: 'Jordan Reeves' });
    expect(el.props.accessibilityLabel).toBe('Jordan Reeves');
  });
});

// ─── 4. Initials — the acceptance criterion ─────────────────────────────

describe('Avatar — initials fallback', () => {
  it('displays JR for "Jordan Reeves" with no uri', () => {
    // The acceptance criterion, asserted through the rendered element rather
    // than the helper alone.
    expect(displayedInitials({ name: 'Jordan Reeves' })).toBe('JR');
  });

  it('takes the first letter of the first two words', () => {
    expect(initialsFrom('Jordan Reeves')).toBe('JR');
    expect(initialsFrom('ada lovelace')).toBe('AL');
    expect(initialsFrom('Jordan Michael Reeves')).toBe('JM');
  });

  it('uses a single letter for a single word', () => {
    expect(initialsFrom('Jordan')).toBe('J');
    expect(displayedInitials({ name: 'Jordan' })).toBe('J');
  });

  it('tolerates ragged whitespace', () => {
    expect(initialsFrom('  Jordan   Reeves  ')).toBe('JR');
  });

  it('falls back to ? rather than rendering a blank badge', () => {
    expect(initialsFrom(undefined)).toBe(INITIALS_FALLBACK);
    expect(initialsFrom(null)).toBe(INITIALS_FALLBACK);
    expect(initialsFrom('')).toBe(INITIALS_FALLBACK);
    expect(initialsFrom('   ')).toBe(INITIALS_FALLBACK);
    expect(displayedInitials({})).toBe(INITIALS_FALLBACK);
  });

  it('renders the initials in DM Mono', () => {
    const style = flatten(render({ name: 'Jordan Reeves' }).props.children?.props.style);
    expect(style.fontFamily).toBe(type.mono);
    expect(style.color).toBe(color.textMid);
  });
});

// ─── 5. Circular — the deliberate exception ─────────────────────────────

describe('Avatar — stays circular', () => {
  it('is a circle at the default size', () => {
    const style = styleOf();
    expect(style.width).toBe(DEFAULT_AVATAR_SIZE);
    expect(style.height).toBe(DEFAULT_AVATAR_SIZE);
    expect(style.borderRadius).toBe(DEFAULT_AVATAR_SIZE / 2);
  });

  it('stays a circle at any size, in both branches', () => {
    // Square corners are the house style everywhere else; avatars are the
    // documented exception, so a radius of 0 here would be the regression.
    for (const size of [24, 40, 96]) {
      for (const props of [{ size }, { size, uri: 'https://example.test/a.jpg' }]) {
        const style = styleOf(props);
        expect(style.borderRadius).toBe(size / 2);
        expect(style.width).toBe(size);
      }
    }
  });

  it('gives the fallback badge a panel ground and a hairline edge', () => {
    const style = styleOf({ name: 'Jordan Reeves' });
    expect(style.backgroundColor).toBe(color.bgPanel);
    expect(style.borderColor).toBe(color.border);
    expect(style.borderWidth).toBe(1);
  });

  it('scales the initials with the badge', () => {
    const small = flatten(render({ name: 'JR', size: 24 }).props.children?.props.style);
    const large = flatten(render({ name: 'JR', size: 96 }).props.children?.props.style);
    expect(small.fontSize as number).toBeLessThan(large.fontSize as number);
  });
});
