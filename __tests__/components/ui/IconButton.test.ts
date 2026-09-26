//
// target: __tests__/components/ui/IconButton.test.ts
// The icon-only control — components/native/ui/IconButton.
//
// Invoked as a plain function, like the other primitive suites: Pressable's
// style is a function of press state, so the helpers resolve it for both
// states without a renderer.

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

import IconButton, {
  badgeLabel,
  BADGE_MAX,
  ICON_BUTTON_SIZE,
  DISABLED_OPACITY,
  PRESSED_OPACITY,
} from '../../../components/native/ui/IconButton';
import type { IconButtonProps } from '../../../components/native/ui/IconButton';
import { color } from '../../../theme/tokens';

// ─── 2. Helpers ─────────────────────────────────────────────────────────

type PressState = { pressed: boolean };

type Child = React.ReactElement<{ style: unknown; children?: React.ReactNode }> | false | null;

type IconButtonElement = React.ReactElement<{
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityHint?: string;
  disabled?: boolean;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  accessibilityState?: { disabled?: boolean };
  style: (state: PressState) => unknown;
  children: [React.ReactNode, Child];
}>;

const icon = React.createElement('svg', { 'data-icon': 'bell' });

const baseProps: IconButtonProps = { icon, accessibilityLabel: 'Notifications' };

const render = (props: Partial<IconButtonProps> = {}): IconButtonElement =>
  (IconButton as unknown as (p: IconButtonProps) => IconButtonElement)({
    ...baseProps,
    ...props,
  });

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

const styleOf = (props: Partial<IconButtonProps> = {}, pressed = false) =>
  flatten(render(props).props.style({ pressed }));

/** The badge element, or a falsy value when none is drawn. */
const badgeOf = (props: Partial<IconButtonProps>) => render(props).props.children[1];

// ─── 3. The acceptance criterion: a label is required ───────────────────

describe('IconButton — accessibility', () => {
  it('rejects a missing accessibilityLabel at compile time', () => {
    // The assertion is the directive: if accessibilityLabel ever became
    // optional, this line would stop being an error and tsc would fail on
    // the unused @ts-expect-error.
    // @ts-expect-error accessibilityLabel is required
    const props: IconButtonProps = { icon };
    expect(props.icon).toBe(icon);
  });

  it('announces itself as a button with its label', () => {
    const el = render();
    expect(el.props.accessibilityRole).toBe('button');
    expect(el.props.accessibilityLabel).toBe('Notifications');
  });
});

// ─── 4. The 44pt target ─────────────────────────────────────────────────

describe('IconButton — hit area', () => {
  it('is at least 44×44pt', () => {
    expect(ICON_BUTTON_SIZE).toBeGreaterThanOrEqual(44);
    const style = styleOf();
    expect(style.width).toBe(ICON_BUTTON_SIZE);
    expect(style.height).toBe(ICON_BUTTON_SIZE);
  });

  it('centres the icon it is given', () => {
    const style = styleOf();
    expect(style.alignItems).toBe('center');
    expect(style.justifyContent).toBe('center');
    expect(render().props.children[0]).toBe(icon);
  });
});

// ─── 5. Press behaviour ─────────────────────────────────────────────────

describe('IconButton — press behaviour', () => {
  it('fires onPress when enabled', () => {
    const onPress = jest.fn();
    render({ onPress }).props.onPress?.();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire onPress when disabled, and says so to assistive tech', () => {
    const onPress = jest.fn();
    const el = render({ onPress, disabled: true });
    el.props.onPress?.();
    expect(onPress).not.toHaveBeenCalled();
    expect(el.props.disabled).toBe(true);
    expect(el.props.accessibilityState).toEqual({ disabled: true });
  });

  it('passes a long press and its hint through, but not when disabled', () => {
    const onLongPress = jest.fn();
    const el = render({ onLongPress, accessibilityHint: 'Shows who liked this' });
    el.props.onLongPress?.();
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(el.props.accessibilityHint).toBe('Shows who liked this');
    expect(render({ onLongPress, disabled: true }).props.onLongPress).toBeUndefined();
  });

  it('dims while pressed, and dims further when disabled', () => {
    expect(styleOf({}, true).opacity).toBe(PRESSED_OPACITY);
    expect(styleOf({}, false).opacity).toBeUndefined();
    expect(styleOf({ disabled: true }, true).opacity).toBe(DISABLED_OPACITY);
  });
});

// ─── 6. Badge ───────────────────────────────────────────────────────────

describe('IconButton — badge', () => {
  it('draws no badge without a count, or at zero', () => {
    expect(badgeOf({})).toBeFalsy();
    expect(badgeOf({ badge: 0 })).toBeFalsy();
    expect(badgeOf({ badge: -3 })).toBeFalsy();
  });

  it('shows the count on a heart fill in inverse text', () => {
    const badge = badgeOf({ badge: 7 }) as React.ReactElement<{
      style: unknown;
      children: React.ReactElement<{ style: unknown; children: string }>;
    }>;
    expect(flatten(badge.props.style).backgroundColor).toBe(color.heart);
    expect(badge.props.children.props.children).toBe('7');
    expect(flatten(badge.props.children.props.style).color).toBe(color.inverse);
  });

  it('overflows to 99+ above 99, the same rule as the tab bar', () => {
    expect(BADGE_MAX).toBe(99);
    expect(badgeLabel(99)).toBe('99');
    expect(badgeLabel(100)).toBe('99+');
    expect(badgeLabel(5000)).toBe('99+');
  });

  it('badgeLabel hides nothing-to-show counts', () => {
    expect(badgeLabel(undefined)).toBeNull();
    expect(badgeLabel(null)).toBeNull();
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(1)).toBe('1');
  });
});
