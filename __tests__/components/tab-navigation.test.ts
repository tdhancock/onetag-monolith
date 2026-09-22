//
// target: __tests__/components/tab-navigation.test.ts
// The tab bar — app/(tabs)/_layout.
//
// Invokes TabLayout as a plain function and inspects the <Tabs> element it
// builds, so no renderer is needed and the suite stays inside the project's
// "no React Native at runtime" Jest config.
//
// M1b was a visual change only, so most of what is asserted here is what must
// NOT have moved: the five tabs in order, the three href:null utility
// entries, compose_dummy's tabPress interception, the badge's 99+ overflow,
// and the safe-area height arithmetic.

import React from 'react';
import * as fs from 'fs';
import * as path from 'path';

// ─── 1. Mocks ───────────────────────────────────────────────────────────
// Every name a jest.mock factory closes over has to start with `mock`, so
// these are declared up here and mutated per test.

const mockPush = jest.fn();
const mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
const mockAppState: {
  notifications: { is_read: boolean }[];
  unreadMessageCount: number;
} = { notifications: [], unreadMessageCount: 0 };

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
    StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
  };
}, { virtual: true });

jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'), { virtual: true });

jest.mock('expo-router', () => {
  const React = require('react');
  const Tabs: React.FC<Record<string, unknown>> & {
    Screen: React.FC<Record<string, unknown>>;
  } = ((props: Record<string, unknown>) =>
    React.createElement('Tabs', props, props.children as React.ReactNode)) as never;
  Tabs.displayName = 'Tabs';
  const Screen: React.FC<Record<string, unknown>> = (props) =>
    React.createElement('TabsScreen', props);
  Screen.displayName = 'TabsScreen';
  Tabs.Screen = Screen;
  return { __esModule: true, Tabs, useRouter: () => ({ push: mockPush }) };
}, { virtual: true });

jest.mock('react-native-safe-area-context', () => ({
  __esModule: true,
  useSafeAreaInsets: () => mockInsets,
}), { virtual: true });

jest.mock('../../store/AppContext.native', () => ({
  __esModule: true,
  useApp: () => mockAppState,
}), { virtual: true });

import TabLayout from '../../app/(tabs)/_layout';
import { color, type } from '../../theme/tokens';

// ─── 2. Helpers ─────────────────────────────────────────────────────────

type TintProps = { color: string; focused: boolean; size: number };

type ScreenOptions = {
  tabBarLabel?: string | ((p: unknown) => React.ReactNode);
  tabBarIcon?: (p: TintProps) => React.ReactElement | null;
  tabBarAccessibilityLabel?: string;
  title?: string;
  href?: null;
};

type ScreenElement = React.ReactElement<{
  name: string;
  options: ScreenOptions;
  listeners?: { tabPress: (e: { preventDefault: () => void }) => void };
}>;

type TabsElement = React.ReactElement<{
  screenOptions: Record<string, unknown>;
  children: React.ReactNode;
}>;

const render = (): TabsElement => (TabLayout as unknown as () => TabsElement)();

/** Every <Tabs.Screen> the layout declares, in declaration order. */
const screens = (): ScreenElement[] => {
  const children = render().props.children as unknown[];
  return children
    .flat(Infinity)
    .filter(
      (node): node is ScreenElement =>
        !!node && typeof node === 'object' && 'props' in (node as object),
    )
    .filter((node) => typeof node.props?.name === 'string');
};

const screenNamed = (name: string): ScreenElement => {
  const found = screens().find((s) => s.props.name === name);
  if (!found) throw new Error(`no <Tabs.Screen name="${name}">`);
  return found;
};

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

const barStyle = () => flatten(render().props.screenOptions.tabBarStyle);

/** Collect every prop object in an element tree. */
const collectProps = (node: unknown, acc: Record<string, unknown>[] = []) => {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    node.forEach((child) => collectProps(child, acc));
    return acc;
  }
  const el = node as React.ReactElement<Record<string, unknown>>;
  if (!el.props) return acc;
  acc.push(el.props);
  collectProps(el.props.children, acc);
  return acc;
};

const iconTreeOf = (name: string, tint: string = color.textMuted) => {
  const icon = screenNamed(name).props.options.tabBarIcon;
  if (!icon) throw new Error(`no tabBarIcon on "${name}"`);
  return icon({ color: tint, focused: false, size: 24 });
};

const layoutSource = fs.readFileSync(
  path.resolve(__dirname, '../../app/(tabs)/_layout.tsx'),
  'utf8',
);

beforeEach(() => {
  mockPush.mockClear();
  mockInsets.bottom = 0;
  mockAppState.notifications = [];
  mockAppState.unreadMessageCount = 0;
});

// ─── 3. The tab set has not moved ───────────────────────────────────────

describe('tab bar — structure is unchanged', () => {
  it('renders without crashing', () => {
    expect(() => render()).not.toThrow();
  });

  it('declares the five visible tabs in the original order', () => {
    const visible = screens().filter((s) => s.props.options.href !== null);
    expect(visible.map((s) => s.props.name)).toEqual([
      'index',
      'search',
      'camera',
      'compose_dummy',
      'profile',
    ]);
  });

  it('puts the camera dead center, where the scan action belongs', () => {
    const visible = screens().filter((s) => s.props.options.href !== null);
    expect(visible[2]!.props.name).toBe('camera');
  });

  it('declares nothing but real screens (ONE-62)', () => {
    // The three .ts helpers used to live under (tabs)/, so expo-router
    // registered them as routes and they needed href: null to stay off the
    // bar. They now live in lib/screens/ and are not routes at all, so no
    // hidden entries should remain — a new one means a non-screen crept back
    // under app/.
    expect(screens().filter((s) => s.props.options.href === null)).toHaveLength(0);
  });
});

// ─── 4. Colours come from tokens ────────────────────────────────────────

describe('tab bar — token colours', () => {
  it('is a white bar under a hairline rule', () => {
    const style = barStyle();
    expect(style.backgroundColor).toBe(color.bg);
    expect(style.borderTopColor).toBe(color.border);
    expect(style.borderTopWidth).toBe(1);
    // The acceptance criterion names these two values outright.
    expect(color.bg).toBe('#ffffff');
    expect(color.border).toBe('#e8e8e8');
  });

  it('tints the active tab near-black and the inactive tabs muted', () => {
    const options = render().props.screenOptions;
    expect(options.tabBarActiveTintColor).toBe(color.text);
    expect(options.tabBarInactiveTintColor).toBe(color.textMuted);
  });

  it('carries no raw hex', () => {
    expect(layoutSource).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});

// ─── 5. Labels ──────────────────────────────────────────────────────────

describe('tab bar — labels', () => {
  it('shows labels, pinned below the icon', () => {
    const options = render().props.screenOptions;
    expect(options.tabBarShowLabel).toBe(true);
    expect(options.tabBarLabelPosition).toBe('below-icon');
  });

  it('wears the mono micro-label treatment', () => {
    const label = flatten(render().props.screenOptions.tabBarLabelStyle);
    expect(label.fontFamily).toBe(type.monoLabel.fontFamily);
    expect(label.fontSize).toBe(type.monoLabel.fontSize);
    expect(label.letterSpacing).toBe(type.monoLabel.letterSpacing);
    expect(label.textTransform).toBe('uppercase');
  });

  it('labels the four ordinary tabs', () => {
    expect(screenNamed('index').props.options.tabBarLabel).toBe('Home');
    expect(screenNamed('search').props.options.tabBarLabel).toBe('Explore');
    expect(screenNamed('compose_dummy').props.options.tabBarLabel).toBe('Compose');
    expect(screenNamed('profile').props.options.tabBarLabel).toBe('Profile');
  });

  it('gives the center tab a null label rather than a hidden one', () => {
    // BottomTabBar reads tabBarShowLabel off the *focused* tab and applies it
    // to every item, so hiding this one that way would blank all five.
    const label = screenNamed('camera').props.options.tabBarLabel;
    expect(typeof label).toBe('function');
    expect((label as (p: unknown) => React.ReactNode)({})).toBeNull();
  });

  it('still names the center tab for assistive tech and for the route', () => {
    const options = screenNamed('camera').props.options;
    expect(options.tabBarAccessibilityLabel).toBe('Camera');
    expect(options.title).toBe('Camera');
  });

  it('says Camera, not Scan — QR scanning arrives in M4', () => {
    // The label must not promise behaviour the screen does not have yet.
    expect(layoutSource).not.toMatch(/tabBarLabel:\s*['"]Scan['"]/);
  });
});

// ─── 6. The center emphasis ─────────────────────────────────────────────

describe('tab bar — center emphasis', () => {
  it('is a filled near-black circle with an inverse icon', () => {
    const tree = iconTreeOf('camera');
    const style = flatten(collectProps(tree)[0]!.style);
    expect(style.backgroundColor).toBe(color.text);
    expect(style.borderRadius).toBe((style.width as number) / 2);
    expect(collectProps(tree).some((p) => p.color === color.inverse)).toBe(true);
  });

  it('sits entirely inside the bar, with no protrusion or shadow', () => {
    const style = flatten(collectProps(iconTreeOf('camera'))[0]!.style);
    const diameter = style.width as number;

    // Worst case is a device reporting no bottom inset: height 60 with 8pt of
    // padding top and bottom leaves a 44pt row. BottomTabItem adds 5pt of its
    // own padding — that padding is NOT reachable from tabBarItemStyle, which
    // lands on an outer wrapper — so the circle starts at y=5 and has to end
    // inside 44 for Android not to clip it against the bar edge.
    mockInsets.bottom = 0;
    const row = (barStyle().height as number) - (barStyle().paddingTop as number)
      - (barStyle().paddingBottom as number);
    expect(row).toBe(44);

    const ITEM_PADDING = 5;
    expect(ITEM_PADDING + diameter).toBeLessThanOrEqual(row);

    // No negative margin, no drop shadow — it reads as prominent by fill.
    expect(style.marginTop).toBeUndefined();
    expect(style.marginBottom).toBeUndefined();
    expect(style.shadowOpacity).toBeUndefined();
    expect(style.elevation).toBeUndefined();
    expect(barStyle().shadowOpacity).toBe(0);
    expect(barStyle().elevation).toBe(0);
  });

  it('leaves the labelled tabs inside that same row', () => {
    // icon + label marginTop + label line box, from y=5.
    mockInsets.bottom = 0;
    const label = flatten(render().props.screenOptions.tabBarLabelStyle);
    const iconProps = collectProps(iconTreeOf('search')).find((p) => p.size !== undefined);

    const stack = 5
      + (iconProps!.size as number)
      + (label.marginTop as number)
      + (label.lineHeight as number);

    expect(stack).toBeLessThanOrEqual(44);
    // Pinned rather than left to the font's own metrics, so the total above
    // does not drift between iOS and Android.
    expect(label.lineHeight).toBeDefined();
  });

  it('ignores the tint so the icon stays inverse whether focused or not', () => {
    for (const tint of [color.text, color.textMuted]) {
      const props = collectProps(iconTreeOf('camera', tint));
      expect(props.some((p) => p.color === color.inverse)).toBe(true);
      expect(props.some((p) => p.color === tint)).toBe(false);
    }
  });
});

// ─── 7. The unread badge ────────────────────────────────────────────────

describe('tab bar — unread badge', () => {
  // The component renders the count as a number below 100 and the string
  // '99+' above it, so the child is not always a string.
  const isLeafText = (p: Record<string, unknown>) =>
    typeof p.children === 'string' || typeof p.children === 'number';

  const badgeOf = () => {
    const props = collectProps(iconTreeOf('index'));
    const container = props.find((p) => flatten(p.style).position === 'absolute');
    const text = props.find(isLeafText);
    return {
      container,
      text: text === undefined ? undefined : String(text.children),
      textStyle: text === undefined ? {} : flatten(text.style),
    };
  };

  it('is absent when nothing is unread', () => {
    expect(badgeOf().container).toBeUndefined();
  });

  it('counts unread notifications and unread messages together', () => {
    mockAppState.notifications = [{ is_read: false }, { is_read: true }, { is_read: false }];
    mockAppState.unreadMessageCount = 3;
    expect(badgeOf().text).toBe('5');
  });

  it('ignores notifications already read', () => {
    mockAppState.notifications = [{ is_read: true }, { is_read: true }];
    expect(badgeOf().container).toBeUndefined();
  });

  it('overflows to 99+ past ninety-nine', () => {
    mockAppState.unreadMessageCount = 100;
    expect(badgeOf().text).toBe('99+');

    mockAppState.unreadMessageCount = 99;
    expect(badgeOf().text).toBe('99');
  });

  it('is a heart-coloured pill with inverse text', () => {
    mockAppState.unreadMessageCount = 1;
    const { container, textStyle } = badgeOf();
    expect(flatten(container!.style).backgroundColor).toBe(color.heart);
    expect(textStyle.color).toBe(color.inverse);
  });
});

// ─── 8. Compose stays a fake tab ────────────────────────────────────────

describe('tab bar — compose interception', () => {
  it('pushes /compose and never focuses the tab', () => {
    const preventDefault = jest.fn();
    screenNamed('compose_dummy').props.listeners!.tabPress({ preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/compose');
  });
});

// ─── 9. Safe-area arithmetic is untouched ───────────────────────────────

describe('tab bar — safe area', () => {
  it('keeps the original height and padding formula', () => {
    for (const bottom of [0, 8, 34]) {
      mockInsets.bottom = bottom;
      const style = barStyle();
      expect(style.height).toBe(60 + bottom);
      expect(style.paddingBottom).toBe(Math.max(bottom, 8));
      expect(style.paddingTop).toBe(8);
    }
  });

  it('never drops below an 8pt bottom padding on a device with no inset', () => {
    mockInsets.bottom = 0;
    expect(barStyle().paddingBottom).toBe(8);
  });

  it('hides on keyboard, as before', () => {
    expect(render().props.screenOptions.tabBarHideOnKeyboard).toBe(true);
  });
});
