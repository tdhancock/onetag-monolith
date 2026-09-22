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
    StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
  };
}, { virtual: true });

jest.mock('expo-image', () => {
  const React = require('react');
  const Image: React.FC<Record<string, unknown>> = () => null;
  Image.displayName = 'Image';
  return { __esModule: true, Image };
}, { virtual: true });

// The import line from the acceptance criterion, verbatim in spirit: all
// five primitives, one specifier. If this does not typecheck, tsc fails.
import {
  Button,
  Card,
  MonoLabel,
  Divider,
  Avatar,
  initialsFrom,
  letterSpacingFor,
  DISABLED_OPACITY,
  DEFAULT_AVATAR_SIZE,
  INITIALS_FALLBACK,
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
  ])('exports %s as a component', (_name, Component) => {
    expect(typeof Component).toBe('function');
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

    const variant: ButtonVariant = 'outline';
    const size: ButtonSize = 'sm';
    const colorKey: ColorTokenKey = 'textMuted';

    expect([mono, button, card, divider, avatar]).toHaveLength(5);
    expect([variant, size, colorKey]).toEqual(['outline', 'sm', 'textMuted']);
  });
});
