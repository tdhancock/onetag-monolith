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
  const { style, children, testID, className, ...rest } = props;
  const domProps: Record<string, unknown> = { ...rest };
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

export const View: React.FC<React.PropsWithChildren<Record<string, unknown>>> = props =>
  React.createElement('div', passthroughProps(props), props.children);

export const Text: React.FC<React.PropsWithChildren<Record<string, unknown>>> = props =>
  React.createElement('span', passthroughProps(props), props.children);

export const Pressable: React.FC<React.PropsWithChildren<Record<string, unknown>>> = props => {
  const { onPress, accessibilityLabel, ...rest } = props;
  return React.createElement(
    'button',
    {
      ...passthroughProps(rest),
      onClick: onPress as React.MouseEventHandler,
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

export const Alert = { alert: jest.fn() };

const animationHandles = { start: jest.fn(), stop: jest.fn() };

class AnimatedValue {
  _value: number;
  constructor(value: number) {
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
