//
// target: __tests__/components/RenderUserContent.test.ts
// User-written text with mentions, hashtags and links — components/native/RenderUserContent.
//
// Invoked as a plain function: the only hook is expo-router's useRouter,
// which the mock below replaces with a plain function.

import React from 'react';

// ─── 1. Mock the native runtime ─────────────────────────────────────────

const mockPush = jest.fn();
const mockOpenURL = jest.fn();

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
    Text: passthrough('span'),
    Linking: { openURL: (url: string) => mockOpenURL(url) },
    StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
  };
}, { virtual: true });

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }), { virtual: true });

import RenderUserContent, { segmentUserContent } from '../../components/native/RenderUserContent';
import { color, type } from '../../theme/tokens';

// ─── 2. Helpers ─────────────────────────────────────────────────────────

type Props = { content: string; style?: unknown };

type SpanElement = React.ReactElement<{
  style?: unknown;
  onPress?: () => void;
  children?: React.ReactNode;
}>;

const render = (props: Props) =>
  (RenderUserContent as unknown as (p: Props) => SpanElement | null)(props);

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

const childrenOf = (props: Props) =>
  React.Children.toArray(render(props)!.props.children) as SpanElement[];

/** The child span whose text is exactly `text`. */
const spanFor = (props: Props, text: string) =>
  childrenOf(props).find((c) => React.Children.toArray(c.props.children).join('') === text)!;

beforeEach(() => {
  mockPush.mockClear();
  mockOpenURL.mockClear();
});

// ─── 3. Segmentation ────────────────────────────────────────────────────

describe('segmentUserContent', () => {
  it('splits mentions, hashtags and links out of plain text', () => {
    expect(segmentUserContent('hi @ana see #build at https://x.test/a')).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'mention', value: 'ana' },
      { type: 'text', value: ' see ' },
      { type: 'hashtag', value: 'build' },
      { type: 'text', value: ' at ' },
      { type: 'link', value: 'https://x.test/a' },
    ]);
  });

  it('keeps a #fragment inside a URL as part of the link', () => {
    expect(segmentUserContent('https://x.test/page#section')).toEqual([
      { type: 'link', value: 'https://x.test/page#section' },
    ]);
  });

  it('returns a single text run when there is nothing to pick out', () => {
    expect(segmentUserContent('just words')).toEqual([{ type: 'text', value: 'just words' }]);
  });
});

// ─── 4. Rendering ───────────────────────────────────────────────────────

describe('RenderUserContent — rendering', () => {
  it('renders nothing for empty content', () => {
    expect(render({ content: '' })).toBeNull();
  });

  it('sets body text in the body face and ink colour', () => {
    const style = flatten(render({ content: 'hello' })!.props.style);
    expect(style.fontFamily).toBe(type.body);
    expect(style.color).toBe(color.text);
  });

  it('lets a caller override the ink, as a message bubble does with inverse', () => {
    const el = render({ content: 'hello', style: { color: color.inverse } })!;
    expect(flatten(el.props.style).color).toBe(color.inverse);
  });

  it('sets mentions and hashtags in the medium weight, with no colour of their own', () => {
    // No blue: the emphasis inherits the body colour, which is ink.
    const content = 'hi @ana #build';
    for (const text of ['@ana', '#build']) {
      const style = flatten(spanFor({ content }, text).props.style);
      expect(style.fontFamily).toBe(type.bodyMedium);
      expect(style.color).toBeUndefined();
    }
  });

  it('applies a caller style after the defaults', () => {
    const style = flatten(render({ content: 'hello', style: { fontSize: 17 } })!.props.style);
    expect(style.fontSize).toBe(17);
    expect(style.color).toBe(color.text);
  });
});

// ─── 5. Tap behaviour is unchanged ──────────────────────────────────────

describe('RenderUserContent — taps', () => {
  it('a mention opens that profile', () => {
    spanFor({ content: 'hi @ana' }, '@ana').props.onPress?.();
    expect(mockPush).toHaveBeenCalledWith('/user/ana');
  });

  it('a link opens the browser', () => {
    spanFor({ content: 'see https://x.test/a' }, 'https://x.test/a').props.onPress?.();
    expect(mockOpenURL).toHaveBeenCalledWith('https://x.test/a');
  });

  it('a hashtag has no tap target, as before', () => {
    expect(spanFor({ content: 'see #build' }, '#build').props.onPress).toBeUndefined();
  });
});
