// Shared `react-native` DOM-passthrough shim for jsdom suites.
//
// Maps View/Text to <div>/<span> and flattens RN style arrays into DOM
// style objects, so react-dom can mount native components for assertions.
// An Animated.Value landing in a flattened style is dropped (jsdom rejects
// non-primitive style values) and replaced with a `data-has-opacity-driver`
// marker instead.
//
// This is the DOM-mounting shim — distinct from the Platform-only mock in
// __tests__/services/notifications.test.ts, which has no DOM concerns and
// stays separate.

import React from 'react';

export const flattenStyle = (style: unknown): Record<string, unknown> => {
  if (!style) return {};
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, s) => ({ ...acc, ...flattenStyle(s) }),
      {},
    );
  }
  return style as Record<string, unknown>;
};

const passthroughProps = (props: Record<string, unknown>) => {
  // `accessible` is RN-only; dropping it keeps React's DOM warnings quiet.
  const {
    style,
    children,
    testID,
    className,
    accessible: _accessible,
    accessibilityLabel,
    ...rest
  } = props;
  const domProps: Record<string, unknown> = { ...rest };
  if (typeof accessibilityLabel === 'string') domProps['aria-label'] = accessibilityLabel;
  if (typeof testID === 'string') domProps['data-testid'] = testID;
  if (typeof className === 'string') domProps.className = className;
  const flat = flattenStyle(style);
  if (flat.opacity && typeof flat.opacity === 'object') {
    domProps['data-has-opacity-driver'] = 'true';
    delete flat.opacity;
  }
  domProps.style = flat;
  return domProps;
};

/** Sheets pass through as plain objects; the flattening happens per element. */
export const StyleSheet = {
  create: <T,>(sheet: T): T => sheet,
  flatten: flattenStyle,
  hairlineWidth: 1,
  absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  absoluteFillObject: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
};

export const View: React.FC<React.PropsWithChildren<Record<string, unknown>>> = props =>
  React.createElement('div', passthroughProps(props), props.children);

/**
 * The click handler for something with an onPress. In React Native the
 * innermost touchable claims the touch and the ones around it never fire; a
 * DOM click bubbles instead, so the handler stops it where RN would.
 */
const pressHandler = (onPress: unknown): React.MouseEventHandler | undefined =>
  typeof onPress === 'function'
    ? (event) => {
        event.stopPropagation();
        (onPress as (e: unknown) => void)(event);
      }
    : undefined;

/** A Text with onPress (an inline link, a "more" control) is clickable. */
export const Text: React.FC<React.PropsWithChildren<Record<string, unknown>>> = props => {
  const { onPress, accessibilityLabel, ...rest } = props;
  return React.createElement(
    'span',
    {
      ...passthroughProps(rest),
      onClick: pressHandler(onPress),
      'aria-label': accessibilityLabel as string | undefined,
    },
    props.children,
  );
};

export const Pressable: React.FC<React.PropsWithChildren<Record<string, unknown>>> = props => {
  const { onPress, onLongPress, onPressIn, onPressOut, accessibilityLabel, accessibilityHint, style, ...rest } = props;
  // Pressable takes its style as a function of press state; render the
  // resting state, which is what a mounted-but-untouched control shows.
  const resolvedStyle =
    typeof style === 'function' ? (style as (s: { pressed: boolean }) => unknown)({ pressed: false }) : style;
  return React.createElement(
    'button',
    {
      ...passthroughProps({ ...rest, style: resolvedStyle }),
      onClick: pressHandler(onPress),
      // A long press arrives as a contextmenu event, the nearest DOM analogue.
      onContextMenu: pressHandler(onLongPress),
      'aria-description': accessibilityHint as string | undefined,
      // The finger going down and coming up, for press feedback.
      onMouseDown: onPressIn as React.MouseEventHandler | undefined,
      onMouseUp: onPressOut as React.MouseEventHandler | undefined,
      'aria-label': accessibilityLabel as string | undefined,
    },
    props.children,
  );
};

/** Renders its children inline when visible, nothing when not. */
export const Modal: React.FC<React.PropsWithChildren<Record<string, unknown>>> = props =>
  props.visible === false
    ? null
    : React.createElement('div', { ...passthroughProps(props), 'data-modal': 'true' }, props.children);

/** Maps onChangeText / onFocus / onBlur onto the DOM input's own events. */
export const TextInput = React.forwardRef<HTMLInputElement, Record<string, unknown>>(
  (props, ref) => {
    const {
      onChangeText,
      onFocus,
      onBlur,
      placeholder,
      placeholderTextColor,
      multiline,
      accessibilityLabel,
      selectionColor: _selectionColor,
      ...rest
    } = props;
    return React.createElement('input', {
      ...passthroughProps(rest),
      ref,
      'aria-label': accessibilityLabel as string | undefined,
      placeholder,
      'data-placeholder-color': placeholderTextColor,
      'data-multiline': multiline ? 'true' : undefined,
      onChange: (e: { target: { value: string } }) =>
        (onChangeText as ((v: string) => void) | undefined)?.(e.target.value),
      onFocus: onFocus as React.FocusEventHandler | undefined,
      onBlur: onBlur as React.FocusEventHandler | undefined,
    });
  },
);

/** A spinner, marked so a suite can find it. */
export const ActivityIndicator: React.FC<Record<string, unknown>> = props =>
  React.createElement('div', {
    'data-spinner': 'true',
    'data-color': props.color as string | undefined,
    'data-size': props.size as string | undefined,
  });

export const Alert = { alert: jest.fn() };

/** Listeners register and never fire; a suite that needs a keyboard event captures the handler. */
export const Keyboard = {
  addListener: jest.fn(() => ({ remove: jest.fn() })),
  dismiss: jest.fn(),
};

export const LayoutAnimation = {
  configureNext: jest.fn(),
  Types: { keyboard: 'keyboard' },
};

/**
 * Reduce-motion defaults to off. A suite that needs it on overrides
 * `isReduceMotionEnabled` for that test.
 */
export const AccessibilityInfo = {
  isReduceMotionEnabled: jest.fn(() => Promise.resolve(false)),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
};

const animationHandles = { start: jest.fn(), stop: jest.fn() };

class AnimatedValue {
  _value: number;
  constructor(value: number) {
    this._value = value;
  }
  setValue(value: number) {
    this._value = value;
  }
}

export const Animated = {
  Value: AnimatedValue,
  View: (props: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement(
      'div',
      { ...passthroughProps(props), 'data-animated': 'true' },
      props.children,
    ),
  loop: jest.fn(() => animationHandles),
  sequence: jest.fn((animations: unknown[]) => ({ animations })),
  timing: jest.fn((value: unknown, config: unknown) => ({ value, config })),
  __handles: animationHandles,
};
