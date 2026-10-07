//
// target: __tests__/lib/bitmapText.test.ts
//
// A short code as 1-bit text, for the printed images (ONE-144). What is
// pinned: the glyph table covers exactly the characters a short code can
// hold, each glyph is whole and distinct, and drawing stays inside the box it
// says it takes, at any whole scale.

import { SHORT_CODE_FONT } from '../../lib/shortCodeFont';
import { drawShortCode, shortCodeTextSize } from '../../lib/bitmapText';
import { TAG_SHORT_CODE_ALPHABET } from '../../lib/tagLinks';

/** Blank rows wide and tall enough to draw into, with a margin all round. */
const canvas = (width: number, height: number) =>
  Array.from({ length: height }, () => new Uint8Array(Math.ceil(width / 8)).fill(0xff));

const isInk = (rows: Uint8Array[], x: number, y: number) => (rows[y]![x >> 3]! & (0x80 >> (x & 7))) === 0;

/** Every inked pixel, as "x,y". */
const inked = (rows: Uint8Array[], width: number) => {
  const found: string[] = [];
  rows.forEach((_, y) => {
    for (let x = 0; x < width; x += 1) if (isInk(rows, x, y)) found.push(`${x},${y}`);
  });
  return found;
};

describe('the glyph table', () => {
  it('holds exactly the characters a short code can hold', () => {
    expect(Object.keys(SHORT_CODE_FONT.glyphs).sort()).toEqual(Array.from(TAG_SHORT_CODE_ALPHABET).sort());
  });

  it('gives every glyph the same box, a row of hex per pixel row', () => {
    for (const rows of Object.values(SHORT_CODE_FONT.glyphs)) {
      expect(rows).toHaveLength(SHORT_CODE_FONT.height);
      for (const row of rows) expect(row).toMatch(new RegExp(`^[0-9a-f]{${Math.ceil(SHORT_CODE_FONT.width / 4)}}$`));
    }
  });

  it('draws every glyph, and no two alike', () => {
    const shapes = Object.values(SHORT_CODE_FONT.glyphs).map((rows) => rows.join(''));
    expect(shapes.every((shape) => /[1-9a-f]/.test(shape))).toBe(true);
    expect(new Set(shapes).size).toBe(shapes.length);
  });
});

describe('drawShortCode', () => {
  const CODE = 'Kp7mQx3R';

  it.each([1, 2, 3])('stays inside the box shortCodeTextSize gives, at scale %i', (scale) => {
    const { width, height } = shortCodeTextSize(CODE, scale);
    const rows = canvas(width + 40, height + 40);
    drawShortCode(rows, 20, 20, CODE, scale);
    const pixels = inked(rows, width + 40).map((p) => p.split(',').map(Number) as [number, number]);
    expect(pixels.length).toBeGreaterThan(0);
    for (const [x, y] of pixels) {
      expect(x).toBeGreaterThanOrEqual(20);
      expect(x).toBeLessThan(20 + width);
      expect(y).toBeGreaterThanOrEqual(20);
      expect(y).toBeLessThan(20 + height);
    }
  });

  it('draws every glyph pixel as a whole square at a larger scale', () => {
    const one = canvas(400, 60);
    drawShortCode(one, 0, 0, 'A', 1);
    const two = canvas(400, 120);
    drawShortCode(two, 0, 0, 'A', 2);
    for (let y = 0; y < SHORT_CODE_FONT.height; y += 1) {
      for (let x = 0; x < SHORT_CODE_FONT.width; x += 1) {
        const on = isInk(one, x, y);
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) expect(isInk(two, 2 * x + dx, 2 * y + dy)).toBe(on);
      }
    }
  });

  it('draws different codes differently, and the same code the same', () => {
    const { width, height } = shortCodeTextSize(CODE, 1);
    const draw = (code: string) => {
      const rows = canvas(width, height);
      drawShortCode(rows, 0, 0, code, 1);
      return inked(rows, width).join(' ');
    };
    expect(draw(CODE)).toBe(draw(CODE));
    expect(draw(CODE)).not.toBe(draw('Kp7mQx3S'));
  });

  it('spaces letters apart, so look-alikes stay distinct', () => {
    const one = shortCodeTextSize('A', 1).width;
    const two = shortCodeTextSize('AA', 1).width;
    expect(two - 2 * one).toBeGreaterThan(0);
  });

  it.each(['0', 'O', 'I', 'l', '1', ' '])('refuses %p, which no short code holds', (char) => {
    expect(() => drawShortCode(canvas(100, 60), 0, 0, char, 1)).toThrow('not a short-code character');
  });

  it('refuses a fractional scale', () => {
    expect(() => drawShortCode(canvas(100, 60), 0, 0, 'A', 1.5)).toThrow('whole scale');
  });
});
