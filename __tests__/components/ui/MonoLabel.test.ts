//
// target: __tests__/components/ui/MonoLabel.test.ts
// The recurring micro-label — components/native/ui/MonoLabel.
//
// Invokes the component as a plain function and inspects the element it
// builds, so no renderer is needed and the suite stays inside the project's
// "no React Native at runtime" Jest config. The component body really does
// run, so the token lookups are exercised rather than assumed.

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

import MonoLabel, { letterSpacingFor } from '../../../components/native/ui/MonoLabel';
import type { MonoLabelProps } from '../../../components/native/ui/MonoLabel';
import { color, type } from '../../../theme/tokens';

// ─── 2. Helpers ─────────────────────────────────────────────────────────

type LabelElement = React.ReactElement<{
  style: unknown;
  children: React.ReactNode;
  numberOfLines?: number;
}>;

const render = (props: MonoLabelProps): LabelElement =>
  (MonoLabel as unknown as (p: MonoLabelProps) => LabelElement)(props);

/** Merge a style array the way React Native would, so order still wins. */
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

const styleOf = (props: MonoLabelProps) => flatten(render(props).props.style);

// ─── 3. Renders ─────────────────────────────────────────────────────────

describe('MonoLabel — rendering', () => {
  it('renders without crashing', () => {
    expect(() => render({ children: 'Scan history' })).not.toThrow();
  });

  it('renders its children', () => {
    expect(render({ children: 'Scan history' }).props.children).toBe('Scan history');
  });

  it('passes numberOfLines through for truncation', () => {
    expect(render({ children: 'Scan history', numberOfLines: 1 }).props.numberOfLines).toBe(1);
  });
});

// ─── 4. The treatment itself ────────────────────────────────────────────

describe('MonoLabel — the micro-label treatment', () => {
  it('is DM Mono and uppercase', () => {
    const style = styleOf({ children: 'Tag' });
    expect(style.fontFamily).toBe(type.mono);
    expect(style.textTransform).toBe('uppercase');
  });

  it('defaults to the monoLabel token size and tracking', () => {
    const style = styleOf({ children: 'Tag' });
    expect(style.fontSize).toBe(type.monoLabel.fontSize);
    expect(style.letterSpacing).toBe(type.monoLabel.letterSpacing);
  });

  it('defaults to textMuted', () => {
    expect(styleOf({ children: 'Tag' }).color).toBe(color.textMuted);
  });
});

// ─── 5. Tracking scales with size ───────────────────────────────────────

describe('MonoLabel — tracking scales with size', () => {
  it('keeps the 0.18em proportion at any size', () => {
    // A label bumped to 14px should be letterspaced as generously as the
    // 10px default, not left with the 10px value and looking cramped.
    for (const size of [10, 12, 14, 20]) {
      expect(letterSpacingFor(size)).toBeCloseTo(size * 0.18, 5);
    }
  });

  it('applies the derived tracking, not the raw token, for a custom size', () => {
    const style = styleOf({ children: 'Tag', size: 20 });
    expect(style.fontSize).toBe(20);
    expect(style.letterSpacing).toBeCloseTo(3.6, 5);
    expect(style.letterSpacing).not.toBe(type.monoLabel.letterSpacing);
  });
});

// ─── 6. Colour is a token key, never a hex string ───────────────────────

describe('MonoLabel — colour', () => {
  it('resolves a token key to its token value', () => {
    expect(styleOf({ children: 'Tag', color: 'text' }).color).toBe(color.text);
    expect(styleOf({ children: 'Tag', color: 'inverse' }).color).toBe(color.inverse);
    expect(styleOf({ children: 'Tag', color: 'heart' }).color).toBe(color.heart);
  });

  it('accepts every colour token', () => {
    for (const key of Object.keys(color) as (keyof typeof color)[]) {
      expect(styleOf({ children: 'Tag', color: key }).color).toBe(color[key]);
    }
  });

  it('caller style overrides win over the defaults', () => {
    // The style prop is applied last so a screen can nudge a label without
    // forking the component.
    expect(styleOf({ children: 'Tag', style: { fontSize: 99 } }).fontSize).toBe(99);
  });
});
