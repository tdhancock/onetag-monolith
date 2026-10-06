/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/TagQRCode.test.tsx
//
// A Tag's QR code on screen (ONE-33, ONE-136). A printed code that doesn't
// scan is worse than none, and the screen is what an owner checks before
// printing, so what it draws is pinned here:
//
//   * it draws tagQrLayout — the layout the exported image is drawn from —
//     so the screen shows exactly what prints, and what it draws, read back
//     and handed to a QR reader, decodes to buildTagUrl(shortCode);
//   * error correction is H, and the quiet zone is four modules;
//   * the OneTag mark sits in the cleared centre, its front ring filled with
//     the ground so it sits over the back one;
//   * it is pure black on pure white on any theme, with the short code
//     beneath in DM Mono;
//   * a malformed short code renders nothing, so it is never encoded.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

jest.mock('react-native', () => require('../support/reactNativeDom'));

// react-native-svg drawn as real SVG elements, so the drawing can be read back.
jest.mock('react-native-svg', () => {
  const React = require('react');
  const element =
    (tag: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(tag, props, children);
  const Svg = element('svg');
  return { __esModule: true, default: Svg, Svg, Rect: element('rect'), Path: element('path'), Circle: element('circle') };
});

import jsQR from 'jsqr';
import QRCode from 'qrcode';
import TagQRCode, { QR_GROUND, QR_INK, qrModulePath } from '../../components/native/TagQRCode';
import { buildTagUrl, resolveTagBaseUrl } from '../../lib/tagLinks';
import { TAG_QR_ERROR_CORRECTION, TAG_QR_QUIET_ZONE_MODULES, tagQrLayout } from '../../lib/tagQr';
import { type } from '../../theme/tokens';

// qrcode encodes with TextEncoder, which jsdom leaves out; node has it.
(globalThis as { TextEncoder?: unknown }).TextEncoder ??= require('util').TextEncoder;

const CODE = 'ABC23XYZ';

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

interface Drawn {
  /** The viewBox's side, in modules. */
  span: number;
  /** `dark[y][x]` over the whole viewBox, quiet zone included, from the path. */
  dark: boolean[][];
  circles: { cx: number; cy: number; r: number; strokeWidth: number; fill: string | null; stroke: string | null }[];
}

/** Read the drawing back out of the DOM: the path's runs, and the circles. */
const readDrawing = (el: HTMLElement): Drawn => {
  const svg = el.querySelector('svg')!;
  const [, , w, h] = svg.getAttribute('viewBox')!.split(' ').map(Number);
  expect(w).toBe(h);
  const span = w!;
  const dark = Array.from({ length: span }, () => new Array<boolean>(span).fill(false));
  const d = el.querySelector('path')!.getAttribute('d')!;
  for (const [, x, y, run] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(run); i += 1) dark[Number(y)]![Number(x) + i] = true;
  }
  // Every subpath is a one-module-tall run; nothing else is drawn.
  expect(d.replace(/M\d+ \d+h\d+v1h-\d+z/g, '')).toBe('');
  const circles = Array.from(el.querySelectorAll('circle')).map((c) => ({
    cx: Number(c.getAttribute('cx')),
    cy: Number(c.getAttribute('cy')),
    r: Number(c.getAttribute('r')),
    strokeWidth: Number(c.getAttribute('stroke-width')),
    fill: c.getAttribute('fill'),
    stroke: c.getAttribute('stroke'),
  }));
  return { span, dark, circles };
};

/**
 * Rasterise the drawing, `ppm` pixels a module, the way an SVG renderer would:
 * the ground, then the modules, the back ring's stroke, then the front ring
 * filled with the ground and stroked.
 */
const rasterise = ({ span, dark, circles }: Drawn, ppm: number): boolean[][] => {
  const [back, front] = circles;
  return Array.from({ length: span * ppm }, (_, py) =>
    Array.from({ length: span * ppm }, (_, px) => {
      const x = (px + 0.5) / ppm;
      const y = (py + 0.5) / ppm;
      let ink = dark[Math.floor(y)]![Math.floor(x)]!;
      for (const ring of [back, front]) {
        if (!ring) continue;
        const distance = Math.hypot(x - ring.cx, y - ring.cy);
        if (ring.fill === QR_GROUND && distance <= ring.r) ink = false;
        if (Math.abs(distance - ring.r) <= ring.strokeWidth / 2) ink = true;
      }
      return ink;
    }),
  );
};

const readQr = (black: boolean[][]): string | undefined => {
  const size = black.length;
  const rgba = new Uint8ClampedArray(size * size * 4);
  black.forEach((row, y) =>
    row.forEach((isBlack, x) => {
      const value = isBlack ? 0 : 255;
      rgba.set([value, value, value, 255], (y * size + x) * 4);
    }),
  );
  return jsQR(rgba, size, size)?.data;
};

describe('what the code encodes', () => {
  it('draws a code that a QR reader decodes to exactly buildTagUrl(shortCode)', () => {
    const drawn = readDrawing(mount(<TagQRCode shortCode={CODE} size={240} />));
    expect(readQr(rasterise(drawn, 8))).toBe(buildTagUrl(CODE));
    expect(buildTagUrl(CODE)).toBe(`${resolveTagBaseUrl(process.env.EXPO_PUBLIC_TAG_BASE_URL)}/t/${CODE}`);
  });

  it('draws tagQrLayout, module for module: what the export prints', () => {
    const layout = tagQrLayout(CODE);
    const drawn = readDrawing(mount(<TagQRCode shortCode={CODE} size={240} />));
    const q = TAG_QR_QUIET_ZONE_MODULES;
    for (let y = 0; y < drawn.span; y += 1) {
      for (let x = 0; x < drawn.span; x += 1) {
        const inCode = y >= q && x >= q && y < q + layout.modules && x < q + layout.modules;
        expect(drawn.dark[y]![x]).toBe(inCode && layout.dark[y - q]![x - q]!);
      }
    }
    expect(qrModulePath(layout)).toBe(document.querySelector('path')!.getAttribute('d'));
  });

  it('uses error correction level H', () => {
    expect(TAG_QR_ERROR_CORRECTION).toBe('H');
    const { modules } = QRCode.create(buildTagUrl(CODE), { errorCorrectionLevel: 'H' });
    expect(tagQrLayout(CODE).modules).toBe(modules.size);
  });

  it.each(['', 'abc', 'ABC23XY0', 'ABC23XYZZ', 'https://onetag.app/t/ABC23XYZ', 'ABC 23XY'])(
    'renders nothing, and encodes nothing, for the malformed code %p',
    (bad) => {
      const el = mount(<TagQRCode shortCode={bad} size={240} />);
      expect(el.innerHTML).toBe('');
    },
  );
});

describe('how it is drawn', () => {
  it('has a quiet zone of exactly four modules all round', () => {
    const drawn = readDrawing(mount(<TagQRCode shortCode={CODE} size={240} />));
    expect(drawn.span).toBe(tagQrLayout(CODE).modules + 2 * TAG_QR_QUIET_ZONE_MODULES);
    const q = TAG_QR_QUIET_ZONE_MODULES;
    drawn.dark.forEach((row, y) =>
      row.forEach((isDark, x) => {
        if (y < q || x < q || y >= drawn.span - q || x >= drawn.span - q) expect(isDark).toBe(false);
      }),
    );
  });

  it('draws it at the size asked for, quiet zone included', () => {
    const svg = mount(<TagQRCode shortCode={CODE} size={240} />).querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('240');
    expect(svg.getAttribute('height')).toBe('240');
  });

  it('draws the OneTag mark in the cleared centre, the front ring over the back one', () => {
    const layout = tagQrLayout(CODE);
    const { circles } = readDrawing(mount(<TagQRCode shortCode={CODE} size={240} />));
    const q = TAG_QR_QUIET_ZONE_MODULES;
    const { mark } = layout;
    expect(circles).toHaveLength(2);
    const [back, front] = circles;
    expect(back).toMatchObject({
      cx: q + mark!.left + mark!.geometry.back.cx,
      cy: q + mark!.top + mark!.geometry.back.cy,
      r: mark!.geometry.back.r,
      strokeWidth: mark!.geometry.stroke,
      stroke: QR_INK,
      fill: 'none',
    });
    expect(front).toMatchObject({
      cx: q + mark!.left + mark!.geometry.front.cx,
      r: mark!.geometry.front.r,
      stroke: QR_INK,
      fill: QR_GROUND,
    });
  });

  it('is pure black on pure white, not theme tokens', () => {
    const el = mount(<TagQRCode shortCode={CODE} size={240} />);
    expect(QR_INK).toBe('#000000');
    expect(QR_GROUND).toBe('#ffffff');
    expect(el.querySelector('path')!.getAttribute('fill')).toBe(QR_INK);
    expect(el.querySelector('rect')!.getAttribute('fill')).toBe(QR_GROUND);
    const card = el.querySelector('[aria-label="QR code for tag ABC23XYZ"]') as HTMLElement;
    expect(card.style.backgroundColor).toBe('rgb(255, 255, 255)');
  });

  it('prints the short code beneath the code, in DM Mono', () => {
    const el = mount(<TagQRCode shortCode={CODE} size={240} />);
    const text = Array.from(el.querySelectorAll('span')).find((span) => span.textContent === CODE) as HTMLElement;
    expect(text).toBeDefined();
    expect(text.style.fontFamily).toBe(type.mono);
    // After the code, so beneath it.
    const qr = el.querySelector('svg')!;
    expect(qr.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the short code legible on a small code', () => {
    const el = mount(<TagQRCode shortCode={CODE} size={80} />);
    expect(parseFloat(el.querySelector('span')!.style.fontSize)).toBeGreaterThanOrEqual(13);
  });

  it('can leave the short code out', () => {
    const el = mount(<TagQRCode shortCode={CODE} size={240} showCode={false} />);
    expect(el.textContent).not.toContain(CODE);
  });
});
