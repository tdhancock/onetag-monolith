/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/Wordmark.test.tsx
//
// The wordmark (ONE-133). Its rings now come from lib/brandMark.ts, shared
// with the QR code and the icons, and the header must draw exactly what it
// drew before the move: the same circles, the same stroke, the front ring
// filled with the page so it sits over the back one.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

jest.mock('react-native', () => require('../support/reactNativeDom'));

/** Every set of props a Circle was drawn with, and the Svg's. */
const mockCircles: Record<string, unknown>[] = [];
const mockSvgs: Record<string, unknown>[] = [];
jest.mock('react-native-svg', () => {
  const React = require('react');
  const Svg = (props: Record<string, unknown>) => {
    mockSvgs.push(props);
    return React.createElement('svg', null, props.children);
  };
  return {
    __esModule: true,
    default: Svg,
    Svg,
    Circle: (props: Record<string, unknown>) => {
      mockCircles.push(props);
      return null;
    },
  };
});

import Wordmark, { DEFAULT_WORDMARK_SIZE, WORDMARK_LABEL } from '../../components/native/Wordmark';
import { brandMarkAtTypeSize } from '../../lib/brandMark';
import { color } from '../../theme/tokens';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(element: React.ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(element));
  return container;
}

beforeEach(() => {
  mockCircles.length = 0;
  mockSvgs.length = 0;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe.each([DEFAULT_WORDMARK_SIZE, 40])('at type size %s', (size) => {
  const mark = brandMarkAtTypeSize(size);

  it('draws the back ring, then the front ring, from lib/brandMark.ts', () => {
    mount(<Wordmark size={size} />);
    expect(mockCircles).toHaveLength(2);
    const [back, front] = mockCircles;
    expect(back).toMatchObject({ cx: mark.back.cx, cy: mark.back.cy, r: mark.back.r, strokeWidth: mark.stroke });
    expect(front).toMatchObject({ cx: mark.front.cx, cy: mark.front.cy, r: mark.front.r, strokeWidth: mark.stroke });
  });

  it('fills only the front ring, with the page colour, so it sits over the back one', () => {
    mount(<Wordmark size={size} />);
    const [back, front] = mockCircles;
    expect(back).toMatchObject({ stroke: color.text, fill: 'none' });
    expect(front).toMatchObject({ stroke: color.text, fill: color.bg });
  });

  it('sizes the drawing to the mark', () => {
    mount(<Wordmark size={size} />);
    expect(mockSvgs[0]).toMatchObject({
      width: mark.width,
      height: mark.height,
      viewBox: `0 0 ${mark.width} ${mark.height}`,
    });
  });
});

describe('the header size', () => {
  it('draws the circles it drew before the geometry moved', () => {
    mount(<Wordmark />);
    const [back, front] = mockCircles as { cx: number; cy: number; r: number; strokeWidth: number }[];
    expect(back.cx).toBeCloseTo(6.48, 10);
    expect(front.cx).toBeCloseTo(14.04, 10);
    expect(back.cy).toBeCloseTo(6.48, 10);
    expect(back.r).toBeCloseTo(5.67, 10);
    expect(back.strokeWidth).toBeCloseTo(1.62, 10);
  });

  it('still reads as the brand, then "netag"', () => {
    const el = mount(<Wordmark />);
    expect(el.textContent).toBe('netag');
    expect(WORDMARK_LABEL).toBe('OneTag');
  });
});
