
//
// target: __tests__/components/Icons.test.ts
// Icons exhaustive SVG contract tests — components/native/Icons.
//
// Repointed from the deleted web fork (components/Icons.tsx) to the live
// native twin. The two have genuinely different APIs: the fork took an
// optional `className` and hard-coded its sizes in Tailwind classes, while
// the native icons take `{ color, size }` and thread them into the
// react-native-svg <Svg> element. The assertions below follow the native
// contract, not the fork's.
//
// These tests invoke each icon as a plain function rather than mounting it,
// so no renderer is needed — but the component body really does run, so the
// size/colour threading is actually exercised rather than assumed.

import React from 'react';

// ─── 1. Mock react-native-svg ───────────────────────────────────────────
// The icons import Svg/Path/Circle/G/Rect at module load. We only inspect
// the element tree they build, so a set of inert pass-through components is
// enough — and it keeps this suite inside the project's "no React Native at
// runtime" Jest config.

jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'), { virtual: true });

import * as Icons from '../../components/native/Icons';
import { color } from '../../theme/tokens';

// ─── 2. Helpers ─────────────────────────────────────────────────────────

type AnyIcon = (props: Record<string, unknown>) => React.ReactElement;

/** Invoke an icon component directly and return the <Svg> element it builds. */
const renderIcon = (Component: unknown, props: Record<string, unknown> = {}) =>
  (Component as AnyIcon)(props) as React.ReactElement<Record<string, unknown>>;

/**
 * Collect every prop object in an element tree, so a colour applied to a
 * nested <Path stroke={color}> is as visible to the test as one applied to
 * the root <Svg stroke={color}>. OneTagIcon needs this — it strokes its
 * children rather than the root.
 */
function collectProps(node: unknown, acc: Record<string, unknown>[] = []) {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    node.forEach(child => collectProps(child, acc));
    return acc;
  }
  const el = node as React.ReactElement<Record<string, unknown>>;
  if (!el.props) return acc;
  acc.push(el.props);
  collectProps(el.props.children, acc);
  return acc;
}

/** Whether `color` shows up anywhere in the tree as a stroke or fill. */
const treePaintsWith = (el: React.ReactElement, color: string): boolean =>
  collectProps(el).some(p => p.stroke === color || p.fill === color);

// The complete native export surface. Pinned as a list so an icon that is
// accidentally deleted or renamed fails here rather than at a call site.
const ICON_NAMES = [
  'OneTagIcon', 'HomeIcon', 'SearchIcon', 'CameraIcon', 'PencilAltIcon',
  'UserIcon', 'BellIcon', 'HeartIcon', 'CommentIcon', 'RepostIcon',
  'BookmarkIcon', 'TrashIcon', 'XIcon', 'PlusIcon', 'ArrowRightIcon',
  'ArrowLeftIcon', 'ImageIcon', 'FlipCameraIcon', 'PencilIcon', 'TypeIcon',
  'ShareIcon', 'DownloadIcon', 'LockClosedIcon', 'PlusCircleIcon', 'MenuIcon',
  'ThreeDotsVerticalIcon', 'BlockIcon', 'LogoutIcon', 'EyeIcon', 'ReplyIcon',
  'HashtagIcon', 'PollIcon', 'VerifiedIcon', 'CheckIcon', 'DoubleCheckIcon',
  'FlagIcon', 'ReportIcon', 'SendIcon', 'StarIcon', 'ChevronDownIcon',
  'ChevronUpIcon', 'ShareIOSIcon', 'AddToHomeScreenIOSIcon',
  'MoreVertAndroidIcon', 'ChevronRightIcon',
] as const;

// Icons whose default size differs from the 24px house default.
const DEFAULT_SIZES: Record<string, number> = {
  OneTagIcon: 32,
  VerifiedIcon: 20,
};

// ─── 3. Export surface ──────────────────────────────────────────────────

describe('native Icons — export surface', () => {
  it.each(ICON_NAMES)('%s is exported as a component', name => {
    expect(typeof (Icons as Record<string, unknown>)[name]).toBe('function');
  });

  it('exports no icons beyond the pinned list', () => {
    const exported = Object.keys(Icons).filter(k => k.endsWith('Icon'));
    expect(exported.sort()).toEqual([...ICON_NAMES].sort());
  });
});

// ─── 4. size → Svg width/height ─────────────────────────────────────────

describe('native Icons — size prop drives Svg width and height', () => {
  it.each(ICON_NAMES)('%s applies an explicit size to width and height', name => {
    const el = renderIcon((Icons as Record<string, unknown>)[name], { size: 37 });
    expect(el.props.width).toBe(37);
    expect(el.props.height).toBe(37);
  });

  it.each(ICON_NAMES)('%s falls back to its default size', name => {
    const el = renderIcon((Icons as Record<string, unknown>)[name], {});
    const expected = DEFAULT_SIZES[name] ?? 24;
    expect(el.props.width).toBe(expected);
    expect(el.props.height).toBe(expected);
  });

  it.each(ICON_NAMES)('%s declares a viewBox so it scales with size', name => {
    const el = renderIcon((Icons as Record<string, unknown>)[name], {});
    expect(typeof el.props.viewBox).toBe('string');
    expect(el.props.viewBox).toMatch(/^\d+ \d+ \d+ \d+$/);
  });
});

// ─── 5. color → stroke/fill ─────────────────────────────────────────────

describe('native Icons — color prop is threaded into the SVG', () => {
  it.each(ICON_NAMES)('%s paints with the supplied color', name => {
    const el = renderIcon((Icons as Record<string, unknown>)[name], {
      color: '#abcdef',
    });
    expect(treePaintsWith(el, '#abcdef')).toBe(true);
  });

  it.each(ICON_NAMES)('%s defaults to the ink token when no color is given', name => {
    // ONE-64: the icons were white for the old dark skin. On the light
    // ground they default to color.text (#0a0a0a) — via the token, so the
    // literal never appears in Icons.tsx.
    const el = renderIcon((Icons as Record<string, unknown>)[name], {});
    expect(treePaintsWith(el, color.text)).toBe(true);
    expect(color.text).toBe('#0a0a0a');
  });

  it.each(ICON_NAMES)('%s paints nothing white by default', name => {
    // A hard-coded white detail (OneTagIcon's cross used to be one) would
    // vanish on the light ground.
    const el = renderIcon((Icons as Record<string, unknown>)[name], {});
    expect(treePaintsWith(el, '#fff')).toBe(false);
    expect(treePaintsWith(el, color.inverse)).toBe(false);
  });

  it('accepts a non-string ColorValue without coercing it', () => {
    // react-navigation hands tabBarIcon a ColorValue, which may be an
    // OpaqueColorValue rather than a string. The icons must pass it
    // straight through to react-native-svg.
    const opaque = { __opaque: true } as unknown as string;
    const el = renderIcon(Icons.HomeIcon, { color: opaque });
    expect(el.props.stroke).toBe(opaque);
  });
});

// ─── 6. Toggle icons ────────────────────────────────────────────────────

describe('native Icons — HeartIcon liked toggle', () => {
  it('fills with the color when liked', () => {
    const el = renderIcon(Icons.HeartIcon, { color: '#ff0000', liked: true });
    expect(el.props.fill).toBe('#ff0000');
    expect(el.props.stroke).toBe('#ff0000');
  });

  it('is unfilled when not liked', () => {
    const el = renderIcon(Icons.HeartIcon, { color: '#ff0000', liked: false });
    expect(el.props.fill).toBe('none');
    expect(el.props.stroke).toBe('#ff0000');
  });

  it('defaults to unliked when the prop is omitted', () => {
    const el = renderIcon(Icons.HeartIcon, { color: '#ff0000' });
    expect(el.props.fill).toBe('none');
  });

  it('with no color, a liked heart is filled heart red via the token', () => {
    const el = renderIcon(Icons.HeartIcon, { liked: true });
    expect(el.props.fill).toBe(color.heart);
    expect(el.props.stroke).toBe(color.heart);
  });

  it('with no color, an unliked heart is an ink outline', () => {
    const el = renderIcon(Icons.HeartIcon, { liked: false });
    expect(el.props.fill).toBe('none');
    expect(el.props.stroke).toBe(color.text);
  });
});

describe('native Icons — strokeWidth', () => {
  it('threads an explicit weight onto a stroked icon', () => {
    expect(renderIcon(Icons.CommentIcon, { strokeWidth: 1.8 }).props.strokeWidth).toBe(1.8);
    expect(renderIcon(Icons.HeartIcon, { strokeWidth: 1.8 }).props.strokeWidth).toBe(1.8);
    expect(renderIcon(Icons.BookmarkIcon, { strokeWidth: 1.8 }).props.strokeWidth).toBe(1.8);
  });

  it('leaves an icon at its own weight when none is given', () => {
    expect(renderIcon(Icons.CommentIcon, {}).props.strokeWidth).toBeUndefined();
    expect(renderIcon(Icons.SendIcon, {}).props.strokeWidth).toBe(1.5);
    expect(renderIcon(Icons.CheckIcon, {}).props.strokeWidth).toBe(2.5);
  });
});

describe('native Icons — BookmarkIcon saved toggle', () => {
  it('fills with the color when saved', () => {
    const el = renderIcon(Icons.BookmarkIcon, { color: '#00ff00', saved: true });
    expect(el.props.fill).toBe('#00ff00');
    expect(el.props.stroke).toBe('#00ff00');
  });

  it('is unfilled when not saved', () => {
    const el = renderIcon(Icons.BookmarkIcon, { color: '#00ff00', saved: false });
    expect(el.props.fill).toBe('none');
    expect(el.props.stroke).toBe('#00ff00');
  });

  it('defaults to unsaved when the prop is omitted', () => {
    const el = renderIcon(Icons.BookmarkIcon, { color: '#00ff00' });
    expect(el.props.fill).toBe('none');
  });

  it('toggling saved changes the fill and nothing else', () => {
    const unsaved = renderIcon(Icons.BookmarkIcon, { color: '#00ff00', saved: false });
    const saved = renderIcon(Icons.BookmarkIcon, { color: '#00ff00', saved: true });
    expect(unsaved.props.fill).not.toBe(saved.props.fill);
    expect(unsaved.props.width).toBe(saved.props.width);
    expect(unsaved.props.viewBox).toBe(saved.props.viewBox);
  });
});
