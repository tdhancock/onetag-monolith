/**
 * @jest-environment jsdom
 *
 * target: __tests__/components/ui/Pressable.test.tsx
 * The press-state-aware Pressable — components/native/ui/Pressable.
 *
 * NativeWind's JSX runtime replaces a react-native Pressable's `style`
 * function with `{}`. Every suite here renders without NativeWind, so none of
 * them could see it: the profile tabs bunched up, the stat labels slid off
 * centre and every IconButton lost its 44pt box on device while all of this
 * passed. The second half of this file is the guard that keeps a style
 * function off react-native's Pressable.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => require('../../support/reactNativeDom'));

import fs from 'fs';
import path from 'path';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import Pressable from '../../../components/native/ui/Pressable';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(element: React.ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(element));
  return container;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

const press = (el: HTMLElement, type: 'mousedown' | 'mouseup') =>
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
  });

describe('Pressable', () => {
  it('hands the native Pressable a resolved style, never a function', () => {
    const el = mount(
      <Pressable accessibilityLabel="Tab" style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.5 : 1 })} />,
    );
    const button = el.querySelector('button')!;
    expect(button.style.flex).toContain('1');
    expect(button.style.opacity).toBe('1');
  });

  it('applies the pressed style while the finger is down, and drops it on release', () => {
    const el = mount(
      <Pressable accessibilityLabel="Tab" style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })} />,
    );
    const button = el.querySelector('button')!;

    press(button, 'mousedown');
    expect(button.style.opacity).toBe('0.5');

    press(button, 'mouseup');
    expect(button.style.opacity).toBe('1');
  });

  it("still calls the caller's own press-in and press-out handlers", () => {
    const onPressIn = jest.fn();
    const onPressOut = jest.fn();
    const el = mount(<Pressable accessibilityLabel="Tab" onPressIn={onPressIn} onPressOut={onPressOut} />);
    const button = el.querySelector('button')!;

    press(button, 'mousedown');
    press(button, 'mouseup');

    expect(onPressIn).toHaveBeenCalledTimes(1);
    expect(onPressOut).toHaveBeenCalledTimes(1);
  });

  it('passes a plain style through untouched', () => {
    const el = mount(<Pressable accessibilityLabel="Row" style={{ minHeight: 44 }} />);
    expect(el.querySelector('button')!.style.minHeight).toBe('44px');
  });

  it('resolves children given as a function of press state', () => {
    const el = mount(<Pressable accessibilityLabel="Row">{({ pressed }) => (pressed ? 'down' : 'up')}</Pressable>);
    const button = el.querySelector('button')!;
    expect(button.textContent).toBe('up');
    press(button, 'mousedown');
    expect(button.textContent).toBe('down');
  });

  it('calls onPress', () => {
    const onPress = jest.fn();
    const el = mount(<Pressable accessibilityLabel="Row" onPress={onPress} />);
    act(() => el.querySelector('button')!.click());
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

// ─── The guard ──────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '../../..');

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });

/** The local name react-native's Pressable is imported under, if it is. */
const nativePressableName = (source: string): string | null => {
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]react-native['"]/g)) {
    for (const specifier of match[1].split(',').map((s) => s.trim())) {
      const [imported, local] = specifier.split(/\s+as\s+/).map((s) => s.trim());
      if (imported === 'Pressable') return local ?? imported;
    }
  }
  return null;
};

/** `style={({ pressed }) => …}` or `style={(state) => …}`. */
const STYLE_FUNCTION = /style=\{\s*\(\s*(\{[^}]*\}|\w+)?\s*\)\s*=>/;

describe('no react-native Pressable takes a style function', () => {
  const files = ['app', 'components'].flatMap((dir) => sourceFiles(path.join(ROOT, dir)));

  it('finds the screens and components to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((file) => [path.relative(ROOT, file).split(path.sep).join('/'), file]))(
    '%s',
    (_name, file) => {
      const source = fs.readFileSync(file, 'utf8');
      const native = nativePressableName(source);
      if (!native) return;

      // A file that imports react-native's Pressable must not give any
      // pressable a style function: NativeWind would drop it. Import
      // Pressable from components/native/ui instead.
      expect(source).not.toMatch(STYLE_FUNCTION);
    },
  );
});
