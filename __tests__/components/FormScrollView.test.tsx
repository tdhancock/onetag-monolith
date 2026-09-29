/**
 * @jest-environment jsdom
 *
 * target: __tests__/components/FormScrollView.test.tsx
 * A form's ScrollView that keeps the focused field above the keyboard —
 * components/native/FormScrollView.
 *
 * A KeyboardAvoider shrinks a form to the space above the keyboard, but a
 * field in its lower half stays where it was, now out of view: signup's lower
 * fields and Edit profile's bio disappeared as they were tapped.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockFocused: { current: unknown } = { current: null };
const mockScrollTo = jest.fn();

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../support/reactNativeDom');
  const ScrollView = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ scrollTo: mockScrollTo, getInnerViewRef: () => 'content' }));
    return React.createElement('div', { 'data-scroll': 'true', onClick: () => (props.onLayout as (e: unknown) => void)?.({ nativeEvent: { layout: { height: 300 } } }) }, props.children);
  });
  return {
    ...shim,
    ScrollView,
    TextInput: Object.assign(shim.TextInput, { State: { currentlyFocusedInput: () => mockFocused.current } }),
  };
});

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Keyboard } from 'react-native';
import FormScrollView, { REVEAL_MARGIN, revealOffset } from '../../components/native/FormScrollView';

describe('revealOffset', () => {
  const viewport = { offset: 0, height: 400 };

  it('leaves a field that is already in view', () => {
    expect(revealOffset({ y: 100, height: 44 }, viewport, 16)).toBeNull();
  });

  it('scrolls a field below the visible part up, with room under it', () => {
    expect(revealOffset({ y: 500, height: 44 }, viewport, 16)).toBe(500 + 44 + 16 - 400);
  });

  it('scrolls a field above the visible part down to it', () => {
    expect(revealOffset({ y: 100, height: 44 }, { offset: 300, height: 400 }, 16)).toBe(84);
  });

  it('shows the top of a field taller than the visible part', () => {
    expect(revealOffset({ y: 500, height: 600 }, viewport, 16)).toBe(484);
  });

  it('never scrolls above the start', () => {
    expect(revealOffset({ y: 4, height: 44 }, { offset: 50, height: 400 }, 16)).toBe(0);
  });
});

describe('FormScrollView', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const listeners = new Map<string, () => void>();

  beforeEach(() => {
    listeners.clear();
    mockScrollTo.mockClear();
    (Keyboard.addListener as jest.Mock).mockImplementation((name: string, listener: () => void) => {
      listeners.set(name, listener);
      return { remove: () => listeners.delete(name) };
    });
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = container = null;
    mockFocused.current = null;
  });

  const mount = () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<FormScrollView><span>fields</span></FormScrollView>));
    // The layout the KeyboardAvoider leaves it: 300pt above the keyboard.
    act(() => (container!.querySelector('[data-scroll]') as HTMLElement).click());
  };

  it('scrolls the focused field into view when the keyboard comes up', () => {
    mockFocused.current = {
      measureLayout: (relativeTo: unknown, onSuccess: (x: number, y: number, w: number, h: number) => void) => {
        expect(relativeTo).toBe('content');
        onSuccess(0, 520, 358, 44);
      },
    };
    mount();
    act(() => listeners.get('keyboardWillShow')!());
    expect(mockScrollTo).toHaveBeenCalledWith({ y: 520 + 44 + REVEAL_MARGIN - 300, animated: true });
  });

  it('leaves a focused field outside the form alone', () => {
    mockFocused.current = {
      measureLayout: (_relativeTo: unknown, _onSuccess: unknown, onFail: () => void) => onFail(),
    };
    mount();
    act(() => listeners.get('keyboardDidShow')!());
    expect(mockScrollTo).not.toHaveBeenCalled();
  });
});
