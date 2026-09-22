//
// target: __tests__/components/ui/Divider.test.ts
// The hairline rule — components/native/ui/Divider.

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
}, { virtual: true });

import Divider from '../../../components/native/ui/Divider';
import type { DividerProps } from '../../../components/native/ui/Divider';
import { color, space } from '../../../theme/tokens';

// ─── 2. Helpers ─────────────────────────────────────────────────────────

type DividerElement = React.ReactElement<{ style: unknown }>;

const render = (props: DividerProps = {}): DividerElement =>
  (Divider as unknown as (p: DividerProps) => DividerElement)(props);

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

const styleOf = (props: DividerProps = {}) => flatten(render(props).props.style);

// ─── 3. Renders ─────────────────────────────────────────────────────────

describe('Divider — rendering', () => {
  it('renders without crashing with no props at all', () => {
    expect(() => render()).not.toThrow();
  });

  it('is a 1px rule in the border colour', () => {
    const style = styleOf();
    expect(style.height).toBe(1);
    expect(style.backgroundColor).toBe(color.border);
  });

  it('stretches across its container', () => {
    expect(styleOf().alignSelf).toBe('stretch');
  });
});

// ─── 4. Inset ───────────────────────────────────────────────────────────

describe('Divider — inset', () => {
  it('has no horizontal margin by default, so it runs edge to edge', () => {
    expect(styleOf().marginHorizontal).toBeUndefined();
  });

  it('resolves every space token key as horizontal margin', () => {
    for (const key of Object.keys(space) as (keyof typeof space)[]) {
      expect(styleOf({ inset: key }).marginHorizontal).toBe(space[key]);
    }
  });

  it('a caller style override still wins', () => {
    expect(styleOf({ inset: 'lg', style: { marginHorizontal: 2 } }).marginHorizontal).toBe(2);
  });
});
