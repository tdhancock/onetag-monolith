/**
 * @jest-environment jsdom
 *
 * target: __tests__/components/KeyboardAvoider.test.tsx
 * The keyboard-aware container — components/native/KeyboardAvoider.
 *
 * It pads its bottom by however much of it the keyboard covers, measured in
 * window coordinates, so it needs no offset for a header or a modal sheet
 * above it. React Native's KeyboardAvoidingView measured against its parent
 * and was out by exactly that gap, which buried the composer toolbar, Edit
 * profile's fields and the comment bar under the keyboard.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({ ...require('../support/reactNativeDom'), Platform: { OS: 'ios' } }));

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { Keyboard } from 'react-native';
import KeyboardAvoider, { keyboardOverlap } from '../../components/native/KeyboardAvoider';

type Listener = (event: { endCoordinates: { screenY: number }; duration?: number }) => void;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const listeners = new Map<string, Listener>();

beforeEach(() => {
  listeners.clear();
  (Keyboard.addListener as jest.Mock).mockImplementation((name: string, listener: Listener) => {
    listeners.set(name, listener);
    return { remove: () => listeners.delete(name) };
  });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** Mounts the avoider as if laid out at `y`, `height` points tall, in the window. */
function mount(frame: { y: number; height: number }) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<KeyboardAvoider><span>composer</span></KeyboardAvoider>));
  const view = container.firstElementChild as HTMLElement & {
    measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void;
  };
  view.measureInWindow = (cb) => cb(0, frame.y, 390, frame.height);
  return view;
}

describe('keyboardOverlap', () => {
  it('is how far the bottom edge reaches below the keyboard top', () => {
    expect(keyboardOverlap(800, 500)).toBe(300);
  });

  it('is zero when the view already ends above the keyboard', () => {
    expect(keyboardOverlap(400, 500)).toBe(0);
  });
});

describe('KeyboardAvoider', () => {
  it('pads by the covered part, measured in the window, whatever sits above it', () => {
    // A page-sheet modal's content: starts 110pt down the screen, runs to
    // its bottom. RN's KeyboardAvoidingView would have padded 110pt short.
    const view = mount({ y: 110, height: 734 });
    expect(view.style.paddingBottom).toBe('0px');

    act(() => listeners.get('keyboardWillChangeFrame')!({ endCoordinates: { screenY: 508 } }));
    expect(view.style.paddingBottom).toBe(`${110 + 734 - 508}px`);
  });

  it('drops the padding when the keyboard goes', () => {
    const view = mount({ y: 0, height: 844 });
    act(() => listeners.get('keyboardWillChangeFrame')!({ endCoordinates: { screenY: 508 } }));
    act(() => listeners.get('keyboardWillHide')!({ endCoordinates: { screenY: 844 } }));
    expect(view.style.paddingBottom).toBe('0px');
  });

  it('stops listening once unmounted', () => {
    mount({ y: 0, height: 844 });
    act(() => root!.unmount());
    root = null;
    expect(listeners.size).toBe(0);
  });
});
