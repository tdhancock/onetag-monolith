//
// target: __tests__/components/ui/ListRow.test.ts
// The standard list row — components/native/ui/ListRow.
//
// Like Card, the row changes shape with onPress: a plain View without it, a
// Pressable with it. Both branches are exercised.

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
    Pressable: passthrough('button'),
    StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
  };
});

jest.mock('expo-image', () => require('../../support/expoImageStub'));
// The barrel reaches the icons (ListRow, Sheet), and through them react-native-svg.
jest.mock('react-native-svg', () => require('../../support/reactNativeSvgStub'));

import ListRow, {
  LIST_ROW_MIN_HEIGHT,
  LIST_ROW_AVATAR_SIZE,
  PRESSED_BACKGROUND,
} from '../../../components/native/ui/ListRow';
import type { ListRowProps } from '../../../components/native/ui/ListRow';
import Pressable from '../../../components/native/ui/Pressable';
import Avatar from '../../../components/native/ui/Avatar';
import { color, space, type } from '../../../theme/tokens';

// ─── 2. Helpers ─────────────────────────────────────────────────────────

type PressState = { pressed: boolean };

type Node = React.ReactElement<{
  style?: unknown;
  children?: React.ReactNode;
  [key: string]: unknown;
}>;

type RowElement = React.ReactElement<{
  style: unknown;
  onPress?: () => void;
  accessible?: boolean;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  children: React.ReactElement<{ children: [Node, Node, Node | null] }>;
}> & { type: unknown };

const render = (props: ListRowProps): RowElement =>
  (ListRow as unknown as (p: ListRowProps) => RowElement)(props);

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

const styleOf = (props: ListRowProps, pressed = false) => {
  const style = render(props).props.style;
  return flatten(
    typeof style === 'function' ? (style as (s: PressState) => unknown)({ pressed }) : style,
  );
};

/** [leading, text column, trailing] — the fragment's three slots. */
const slotsOf = (props: ListRowProps) => render(props).props.children.props.children;

/** [title, subtitle?] — the title sits in its row beside the verified mark. */
const textsOf = (props: ListRowProps) => {
  const [titleRow, ...rest] = React.Children.toArray(slotsOf(props)[1].props.children) as Node[];
  const [title] = React.Children.toArray(titleRow.props.children) as Node[];
  return [title, ...rest];
};

const verifiedOf = (props: ListRowProps) => {
  const [titleRow] = React.Children.toArray(slotsOf(props)[1].props.children) as Node[];
  return (React.Children.toArray(titleRow.props.children) as Node[])[1];
};

// ─── 3. Structure ───────────────────────────────────────────────────────

describe('ListRow — structure', () => {
  it('leads with a 40pt Avatar whose initials fall back to the title', () => {
    const [leading] = slotsOf({ title: 'Jordan Reeves', avatarUri: 'https://x/a.jpg' });
    expect(leading.type).toBe(Avatar);
    expect(leading.props.size).toBe(LIST_ROW_AVATAR_SIZE);
    expect(LIST_ROW_AVATAR_SIZE).toBe(40);
    expect(leading.props.uri).toBe('https://x/a.jpg');
    expect(leading.props.name).toBe('Jordan Reeves');
  });

  it('lets a leading node replace the avatar', () => {
    const leading = React.createElement('svg', { 'data-icon': 'camera' });
    expect(slotsOf({ title: 'Camera', leading })[0]).toBe(leading);
  });

  it('sets the title in bold 15 ink and the subtitle in 13 textMid', () => {
    const [title, subtitle] = textsOf({ title: 'Jordan Reeves', subtitle: '@jordan' });
    expect(title.props.children).toBe('Jordan Reeves');
    expect(flatten(title.props.style)).toMatchObject({
      fontFamily: type.bodyBold,
      fontSize: 15,
      color: color.text,
    });
    expect(subtitle.props.children).toBe('@jordan');
    expect(flatten(subtitle.props.style)).toMatchObject({ fontSize: 13, color: color.textMid });
  });

  it('omits the subtitle line when there is none', () => {
    expect(textsOf({ title: 'Jordan Reeves' })).toHaveLength(1);
  });

  it('draws an ink verified mark after the title only when asked', () => {
    expect(verifiedOf({ title: 'x' })).toBeUndefined();
    const mark = verifiedOf({ title: 'x', verified: true });
    expect(mark.props.accessibilityLabel).toBe('Verified');
  });

  it('spaces the text md away from the leading node', () => {
    expect(flatten(slotsOf({ title: 'x' })[1].props.style).marginLeft).toBe(space.md);
  });

  it('renders a trailing node only when given one', () => {
    expect(slotsOf({ title: 'x' })[2]).toBeNull();
    const trailing = React.createElement('span', null, '2h');
    const slot = slotsOf({ title: 'x', trailing })[2] as Node;
    expect(slot.props.children).toBe(trailing);
  });
});

// ─── 4. Size and divider ────────────────────────────────────────────────

describe('ListRow — size and divider', () => {
  it('is at least 56pt tall', () => {
    expect(LIST_ROW_MIN_HEIGHT).toBeGreaterThanOrEqual(56);
    expect(styleOf({ title: 'x' }).minHeight).toBe(LIST_ROW_MIN_HEIGHT);
  });

  it('pads the screen edge by lg', () => {
    expect(styleOf({ title: 'x' }).paddingHorizontal).toBe(space.lg);
  });

  it('draws a hairline only when asked', () => {
    expect(styleOf({ title: 'x' }).borderBottomWidth).toBeUndefined();
    const style = styleOf({ title: 'x', divider: true });
    expect(style.borderBottomWidth).toBe(1);
    expect(style.borderBottomColor).toBe(color.border);
  });
});

// ─── 5. Press behaviour ─────────────────────────────────────────────────

describe('ListRow — press behaviour', () => {
  it('is a plain view with no onPress', () => {
    expect((render({ title: 'x' }).type as { displayName?: string }).displayName).toBe('div');
  });

  it('keeps its label as a plain view, read as one element (ONE-87)', () => {
    const el = render({ title: 'Oak door', subtitle: 'Product · Scanned once', accessibilityLabel: 'Oak door, Product' });
    expect((el.type as { displayName?: string }).displayName).toBe('div');
    expect(el.props.accessible).toBe(true);
    expect(el.props.accessibilityLabel).toBe('Oak door, Product');
    expect(el.props.accessibilityRole).toBeUndefined();
  });

  it('leaves an unnamed plain view\'s parts to be read on their own', () => {
    const el = render({ title: 'x' });
    expect(el.props.accessible).toBeUndefined();
    expect(el.props.accessibilityLabel).toBeUndefined();
  });

  it('becomes a labelled button with onPress, and fires it', () => {
    const onPress = jest.fn();
    const el = render({ title: 'x', onPress, accessibilityLabel: 'Open x' });
    expect(el.type).toBe(Pressable);
    expect(el.props.accessibilityRole).toBe('button');
    expect(el.props.accessibilityLabel).toBe('Open x');
    el.props.onPress?.();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('gives press feedback on the background', () => {
    const onPress = () => {};
    expect(styleOf({ title: 'x', onPress }, false).backgroundColor).toBe(color.bg);
    expect(styleOf({ title: 'x', onPress }, true).backgroundColor).toBe(PRESSED_BACKGROUND);
  });
});
