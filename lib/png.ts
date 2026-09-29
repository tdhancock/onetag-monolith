// A black-and-white bitmap as a PNG file, built in plain JavaScript.
//
// The QR export draws its image here rather than asking react-native-svg for
// one: `toDataURL` sizes the canvas as asked but draws the code at its size on
// screen, so the code came out small in the top-left corner of a large, mostly
// empty image. A bitmap drawn from the code's own modules has none of that,
// and is the same on every platform.
//
// The image is 1-bit greyscale, stored without compression. A QR code is two
// colours, so one bit a pixel is exact, and a 1200px code is under 200 KB even
// uncompressed: small enough that a deflate implementation isn't worth
// carrying.

/** The eight bytes every PNG file starts with. */
export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 over one or more byte ranges, as PNG chunks need. */
const crc32 = (...parts: Uint8Array[]): number => {
  let crc = 0xffffffff;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) crc = CRC_TABLE[(crc ^ part[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/** Adler-32, the checksum that ends a zlib stream. */
const adler32 = (data: Uint8Array): number => {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i += 1) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
};

const uint32 = (value: number): Uint8Array =>
  new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const name = ascii(type);
  return concat([uint32(data.length), name, data, uint32(crc32(name, data))]);
};

/** The largest stored (uncompressed) deflate block. */
const STORED_BLOCK_MAX = 0xffff;

/** A zlib stream holding `data` in stored deflate blocks: framed, not compressed. */
const zlibStored = (data: Uint8Array): Uint8Array => {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  let offset = 0;
  do {
    const length = Math.min(STORED_BLOCK_MAX, data.length - offset);
    const final = offset + length === data.length ? 1 : 0;
    parts.push(
      new Uint8Array([final, length & 0xff, length >>> 8, ~length & 0xff, (~length >>> 8) & 0xff]),
      data.subarray(offset, offset + length),
    );
    offset += length;
  } while (offset < data.length);
  parts.push(uint32(adler32(data)));
  return concat(parts);
};

/**
 * A bitmap as a 1-bit greyscale PNG.
 *
 * `rows` holds each row's pixels packed eight to a byte, most significant bit
 * first, `ceil(width / 8)` bytes a row: a set bit is white, a clear bit black.
 */
export const encodeBitmapPng = (width: number, height: number, rows: Uint8Array[]): Uint8Array => {
  const rowBytes = Math.ceil(width / 8);
  if (rows.length !== height || rows.some((row) => row.length !== rowBytes)) {
    throw new Error(`A ${width}x${height} bitmap needs ${height} rows of ${rowBytes} bytes.`);
  }

  // Each scanline is a filter byte (0: none) and then the row.
  const scanlines = new Uint8Array(height * (rowBytes + 1));
  rows.forEach((row, y) => scanlines.set(row, y * (rowBytes + 1) + 1));

  const header = concat([uint32(width), uint32(height), new Uint8Array([1, 0, 0, 0, 0])]);
  return concat([
    new Uint8Array(PNG_SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', zlibStored(scanlines)),
    chunk('IEND', new Uint8Array(0)),
  ]);
};
