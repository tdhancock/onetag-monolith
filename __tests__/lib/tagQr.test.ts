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
//   * a malformed short code is refused, never encoded.

import { crc32, inflateSync } from 'zlib';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { encodeBitmapPng, PNG_SIGNATURE } from '../../lib/png';
import { buildTagUrl } from '../../lib/tagLinks';
import { TAG_QR_ERROR_CORRECTION, TAG_QR_EXPORT_PX, TAG_QR_QUIET_ZONE_MODULES, tagQrPng } from '../../lib/tagQr';

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

  it('is a square at least TAG_QR_EXPORT_PX on a side', () => {
    expect(image).toMatchObject({ width: exported.size, height: exported.size, bitDepth: 1, colourType: 0 });
    expect(exported.size).toBeGreaterThanOrEqual(TAG_QR_EXPORT_PX);
  });

  it('draws every module the same whole number of pixels, with a four-module quiet zone', () => {
    expect(exported.modules).toBe(matrix.size);
    expect(Number.isInteger(exported.pixelsPerModule)).toBe(true);
    expect(exported.size).toBe((matrix.size + 2 * TAG_QR_QUIET_ZONE_MODULES) * exported.pixelsPerModule);
  });

  it('fills the image: every pixel is the module it sits in, and the quiet zone is white', () => {
    const { pixelsPerModule } = exported;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const row = Math.floor(y / pixelsPerModule) - TAG_QR_QUIET_ZONE_MODULES;
        const col = Math.floor(x / pixelsPerModule) - TAG_QR_QUIET_ZONE_MODULES;
        const inCode = row >= 0 && row < matrix.size && col >= 0 && col < matrix.size;
        const expected = inCode && matrix.get(row, col) === 1;
        if (image.black[y]![x] !== expected) throw new Error(`pixel (${x}, ${y}) is wrong`);
      }
    }
    // The code reaches the far corner, not just the top-left of the image.
    const last = image.width - 1 - TAG_QR_QUIET_ZONE_MODULES * pixelsPerModule;
    expect(image.black[last]![TAG_QR_QUIET_ZONE_MODULES * pixelsPerModule]).toBe(true);
  });

  it('decodes to buildTagUrl(shortCode) in a QR reader', () => {
    const rgba = new Uint8ClampedArray(image.width * image.height * 4);
    image.black.forEach((row, y) =>
      row.forEach((isBlack, x) => {
        const value = isBlack ? 0 : 255;
        rgba.set([value, value, value, 255], (y * image.width + x) * 4);
      }),
    );
    expect(jsQR(rgba, image.width, image.height)?.data).toBe(buildTagUrl(CODE));
  });

  it.each(['', 'abc', 'ABC23XY0', 'https://onetag.app/t/ABC23XYZ'])('refuses the malformed code %p', (bad) => {
    expect(() => tagQrPng(bad)).toThrow('Not a tag short code');
  });
});
