/**
 * @jest-environment jsdom
 *
 * target: __tests__/components/KeyboardAvoider.test.tsx
 * The keyboard-aware container — components/native/KeyboardAvoider.
 *
 * It pads its bottom by however much of it the keyboard covers. On iOS that
 * comes from the keyboard's height and what lies below the view, never from
 * measuring it: inside a page-sheet modal the layout doesn't know where the
 * sheet starts, so a measured position is too high by the sheet's offset, and
 * Compose, Messages and Edit profile kept their bottom rows under the keys.
 * On Android the view measures itself in the window.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform = { OS: 'ios' };
jest.mock('react-native', () => ({
  ...require('../support/reactNativeDom'),
  Platform: mockPlatform,
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
}));
jest.mock('react-native-safe-area-context', () => ({
  initialWindowMetrics: { insets: { top: 47, bottom: 34, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 390, height: 844 } },
}));

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { Keyboard } from 'react-native';
import KeyboardAvoider, { keyboardCover, keyboardOverlap } from '../../components/native/KeyboardAvoider';
import { keyboardHeightOnScreen } from '../../lib/useKeyboardHeight';

type Listener = (event: { endCoordinates: { screenY: number }; duration?: number }) => void;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const listeners = new Map<string, Listener>();

beforeEach(() => {
  mockPlatform.OS = 'ios';
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

/**
 * Mounts the avoider, reporting `frame` whenever it is measured: where the
 * layout believes the view is, which inside a native modal is not where it is.
 */
function mount(frame: { y: number; height: number }, offsetBelow?: number) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<KeyboardAvoider offsetBelow={offsetBelow}><span>composer</span></KeyboardAvoider>));
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

describe('keyboardHeightOnScreen', () => {
  it('is how far up the screen the keyboard reaches', () => {
    expect(keyboardHeightOnScreen(844, 508)).toBe(336);
  });

  it('is zero once the keyboard is off screen', () => {
    expect(keyboardHeightOnScreen(844, 844)).toBe(0);
  });
});

describe('keyboardCover', () => {
  it('is the keyboard, less what lies below the view', () => {
    expect(keyboardCover(336, 34)).toBe(302);
  });

  it('is zero while the keyboard is down', () => {
    expect(keyboardCover(0, 34)).toBe(0);
  });
});

describe('KeyboardAvoider on iOS', () => {
  it('sits on the keyboard inside a page sheet, however high the layout places the sheet', () => {
    // A page-sheet modal's content, which the layout reports from the top of
    // the screen although the sheet starts about 60pt down. Measuring it
    // padded 60pt short and left the composer half under the keyboard.
    const view = mount({ y: 0, height: 750 });
    expect(view.style.paddingBottom).toBe('0px');

    // A 336pt keyboard; the SafeAreaView under the view pads the home
    // indicator's 34pt, which the keyboard covers first.
    act(() => listeners.get('keyboardWillChangeFrame')!({ endCoordinates: { screenY: 508 } }));
    expect(view.style.paddingBottom).toBe('302px');
  });

  it('takes the whole keyboard when it runs to the bottom edge, as a sheet does', () => {
    const view = mount({ y: 0, height: 844 }, 0);
    act(() => listeners.get('keyboardWillChangeFrame')!({ endCoordinates: { screenY: 508 } }));
    expect(view.style.paddingBottom).toBe('336px');
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

describe('KeyboardAvoider on Android', () => {
  it('pads by the covered part, measured in the window', () => {
    mockPlatform.OS = 'android';
    const view = mount({ y: 110, height: 734 });
    act(() => listeners.get('keyboardDidShow')!({ endCoordinates: { screenY: 508 } }));
    expect(view.style.paddingBottom).toBe(`${110 + 734 - 508}px`);

    act(() => listeners.get('keyboardDidHide')!({ endCoordinates: { screenY: 844 } }));
    expect(view.style.paddingBottom).toBe('0px');
  });
});
