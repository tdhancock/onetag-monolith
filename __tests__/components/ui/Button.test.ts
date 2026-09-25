//
// target: __tests__/components/ui/Button.test.ts
// The squared-off button — components/native/ui/Button.
//
// Invokes the component as a plain function and inspects the element it
// builds. Pressable's `style` is a function of press state, so the helpers
// below call it for both states — which is also how the pressed and disabled
// treatments get exercised without a renderer.

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
    ActivityIndicator: passthrough('progress'),
    StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
  };
}, { virtual: true });

import Button, { DISABLED_OPACITY, PRESSED_OPACITY } from '../../../components/native/ui/Button';
import type { ButtonProps } from '../../../components/native/ui/Button';
import MonoLabel from '../../../components/native/ui/MonoLabel';
import { color, radius } from '../../../theme/tokens';

// ─── 2. Helpers ─────────────────────────────────────────────────────────

type PressState = { pressed: boolean };

type ButtonElement = React.ReactElement<{
  onPress?: () => void;
  disabled?: boolean;
  accessibilityRole?: string;
  accessibilityState?: { disabled?: boolean };
  style: (state: PressState) => unknown;
  children: React.ReactElement<{ children: React.ReactNode; size?: number; color?: string }>;
}>;

const render = (props: ButtonProps): ButtonElement =>
  (Button as unknown as (p: ButtonProps) => ButtonElement)(props);

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

/** Resolve Pressable's style function for a given press state. */
const styleOf = (props: ButtonProps, pressed = false) =>
  flatten(render(props).props.style({ pressed }));

/** The MonoLabel element the button wraps its children in. */
const labelOf = (props: ButtonProps) => render(props).props.children;

// ─── 3. Renders ─────────────────────────────────────────────────────────

describe('Button — rendering', () => {
  it('renders without crashing', () => {
    expect(() => render({ children: 'Create tag', onPress: () => {} })).not.toThrow();
  });

  it('renders its label through MonoLabel, so the treatment is never re-rolled', () => {
    const label = labelOf({ children: 'Create tag' });
    expect(label.type).toBe(MonoLabel);
    expect(label.props.children).toBe('Create tag');
  });

  it('announces itself as a button', () => {
    expect(render({ children: 'Create tag' }).props.accessibilityRole).toBe('button');
  });
});

// ─── 4. Variants ────────────────────────────────────────────────────────

describe('Button — variants', () => {
  it('primary is filled ink with an inverse label', () => {
    const style = styleOf({ children: 'Create tag', variant: 'primary' });
    expect(style.backgroundColor).toBe(color.text);
    expect(labelOf({ children: 'Create tag', variant: 'primary' }).props.color).toBe('inverse');
  });

  it('outline is a transparent hairline box with an ink label', () => {
    const style = styleOf({ children: 'Create tag', variant: 'outline' });
    expect(style.backgroundColor).toBe('transparent');
    expect(style.borderColor).toBe(color.border);
    expect(style.borderWidth).toBe(1);
    expect(labelOf({ children: 'Create tag', variant: 'outline' }).props.color).toBe('text');
  });

  it('inverse is a white fill with an ink label, for dark media', () => {
    const style = styleOf({ children: 'Share OneSnap', variant: 'inverse' });
    expect(style.backgroundColor).toBe(color.inverse);
    expect(style.borderColor).toBe(color.inverse);
    expect(labelOf({ children: 'Share OneSnap', variant: 'inverse' }).props.color).toBe('text');
  });

  it('defaults to primary', () => {
    expect(styleOf({ children: 'Create tag' }).backgroundColor).toBe(color.text);
  });

  it('is square-cornered in both variants', () => {
    expect(styleOf({ children: 'x', variant: 'primary' }).borderRadius).toBe(radius.none);
    expect(styleOf({ children: 'x', variant: 'outline' }).borderRadius).toBe(radius.none);
    expect(radius.none).toBe(0);
  });
});

// ─── 5. Press behaviour — the acceptance criterion ──────────────────────

describe('Button — press behaviour', () => {
  it('fires onPress when enabled', () => {
    const onPress = jest.fn();
    render({ children: 'Create tag', onPress }).props.onPress?.();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onPress when disabled', () => {
    // The acceptance criterion: a disabled primary button must not fire.
    const onPress = jest.fn();
    render({ children: 'Create tag', variant: 'primary', onPress, disabled: true })
      .props.onPress?.();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not fire when disabled in the outline variant either', () => {
    const onPress = jest.fn();
    render({ children: 'Create tag', variant: 'outline', onPress, disabled: true })
      .props.onPress?.();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('also marks the control disabled for the platform and for assistive tech', () => {
    // The internal guard is belt-and-braces; the Pressable must still be
    // told, or the control stays focusable and reads as actionable.
    const el = render({ children: 'Create tag', onPress: () => {}, disabled: true });
    expect(el.props.disabled).toBe(true);
    expect(el.props.accessibilityState).toEqual({ disabled: true, busy: false });
  });

  it('survives being pressed with no handler supplied', () => {
    expect(() => render({ children: 'Create tag' }).props.onPress?.()).not.toThrow();
  });
});

// ─── 6. Disabled and pressed are visually distinct ──────────────────────

describe('Button — state treatments', () => {
  it('dims when disabled', () => {
    expect(styleOf({ children: 'x', disabled: true }).opacity).toBe(DISABLED_OPACITY);
    expect(styleOf({ children: 'x' }).opacity).toBeUndefined();
  });

  it('dims while pressed', () => {
    expect(styleOf({ children: 'x' }, true).opacity).toBe(PRESSED_OPACITY);
  });

  it('does not apply the pressed treatment on top of the disabled one', () => {
    // A disabled control cannot be pressed; if both applied, the disabled
    // dimming would be overwritten by the lighter pressed value.
    expect(styleOf({ children: 'x', disabled: true }, true).opacity).toBe(DISABLED_OPACITY);
  });
});

// ─── 7. Loading ─────────────────────────────────────────────────────────

describe('Button — loading', () => {
  type Wrapper = React.ReactElement<{ children: [React.ReactElement<{ style: unknown }>, React.ReactElement<{ color: string }>] }>;

  it('keeps the label in place but invisible, with a spinner over it in the label colour', () => {
    const wrapper = render({ children: 'Post', loading: true }).props.children as unknown as Wrapper;
    const [label, spinner] = wrapper.props.children;
    expect(label.type).toBe(MonoLabel);
    expect(flatten(label.props.style).opacity).toBe(0);
    expect(spinner.props.color).toBe(color.inverse);
  });

  it('ignores presses and says it is busy, without the disabled dimming', () => {
    const onPress = jest.fn();
    const el = render({ children: 'Post', loading: true, onPress });
    el.props.onPress?.();
    expect(onPress).not.toHaveBeenCalled();
    expect(el.props.disabled).toBe(true);
    expect(el.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(styleOf({ children: 'Post', loading: true }).opacity).toBeUndefined();
  });

  it('is off by default', () => {
    expect(render({ children: 'Post' }).props.accessibilityState).toEqual({ disabled: false, busy: false });
  });
});

// ─── 8. Size and width ──────────────────────────────────────────────────

describe('Button — size and width', () => {
  it('sm is tighter than md', () => {
    const sm = styleOf({ children: 'x', size: 'sm' });
    const md = styleOf({ children: 'x', size: 'md' });
    expect(sm.paddingVertical as number).toBeLessThan(md.paddingVertical as number);
    expect(sm.paddingHorizontal as number).toBeLessThan(md.paddingHorizontal as number);
  });

  it('sm carries a smaller label than md', () => {
    const sm = labelOf({ children: 'x', size: 'sm' }).props.size as number;
    const md = labelOf({ children: 'x', size: 'md' }).props.size as number;
    expect(sm).toBeLessThan(md);
  });

  it('defaults to md', () => {
    expect(styleOf({ children: 'x' })).toEqual(styleOf({ children: 'x', size: 'md' }));
  });

  it('fullWidth stretches, and is off by default', () => {
    expect(styleOf({ children: 'x', fullWidth: true }).width).toBe('100%');
    expect(styleOf({ children: 'x' }).width).toBeUndefined();
  });
});
