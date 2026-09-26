/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/TagQRCode.test.tsx
//
// A Tag's QR code (ONE-33). A printed code that doesn't scan is worse than
// none, so what it encodes and how is pinned here:
//
//   * the payload is exactly buildTagUrl(shortCode) — the component takes a
//     short code, never a URL;
//   * error correction is H, and the quiet zone is at least four modules at
//     the version this payload actually needs;
//   * it is pure black on pure white on any theme, with the short code
//     beneath in DM Mono;
//   * a malformed short code renders nothing, so it is never encoded.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

jest.mock('react-native', () => require('../support/reactNativeDom'));

/** Every set of props the encoder was handed. */
const mockEncoded: Record<string, unknown>[] = [];
jest.mock('react-native-qrcode-svg', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      mockEncoded.push(props);
      return React.createElement('div', { 'data-qr': props.value });
    },
  };
});

import TagQRCode, {
  QR_GROUND,
  QR_INK,
  TAG_QR_ERROR_CORRECTION,
  TAG_QR_QUIET_ZONE_MODULES,
  tagQrQuietZone,
} from '../../components/native/TagQRCode';
import { buildTagUrl, resolveTagBaseUrl } from '../../lib/tagLinks';
import { type } from '../../theme/tokens';

const CODE = 'ABC23XYZ';

// The encoder react-native-qrcode-svg draws with, read here for the module
// count. It encodes with TextEncoder, which jsdom leaves out; node has it.
(globalThis as { TextEncoder?: unknown }).TextEncoder ??= require('util').TextEncoder;
const QRCodeModel: { create: (text: string, options: { errorCorrectionLevel: string }) => { modules: { size: number } } } =
  require('qrcode');

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
  mockEncoded.length = 0;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** The quiet zone, in modules, for a payload drawn `size` wide. */
const quietModules = (payload: string, size: number) => {
  const modules = QRCodeModel.create(payload, { errorCorrectionLevel: 'H' }).modules.size;
  return tagQrQuietZone(size) / (size / modules);
};

describe('what the code encodes', () => {
  it('encodes exactly buildTagUrl(shortCode)', () => {
    mount(<TagQRCode shortCode={CODE} size={240} />);
    expect(mockEncoded).toHaveLength(1);
    expect(mockEncoded[0]!.value).toBe(buildTagUrl(CODE));
    expect(mockEncoded[0]!.value).toBe(`${resolveTagBaseUrl(process.env.EXPO_PUBLIC_TAG_BASE_URL)}/t/${CODE}`);
  });

  it('uses error correction level H', () => {
    mount(<TagQRCode shortCode={CODE} size={240} />);
    expect(TAG_QR_ERROR_CORRECTION).toBe('H');
    expect(mockEncoded[0]!.ecl).toBe('H');
  });

  it.each(['', 'abc', 'ABC23XY0', 'ABC23XYZZ', 'https://onetag.app/t/ABC23XYZ', 'ABC 23XY'])(
    'renders nothing, and encodes nothing, for the malformed code %p',
    (bad) => {
      const el = mount(<TagQRCode shortCode={bad} size={240} />);
      expect(mockEncoded).toHaveLength(0);
      expect(el.innerHTML).toBe('');
    },
  );
});

describe('how it is drawn', () => {
  it('has a quiet zone of at least four modules at the version the tag URL needs', () => {
    mount(<TagQRCode shortCode={CODE} size={240} />);
    expect(mockEncoded[0]!.quietZone).toBe(tagQrQuietZone(240));
    expect(quietModules(buildTagUrl(CODE), 240)).toBeGreaterThanOrEqual(TAG_QR_QUIET_ZONE_MODULES);
  });

  it('keeps at least four modules of quiet zone for any payload length, down to the smallest code', () => {
    for (const payload of ['x', 'https://onetag.app/t/ABC23XYZ', `https://${'a'.repeat(120)}.example/t/ABC23XYZ`]) {
      for (const size of [120, 240, 1200]) {
        expect(quietModules(payload, size)).toBeGreaterThanOrEqual(TAG_QR_QUIET_ZONE_MODULES);
      }
    }
  });

  it('is pure black on pure white, not theme tokens', () => {
    const el = mount(<TagQRCode shortCode={CODE} size={240} />);
    expect(QR_INK).toBe('#000000');
    expect(QR_GROUND).toBe('#ffffff');
    expect(mockEncoded[0]!.color).toBe(QR_INK);
    expect(mockEncoded[0]!.backgroundColor).toBe(QR_GROUND);
    const card = el.querySelector('[aria-label="QR code for tag ABC23XYZ"]') as HTMLElement;
    expect(card.style.backgroundColor).toBe('rgb(255, 255, 255)');
  });

  it('prints the short code beneath the code, in DM Mono', () => {
    const el = mount(<TagQRCode shortCode={CODE} size={240} />);
    const text = Array.from(el.querySelectorAll('span')).find((span) => span.textContent === CODE) as HTMLElement;
    expect(text).toBeDefined();
    expect(text.style.fontFamily).toBe(type.mono);
    // After the code, so beneath it.
    const qr = el.querySelector('[data-qr]')!;
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

  it('hands the rendered Svg to getRef, for export', () => {
    const getRef = jest.fn();
    mount(<TagQRCode shortCode={CODE} size={240} getRef={getRef} />);
    expect(mockEncoded[0]!.getRef).toBe(getRef);
  });
});
