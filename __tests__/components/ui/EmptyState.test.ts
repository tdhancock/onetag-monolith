//
// target: __tests__/components/ui/EmptyState.test.ts
// What a screen shows with nothing to list — components/native/ui/EmptyState.

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

import EmptyState from '../../../components/native/ui/EmptyState';
import type { EmptyStateProps } from '../../../components/native/ui/EmptyState';
import Button from '../../../components/native/ui/Button';
import { color, type } from '../../../theme/tokens';

// ─── 2. Helpers ─────────────────────────────────────────────────────────

type Node = React.ReactElement<{
  style?: unknown;
  children?: React.ReactNode;
  onPress?: () => void;
  variant?: string;
}>;

const render = (props: EmptyStateProps) =>
  (EmptyState as unknown as (p: EmptyStateProps) => React.ReactElement<{
    children: (Node | null)[];
  }>)(props);

/** The rendered slots with the absent ones dropped: [icon?, title, body?, action?]. */
const partsOf = (props: EmptyStateProps) =>
  render(props).props.children.filter((child): child is Node => child !== null);

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

// ─── 3. Tests ───────────────────────────────────────────────────────────

describe('EmptyState', () => {
  it('renders just a title when that is all it is given', () => {
    const parts = partsOf({ title: 'Nothing new yet' });
    expect(parts).toHaveLength(1);
    expect(parts[0].props.children).toBe('Nothing new yet');
    expect(flatten(parts[0].props.style)).toMatchObject({
      fontFamily: type.bodyBold,
      color: color.text,
    });
  });

  it('adds one line of body in textMid', () => {
    const [, body] = partsOf({ title: 'Nothing new yet', body: 'Check back soon.' });
    expect(body.props.children).toBe('Check back soon.');
    expect(flatten(body.props.style).color).toBe(color.textMid);
  });

  it('draws the icon above the title', () => {
    const icon = React.createElement('svg', { 'data-icon': 'bell' });
    const [iconSlot, title] = partsOf({ title: 'Nothing new yet', icon });
    expect(iconSlot.props.children).toBe(icon);
    expect(title.props.children).toBe('Nothing new yet');
  });

  it('offers a single primary Button as its action, which fires', () => {
    const onPress = jest.fn();
    const parts = partsOf({ title: 'Nothing new yet', action: { label: 'Explore', onPress } });
    const action = parts[parts.length - 1];
    expect(action.type).toBe(Button);
    expect(action.props.children).toBe('Explore');
    expect(action.props.variant).toBe('primary');
    action.props.onPress?.();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders no button without an action', () => {
    expect(partsOf({ title: 'x', body: 'y' }).some((p) => p.type === Button)).toBe(false);
  });
});
