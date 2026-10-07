// A tag's short code as 1-bit text (ONE-144), for the printed images.
//
// On screen, TagQRCode prints the short code under every code: the fallback
// when a sticker is too scuffed to scan, and what tells blank tags apart
// before they are linked. The printed images are 1-bit PNGs drawn by hand
// (lib/png.ts), with no text rendering, so the code is stamped here from
// lib/shortCodeFont.ts — DM Mono Medium, rasterised once — at a whole number
// of pixels a glyph pixel, so its edges stay as sharp as the modules'.

import { SHORT_CODE_FONT } from './shortCodeFont';

/**
 * The space between letters, as a fraction of a glyph's width. Wide, as on
 * screen, so look-alike glyphs stay apart when read off a sticker.
 */
const TRACKING = 0.2;

/** Clear one pixel's bit: ink, in rows packed eight pixels a byte with a set bit white. */
export const ink = (row: Uint8Array, x: number): void => {
  row[x >> 3] &= ~(0x80 >> (x & 7));
};

/** Each glyph's rows as booleans, read from the table once. */
const glyphBits = new Map<string, boolean[][]>(
  Object.entries(SHORT_CODE_FONT.glyphs).map(([char, rows]) => [
    char,
    rows.map((hex) =>
      Array.from({ length: SHORT_CODE_FONT.width }, (_, x) => ((parseInt(hex[x >> 2]!, 16) >> (3 - (x & 3))) & 1) === 1),
    ),
  ]),
);

/** The pixels between one glyph and the next, at `scale`. */
const trackingPx = (scale: number) => Math.round(SHORT_CODE_FONT.width * TRACKING * scale);

/** How much room a short code takes, drawn `scale` pixels a glyph pixel. */
export const shortCodeTextSize = (code: string, scale: number): { width: number; height: number } => {
  const glyph = SHORT_CODE_FONT.width * scale;
  return {
    width: code.length * glyph + Math.max(0, code.length - 1) * trackingPx(scale),
    height: SHORT_CODE_FONT.height * scale,
  };
};

/**
 * Draw a short code into 1-bit rows with its top-left corner at (left, top),
 * `scale` pixels a glyph pixel. Every row it touches must be its own array:
 * a row shared by several pixel rows would take the ink in all of them.
 */
export const drawShortCode = (rows: Uint8Array[], left: number, top: number, code: string, scale: number): void => {
  if (!Number.isInteger(scale) || scale < 1) throw new Error(`Draw text at a whole scale, not ${scale}`);
  const step = SHORT_CODE_FONT.width * scale + trackingPx(scale);
  Array.from(code).forEach((char, index) => {
    const bits = glyphBits.get(char);
    if (!bits) throw new Error(`No glyph for ${JSON.stringify(char)}: not a short-code character`);
    const glyphLeft = left + index * step;
    bits.forEach((row, gy) => {
      row.forEach((on, gx) => {
        if (!on) return;
        for (let sy = 0; sy < scale; sy += 1) {
          const target = rows[top + gy * scale + sy]!;
          for (let sx = 0; sx < scale; sx += 1) ink(target, glyphLeft + gx * scale + sx);
        }
      });
    });
  });
};
