//
// target: __tests__/lib/tagQr.test.ts
//
// The QR image a tag exports for printing (lib/tagQr.ts, lib/png.ts). The
// export used to come out small in the top-left corner of a mostly empty
// image, so what is pinned here is the image itself, decoded the way any
// reader would:
//
//   * it is a valid PNG: signature, chunk checksums, a zlib stream Node inflates;
//   * the code fills it: at least TAG_QR_EXPORT_PX on a side, every module the
//     same whole number of pixels, a four-module quiet zone all round, and
//     every pixel matching the module it belongs to;
//   * a QR reader decodes it to buildTagUrl(shortCode);
//   * a malformed short code is refused, never encoded;
//   * the OneTag mark sits in a patch cleared in its centre (ONE-136), which
//     covers no function pattern, and the code still scans: for any short
//     code, for a longer tag domain, and shrunk to a quarter of its size;
//   * the short code is printed beneath, below the quiet zone (ONE-144).

import { crc32, inflateSync } from 'zlib';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { encodeBitmapPng, PNG_SIGNATURE } from '../../lib/png';
import { buildTagUrl, TAG_SHORT_CODE_ALPHABET } from '../../lib/tagLinks';
import { isMarkInk } from '../../lib/brandMark';
import { drawShortCode, shortCodeTextSize } from '../../lib/bitmapText';
import {
  qrLayoutForPayload,
  TAG_QR_ERROR_CORRECTION,
  TAG_QR_EXPORT_PX,
  TAG_QR_EXPORT_TEXT_SCALE,
  TAG_QR_MIN_PATCH_MODULES,
  TAG_QR_QUIET_ZONE_MODULES,
  tagQrLayout,
  tagQrPng,
  type TagQrLayout,
} from '../../lib/tagQr';

const CODE = 'ABC23XYZ';

interface DecodedPng {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  /** One boolean a pixel, row by row: true is black. */
  black: boolean[][];
}

/** Read a 1-bit greyscale PNG back, checking every chunk's CRC on the way. */
const decodePng = (png: Uint8Array): DecodedPng => {
  const bytes = Buffer.from(png);
  expect(Array.from(bytes.subarray(0, 8))).toEqual(PNG_SIGNATURE);

  const chunks: { type: string; data: Buffer }[] = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const typeAndData = bytes.subarray(offset + 4, offset + 8 + length);
    expect(bytes.readUInt32BE(offset + 8 + length)).toBe(crc32(typeAndData));
    chunks.push({ type: typeAndData.subarray(0, 4).toString('ascii'), data: typeAndData.subarray(4) });
    offset += 12 + length;
  }
  expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);

  const header = chunks[0]!.data;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const rowBytes = Math.ceil(width / 8);
  // inflateSync checks the zlib header and the Adler-32 trailer.
  const scanlines = inflateSync(chunks[1]!.data);
  expect(scanlines.length).toBe(height * (rowBytes + 1));

  const black: boolean[][] = [];
  for (let y = 0; y < height; y += 1) {
    const start = y * (rowBytes + 1);
    expect(scanlines[start]).toBe(0);
    const row: boolean[] = [];
    for (let x = 0; x < width; x += 1) row.push(((scanlines[start + 1 + (x >> 3)] >> (7 - (x & 7))) & 1) === 0);
    black.push(row);
  }
  return { width, height, bitDepth: header[8]!, colourType: header[9]!, black };
};

/** What jsQR reads from this bitmap, if anything. */
const readQr = (black: boolean[][]): string | undefined => {
  const height = black.length;
  const width = black[0]!.length;
  const rgba = new Uint8ClampedArray(width * height * 4);
  black.forEach((row, y) =>
    row.forEach((isBlack, x) => {
      const value = isBlack ? 0 : 255;
      rgba.set([value, value, value, 255], (y * width + x) * 4);
    }),
  );
  return jsQR(rgba, width, height)?.data;
};

/** The image shrunk by `factor`, each block of pixels averaged to grey, as a camera at a distance sees it. */
const shrink = (black: boolean[][], factor: number) => {
  const width = Math.floor(black[0]!.length / factor);
  const height = Math.floor(black.length / factor);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let white = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) if (!black[y * factor + dy]![x * factor + dx]) white += 1;
      }
      const value = Math.round((255 * white) / (factor * factor));
      rgba.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return { rgba, width, height };
};

const inPatch = (layout: TagQrLayout, row: number, col: number) =>
  layout.patch !== null &&
  row >= layout.patch.start &&
  row < layout.patch.start + layout.patch.size &&
  col >= layout.patch.start &&
  col < layout.patch.start + layout.patch.size;

/** Whether the patch covers no module qrcode reserves for a function pattern. */
const patchCoversNoFunctionPattern = (layout: TagQrLayout) => {
  const matrix = QRCode.create(layout.payload, { errorCorrectionLevel: TAG_QR_ERROR_CORRECTION }).modules;
  for (let row = 0; row < layout.modules; row += 1) {
    for (let col = 0; col < layout.modules; col += 1) {
      if (inPatch(layout, row, col) && matrix.isReserved(row, col)) return false;
    }
  }
  return true;
};

/** Short codes from a fixed seed, so a failure names a code that fails on every run. */
const seededCodes = (count: number): string[] => {
  let seed = 0x0e136;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  return Array.from({ length: count }, () =>
    Array.from({ length: 8 }, () => TAG_SHORT_CODE_ALPHABET[next() % TAG_SHORT_CODE_ALPHABET.length]).join(''),
  );
};

describe('the PNG encoder', () => {
  it('writes a 1-bit greyscale image that decodes pixel for pixel', () => {
    // 10 wide: the second byte of each row has two pixels and six padding bits.
    const rows = [new Uint8Array([0b10101010, 0b11000000]), new Uint8Array([0b01010101, 0b00111111])];
    const decoded = decodePng(encodeBitmapPng(10, 2, rows));
    expect(decoded).toMatchObject({ width: 10, height: 2, bitDepth: 1, colourType: 0 });
    expect(decoded.black.map((row) => row.map((b) => (b ? 'x' : '.')).join(''))).toEqual(['.x.x.x.x..', 'x.x.x.x.xx']);
  });

  it('splits a bitmap larger than one stored deflate block into several', () => {
    // 2000 x 300 is 300 rows of 251 bytes: over 75 KB, more than a block holds.
    const rows = Array.from({ length: 300 }, (_, y) => new Uint8Array(250).fill(y % 2 ? 0xff : 0x00));
    const decoded = decodePng(encodeBitmapPng(2000, 300, rows));
    expect(decoded.black[0]!.every(Boolean)).toBe(true);
    expect(decoded.black[299]!.some(Boolean)).toBe(false);
  });

  it('refuses rows that do not match the size', () => {
    expect(() => encodeBitmapPng(16, 2, [new Uint8Array(2)])).toThrow('needs 2 rows of 2 bytes');
  });
});

describe("a tag's exported QR code", () => {
  const exported = tagQrPng(CODE);
  const image = decodePng(exported.png);
  const matrix = QRCode.create(buildTagUrl(CODE), { errorCorrectionLevel: TAG_QR_ERROR_CORRECTION }).modules;

  it('is at least TAG_QR_EXPORT_PX wide: the code square on top, the short code beneath', () => {
    expect(image).toMatchObject({ width: exported.size, height: exported.height, bitDepth: 1, colourType: 0 });
    expect(exported.size).toBeGreaterThanOrEqual(TAG_QR_EXPORT_PX);
    expect(exported.height).toBeGreaterThan(exported.size);
  });

  it('draws every module the same whole number of pixels, with a four-module quiet zone', () => {
    expect(exported.modules).toBe(matrix.size);
    expect(Number.isInteger(exported.pixelsPerModule)).toBe(true);
    expect(exported.size).toBe((matrix.size + 2 * TAG_QR_QUIET_ZONE_MODULES) * exported.pixelsPerModule);
  });

  it('fills the image: every pixel outside the centre patch is the module it sits in, and the quiet zone is white', () => {
    const { pixelsPerModule, layout } = exported;
    expect(layout.patch).not.toBeNull();
    for (let y = 0; y < exported.size; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const row = Math.floor(y / pixelsPerModule) - TAG_QR_QUIET_ZONE_MODULES;
        const col = Math.floor(x / pixelsPerModule) - TAG_QR_QUIET_ZONE_MODULES;
        if (inPatch(layout, row, col)) continue;
        const inCode = row >= 0 && row < matrix.size && col >= 0 && col < matrix.size;
        const expected = inCode && matrix.get(row, col) === 1;
        if (image.black[y]![x] !== expected) throw new Error(`pixel (${x}, ${y}) is wrong`);
      }
    }
    // The code reaches the far corner, not just the top-left of the image.
    const last = image.width - 1 - TAG_QR_QUIET_ZONE_MODULES * pixelsPerModule;
    expect(image.black[last]![TAG_QR_QUIET_ZONE_MODULES * pixelsPerModule]).toBe(true);
  });

  it("draws only the mark inside the centre patch, sampled at each pixel's centre", () => {
    const { pixelsPerModule, layout } = exported;
    const patch = layout.patch!;
    const mark = layout.mark!;
    const q = TAG_QR_QUIET_ZONE_MODULES;
    const from = (patch.start + q) * pixelsPerModule;
    const to = (patch.start + patch.size + q) * pixelsPerModule;
    let ink = 0;
    for (let y = from; y < to; y += 1) {
      for (let x = from; x < to; x += 1) {
        const mx = (x + 0.5) / pixelsPerModule - q - mark.left;
        const my = (y + 0.5) / pixelsPerModule - q - mark.top;
        const expected = isMarkInk(mark.geometry, mx, my);
        if (image.black[y]![x] !== expected) throw new Error(`pixel (${x}, ${y}) is wrong`);
        if (expected) ink += 1;
      }
    }
    // The mark is really there, not an empty patch.
    expect(ink).toBeGreaterThan(pixelsPerModule * pixelsPerModule * 4);
  });

  it('decodes to buildTagUrl(shortCode) in a QR reader', () => {
    expect(readQr(image.black)).toBe(buildTagUrl(CODE));
  });

  it.each(['', 'abc', 'ABC23XY0', 'https://onetag.app/t/ABC23XYZ'])('refuses the malformed code %p', (bad) => {
    expect(() => tagQrPng(bad)).toThrow('Not a tag short code');
  });
});

describe('the centre patch and the mark (ONE-136)', () => {
  const layout = tagQrLayout(CODE);

  it('clears an odd square of whole modules, about a third of the code across, in the centre', () => {
    const patch = layout.patch!;
    expect(patch.size % 2).toBe(1);
    expect(Math.abs(patch.size - layout.modules / 3)).toBeLessThanOrEqual(1);
    expect(patch.start * 2 + patch.size).toBe(layout.modules);
    for (let row = patch.start; row < patch.start + patch.size; row += 1) {
      for (let col = patch.start; col < patch.start + patch.size; col += 1) expect(layout.dark[row]![col]).toBe(false);
    }
  });

  it('covers no finder, timing or alignment pattern, nor the format information', () => {
    expect(patchCoversNoFunctionPattern(layout)).toBe(true);
  });

  it('draws the mark one module inside the patch, centred', () => {
    const patch = layout.patch!;
    const mark = layout.mark!;
    expect(mark.geometry.width).toBeCloseTo(patch.size - 2, 10);
    expect(mark.left).toBe(patch.start + 1);
    expect(mark.top + mark.geometry.height / 2).toBeCloseTo(patch.start + patch.size / 2, 10);
  });

  it('keeps every module outside the patch as the encoder made it', () => {
    const matrix = QRCode.create(buildTagUrl(CODE), { errorCorrectionLevel: TAG_QR_ERROR_CORRECTION }).modules;
    for (let row = 0; row < layout.modules; row += 1) {
      for (let col = 0; col < layout.modules; col += 1) {
        if (!inPatch(layout, row, col)) expect(layout.dark[row]![col]).toBe(matrix.get(row, col) === 1);
      }
    }
  });

  it('decodes for 50 short codes', () => {
    for (const code of seededCodes(50)) {
      const decoded = readQr(decodePng(tagQrPng(code).png).black);
      if (decoded !== buildTagUrl(code)) throw new Error(`${code} decoded as ${decoded}`);
    }
  });

  it('decodes shrunk to a quarter of its size, its pixels averaged in blocks', () => {
    const { rgba, width, height } = shrink(decodePng(tagQrPng(CODE).png).black, 4);
    expect(jsQR(rgba, width, height)?.data).toBe(buildTagUrl(CODE));
  });

  it.each([
    ['5', 'https://tags.onetag-example.dev', 5],
    ['6', 'https://tags.onetag-example.workers.dev', 6],
  ])('keeps the mark clear of every function pattern on a version-%s code, from a longer tag domain', (_, base, version) => {
    const before = process.env.EXPO_PUBLIC_TAG_BASE_URL;
    process.env.EXPO_PUBLIC_TAG_BASE_URL = base;
    try {
      jest.isolateModules(() => {
        const links: typeof import('../../lib/tagLinks') = require('../../lib/tagLinks');
        const qr: typeof import('../../lib/tagQr') = require('../../lib/tagQr');
        const url = links.buildTagUrl(CODE);
        expect(url.startsWith(base)).toBe(true);
        expect(QRCode.create(url, { errorCorrectionLevel: 'H' }).version).toBe(version);
        const exported = qr.tagQrPng(CODE);
        expect(exported.layout.patch).not.toBeNull();
        expect(patchCoversNoFunctionPattern(exported.layout)).toBe(true);
        expect(readQr(decodePng(exported.png).black)).toBe(url);
      });
    } finally {
      if (before === undefined) delete process.env.EXPO_PUBLIC_TAG_BASE_URL;
      else process.env.EXPO_PUBLIC_TAG_BASE_URL = before;
    }
  });

  it('clears no patch, and draws no mark, where an alignment pattern holds the centre (version 7 and up)', () => {
    const payload = `https://${'a'.repeat(40)}.example/t/${CODE}`;
    const matrix = QRCode.create(payload, { errorCorrectionLevel: 'H' }).modules;
    expect(QRCode.create(payload, { errorCorrectionLevel: 'H' }).version).toBeGreaterThanOrEqual(7);
    const long = qrLayoutForPayload(payload);
    expect(long.patch).toBeNull();
    expect(long.mark).toBeNull();
    for (let row = 0; row < long.modules; row += 1) {
      for (let col = 0; col < long.modules; col += 1) expect(long.dark[row]![col]).toBe(matrix.get(row, col) === 1);
    }
  });

  it('clears nothing on version 1, which no tag URL fits, where the format information reaches the centre', () => {
    expect(QRCode.create('x'.repeat(7), { errorCorrectionLevel: 'H' }).version).toBe(1);
    expect(qrLayoutForPayload('x'.repeat(7)).patch).toBeNull();
  });

  // The longest payload each version holds at level H, in bytes. A tag URL is
  // over 20 bytes even on a one-letter domain, so version 2 is the smallest.
  it.each([
    [2, 14],
    [3, 24],
    [4, 34],
    [5, 44],
    [6, 58],
  ])('fits a patch of at least the minimum on version %i, covering no function pattern', (version, capacity) => {
    const payload = 'x'.repeat(capacity);
    expect(QRCode.create(payload, { errorCorrectionLevel: 'H' }).version).toBe(version);
    const fitted = qrLayoutForPayload(payload);
    expect(fitted.patch!.size).toBeGreaterThanOrEqual(TAG_QR_MIN_PATCH_MODULES);
    expect(patchCoversNoFunctionPattern(fitted)).toBe(true);
  });
});

describe('the short code beneath an exported code (ONE-144)', () => {
  const exported = tagQrPng(CODE);
  const image = decodePng(exported.png);
  const { text, size } = exported;

  it('is drawn below the quiet zone, centred, at the export scale', () => {
    expect(text.top).toBe(size);
    expect(text).toMatchObject(shortCodeTextSize(CODE, TAG_QR_EXPORT_TEXT_SCALE));
    expect(Math.abs(text.left + text.width / 2 - size / 2)).toBeLessThanOrEqual(1);
    expect(exported.height).toBe(size + text.height + TAG_QR_QUIET_ZONE_MODULES * exported.pixelsPerModule);
  });

  it('is exactly the short code, drawn from the glyph table', () => {
    const rowBytes = Math.ceil(size / 8);
    const expected = Array.from({ length: exported.height - size }, () => new Uint8Array(rowBytes).fill(0xff));
    drawShortCode(expected, text.left, 0, CODE, TAG_QR_EXPORT_TEXT_SCALE);
    for (let y = size; y < exported.height; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const want = (expected[y - size]![x >> 3]! & (0x80 >> (x & 7))) === 0;
        if (image.black[y]![x] !== want) throw new Error(`pixel (${x}, ${y}) is wrong`);
      }
    }
  });

  it('leaves the quiet zone under the code white', () => {
    const q = TAG_QR_QUIET_ZONE_MODULES * exported.pixelsPerModule;
    for (let y = size - q; y < size; y += 1) expect(image.black[y]!.some(Boolean)).toBe(false);
  });

  it('still lets the code decode', () => {
    expect(readQr(image.black)).toBe(buildTagUrl(CODE));
  });
});
