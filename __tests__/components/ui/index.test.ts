//
// target: __tests__/components/ui/index.test.ts
// The public surface — components/native/ui/index.
//
// Screens are meant to import from `components/native/ui`, never from the
// individual files. This suite is what makes that promise mechanically
// checkable: it imports through the barrel exactly as a screen would, so a
// missing or misspelled re-export fails here rather than in a re-skin ticket.

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
    TextInput: passthrough('input'),
    Animated: { View: passthrough('div'), Value: class {} },
    AccessibilityInfo: {},
    StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
  };
}, { virtual: true });

jest.mock('expo-image', () => require('../../support/expoImageStub'), { virtual: true });

// The import line from the acceptance criterion, verbatim in spirit: every
// primitive, one specifier. If this does not typecheck, tsc fails.
import {
  Button,
  Card,
  MonoLabel,
  Divider,
  Avatar,
  IconButton,
  TextField,
  ListRow,
  EmptyState,
  Skeleton,
  useReducedMotion,
  initialsFrom,
  letterSpacingFor,
  badgeLabel,
  DISABLED_OPACITY,
  DEFAULT_AVATAR_SIZE,
  INITIALS_FALLBACK,
  BADGE_MAX,
  ICON_BUTTON_SIZE,
  TEXT_FIELD_MIN_HEIGHT,
  LIST_ROW_MIN_HEIGHT,
  LIST_ROW_AVATAR_SIZE,
} from '../../../components/native/ui';
import type {
  ButtonProps,
  ButtonVariant,
  ButtonSize,
  CardProps,
  MonoLabelProps,
  DividerProps,
  AvatarProps,
  ColorTokenKey,
  IconButtonProps,
  TextFieldProps,
  ListRowProps,
  EmptyStateProps,
  EmptyStateAction,
  SkeletonProps,
} from '../../../components/native/ui';

import MonoLabelDirect from '../../../components/native/ui/MonoLabel';

// ─── 2. Every primitive is reachable ────────────────────────────────────

describe('components/native/ui — public surface', () => {
  it.each([
    ['MonoLabel', MonoLabel],
    ['Button', Button],
    ['Card', Card],
    ['Divider', Divider],
    ['Avatar', Avatar],
    // ONE-64
    ['IconButton', IconButton],
    ['ListRow', ListRow],
    ['EmptyState', EmptyState],
    ['Skeleton', Skeleton],
  ])('exports %s as a component', (_name, Component) => {
    expect(typeof Component).toBe('function');
  });

  it('exports TextField, a forwardRef component', () => {
    // forwardRef returns an exotic object, not a function.
    expect(TextField).toBeDefined();
    expect((TextField as unknown as { displayName?: string }).displayName).toBe('TextField');
  });

  it('exports the reduce-motion hook the Skeleton uses', () => {
    expect(typeof useReducedMotion).toBe('function');
  });

  it('re-exports the same identity as the module itself, not a copy', () => {
    expect(MonoLabel).toBe(MonoLabelDirect);
  });

  it('exports the helpers a caller needs alongside the components', () => {
    expect(initialsFrom('Jordan Reeves')).toBe('JR');
    expect(letterSpacingFor(10)).toBe(1.8);
    expect(DISABLED_OPACITY).toBeGreaterThan(0);
    expect(DEFAULT_AVATAR_SIZE).toBeGreaterThan(0);
    expect(INITIALS_FALLBACK).toBe('?');
    expect(badgeLabel(BADGE_MAX + 1)).toBe('99+');
    expect(ICON_BUTTON_SIZE).toBeGreaterThanOrEqual(44);
    expect(TEXT_FIELD_MIN_HEIGHT).toBeGreaterThanOrEqual(48);
    expect(LIST_ROW_MIN_HEIGHT).toBeGreaterThanOrEqual(56);
    expect(LIST_ROW_AVATAR_SIZE).toBe(40);
  });
});

// ─── 3. The prop types resolve ──────────────────────────────────────────

describe('components/native/ui — prop types', () => {
  it('every component has an exported props interface usable by a caller', () => {
    // These annotations are the assertion: if a props type were missing or
    // not re-exported, this file would not compile.
    const mono: MonoLabelProps = { children: 'Tag' };
    const button: ButtonProps = { children: 'Create tag', onPress: () => {} };
    const card: CardProps = { children: 'x', padding: 'lg' };
    const divider: DividerProps = { inset: 'md' };
    const avatar: AvatarProps = { name: 'Jordan Reeves', size: 40 };
    const iconButton: IconButtonProps = { icon: null, accessibilityLabel: 'Close' };
    const textField: TextFieldProps = { label: 'Caption', error: null };
    const listRow: ListRowProps = { title: 'Jordan Reeves', subtitle: '@jordan' };
    const action: EmptyStateAction = { label: 'Explore', onPress: () => {} };
    const empty: EmptyStateProps = { title: 'Nothing new yet', action };
    const skeleton: SkeletonProps = { height: 36, circle: true };

    const variant: ButtonVariant = 'outline';
    const size: ButtonSize = 'sm';
    const colorKey: ColorTokenKey = 'textMuted';

    expect([mono, button, card, divider, avatar]).toHaveLength(5);
    expect([iconButton, textField, listRow, empty, skeleton]).toHaveLength(5);
    expect([variant, size, colorKey]).toEqual(['outline', 'sm', 'textMuted']);
  });
});
