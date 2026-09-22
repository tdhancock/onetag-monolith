//
// target: __tests__/components/ui/Card.test.ts
// The hairline-bordered panel — components/native/ui/Card.
//
// Card changes shape depending on whether onPress is supplied: a plain View
// without it, a Pressable with it. Both branches are exercised here, because
// the static case is the common one and must not quietly become a touch
// target.

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
}, { virtual: true });

import Card, { PRESSED_OPACITY } from '../../../components/native/ui/Card';
import type { CardProps } from '../../../components/native/ui/Card';
import { color, radius, space } from '../../../theme/tokens';

// ─── 2. Helpers ─────────────────────────────────────────────────────────

type PressState = { pressed: boolean };

type CardElement = React.ReactElement<{
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityRole?: string;
  style: unknown;
}> & { type: { displayName?: string } };

const render = (props: CardProps): CardElement =>
  (Card as unknown as (p: CardProps) => CardElement)(props);

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

/** Resolve the style whether it is a plain array (View) or a function (Pressable). */
const styleOf = (props: CardProps, pressed = false) => {
  const style = render(props).props.style;
  return flatten(
    typeof style === 'function'
      ? (style as (s: PressState) => unknown)({ pressed })
      : style,
  );
};

const displayNameOf = (props: CardProps) => render(props).type.displayName;

// ─── 3. Renders ─────────────────────────────────────────────────────────

describe('Card — rendering', () => {
  it('renders without crashing', () => {
    expect(() => render({ children: 'Anything' })).not.toThrow();
  });

  it('renders its children', () => {
    expect(render({ children: 'Anything' }).props.children).toBe('Anything');
  });

  it('renders its children in the pressable branch too', () => {
    expect(render({ children: 'Anything', onPress: () => {} }).props.children).toBe('Anything');
  });
});

// ─── 4. The surface treatment ───────────────────────────────────────────

describe('Card — surface', () => {
  it('sits on the page ground behind a hairline rule', () => {
    const style = styleOf({ children: 'x' });
    expect(style.backgroundColor).toBe(color.bg);
    expect(style.borderColor).toBe(color.border);
    expect(style.borderWidth).toBe(1);
  });

  it('is square-cornered', () => {
    expect(styleOf({ children: 'x' }).borderRadius).toBe(radius.none);
  });

  it('keeps the same surface treatment when pressable', () => {
    const style = styleOf({ children: 'x', onPress: () => {} });
    expect(style.backgroundColor).toBe(color.bg);
    expect(style.borderColor).toBe(color.border);
    expect(style.borderRadius).toBe(radius.none);
  });
});

// ─── 5. Padding comes from the space scale ──────────────────────────────

describe('Card — padding', () => {
  it('defaults to lg', () => {
    expect(styleOf({ children: 'x' }).padding).toBe(space.lg);
  });

  it('resolves every space token key', () => {
    for (const key of Object.keys(space) as (keyof typeof space)[]) {
      expect(styleOf({ children: 'x', padding: key }).padding).toBe(space[key]);
    }
  });
});

// ─── 6. Pressable only when it has somewhere to go ──────────────────────

describe('Card — press behaviour', () => {
  it('is a plain view with no onPress, so it never traps a touch', () => {
    expect(displayNameOf({ children: 'x' })).toBe('div');
    expect(render({ children: 'x' }).props.onPress).toBeUndefined();
  });

  it('becomes pressable when onPress is supplied', () => {
    expect(displayNameOf({ children: 'x', onPress: () => {} })).toBe('button');
    expect(render({ children: 'x', onPress: () => {} }).props.accessibilityRole).toBe('button');
  });

  it('fires onPress', () => {
    const onPress = jest.fn();
    render({ children: 'x', onPress }).props.onPress?.();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('gives press feedback only in the pressable branch', () => {
    expect(styleOf({ children: 'x', onPress: () => {} }, true).opacity).toBe(PRESSED_OPACITY);
    expect(styleOf({ children: 'x', onPress: () => {} }, false).opacity).toBeUndefined();
    expect(styleOf({ children: 'x' }, true).opacity).toBeUndefined();
  });
});
