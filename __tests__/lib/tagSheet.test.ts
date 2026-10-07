//
// target: __tests__/lib/tagSheet.test.ts
//
// A printable sheet of blank tags' codes (ONE-138). Printed sheets are found
// out only after the stickers are paid for, so what is pinned here is the
// sheet itself, read the way a printer and a phone would:
//
//   * it is US Letter at 300 dpi, a 1-bit PNG;
//   * it holds twelve codes in three columns and four rows, each inside its
//     own cell, inside the margin, at whole pixels a module;
//   * every cell, cut out along its guide, decodes to its own tag's URL;
//   * dashed cut guides run along the cell edges and never touch a code;
//   * a batch of 24 makes two sheets holding every code once.

import jsQR from 'jsqr';
import { buildTagUrl, TAG_SHORT_CODE_ALPHABET } from '../../lib/tagLinks';
import {
  CODES_PER_SHEET,
  drawSheet,
  SHEET_CELL_PX,
  SHEET_CODE_PX,
  SHEET_COLUMNS,
  SHEET_HEIGHT_PX,
  SHEET_MARGIN_PX,
  SHEET_ROWS,
  SHEET_WIDTH_PX,
  sheetCells,
  sheetsOf,
  tagSheetPng,
} from '../../lib/tagSheet';

/** Short codes from a fixed seed. */
const codes = (count: number, seed = 0x0e138): string[] => {
  let s = seed;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
  return Array.from({ length: count }, () =>
    Array.from({ length: 8 }, () => TAG_SHORT_CODE_ALPHABET[next() % TAG_SHORT_CODE_ALPHABET.length]).join(''),
  );
};

const isBlack = (rows: Uint8Array[], x: number, y: number) => (rows[y]![x >> 3]! & (0x80 >> (x & 7))) === 0;

/** A square of the sheet, as the RGBA a QR reader takes. */
const crop = (rows: Uint8Array[], left: number, top: number, size: number) => {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = isBlack(rows, left + x, top + y) ? 0 : 255;
      rgba.set([value, value, value, 255], (y * size + x) * 4);
    }
  }
  return rgba;
};

describe('one sheet of twelve', () => {
  const twelve = codes(CODES_PER_SHEET);
  const { rows, cells } = drawSheet(twelve);

  it('is US Letter at 300 dpi', () => {
    expect([SHEET_WIDTH_PX, SHEET_HEIGHT_PX]).toEqual([8.5 * 300, 11 * 300]);
    expect(rows).toHaveLength(SHEET_HEIGHT_PX);
    expect(rows[0]).toHaveLength(Math.ceil(SHEET_WIDTH_PX / 8));
  });

  it('is written as a 1-bit PNG of that size', () => {
    const { png } = tagSheetPng(twelve);
    const bytes = Buffer.from(png);
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([SHEET_WIDTH_PX, SHEET_HEIGHT_PX]);
    expect([bytes[24], bytes[25]]).toEqual([1, 0]); // bit depth 1, greyscale
  });

  it('lays twelve codes out in three columns and four rows, in order', () => {
    expect(SHEET_COLUMNS * SHEET_ROWS).toBe(12);
    expect(cells.map((cell) => cell.shortCode)).toEqual(twelve);
    expect(new Set(cells.map((cell) => cell.cellX)).size).toBe(SHEET_COLUMNS);
    expect(new Set(cells.map((cell) => cell.cellY)).size).toBe(SHEET_ROWS);
  });

  it('keeps every cell inside the half-inch margin', () => {
    for (const cell of cells) {
      expect(cell.cellX).toBeGreaterThanOrEqual(SHEET_MARGIN_PX);
      expect(cell.cellY).toBeGreaterThanOrEqual(SHEET_MARGIN_PX);
      expect(cell.cellX + SHEET_CELL_PX).toBeLessThanOrEqual(SHEET_WIDTH_PX - SHEET_MARGIN_PX);
      expect(cell.cellY + SHEET_CELL_PX).toBeLessThanOrEqual(SHEET_HEIGHT_PX - SHEET_MARGIN_PX);
    }
  });

  it('draws each code about 1.75 in across, at whole pixels a module, centred in its cell', () => {
    for (const cell of cells) {
      expect(Number.isInteger(cell.pixelsPerModule)).toBe(true);
      expect(cell.codeSize % cell.pixelsPerModule).toBe(0);
      expect(Math.abs(cell.codeSize - SHEET_CODE_PX)).toBeLessThanOrEqual(cell.codeSize / cell.pixelsPerModule / 2 + 1);
      const inset = cell.codeX - cell.cellX;
      expect(inset).toBeGreaterThan(0);
      expect(cell.codeY - cell.cellY).toBe(inset);
      expect(Math.abs(SHEET_CELL_PX - cell.codeSize - 2 * inset)).toBeLessThanOrEqual(1);
    }
  });

  it.each(twelve.map((code, index) => [index, code]))('cell %i, cut out, decodes to its own tag: %s', (index, code) => {
    const cell = cells[index as number]!;
    const rgba = crop(rows, cell.cellX + 1, cell.cellY + 1, SHEET_CELL_PX - 2);
    expect(jsQR(rgba, SHEET_CELL_PX - 2, SHEET_CELL_PX - 2)?.data).toBe(buildTagUrl(code as string));
  });

  it('draws dashed cut guides along the cell edges', () => {
    const y = SHEET_MARGIN_PX + SHEET_CELL_PX; // the line between the first and second rows
    const along = Array.from({ length: SHEET_CELL_PX }, (_, i) => isBlack(rows, SHEET_MARGIN_PX + i, y));
    expect(along.filter(Boolean).length).toBeGreaterThan(SHEET_CELL_PX / 2);
    expect(along.some((dark) => !dark)).toBe(true); // dashed, not solid
    const x = SHEET_MARGIN_PX + SHEET_CELL_PX; // the line between the first and second columns
    expect(Array.from({ length: SHEET_CELL_PX }, (_, i) => isBlack(rows, x, SHEET_MARGIN_PX + i)).some(Boolean)).toBe(true);
  });

  it('leaves the margin and the gap between each guide and its code white', () => {
    for (let y = 0; y < SHEET_MARGIN_PX; y += 7) {
      for (let x = 0; x < SHEET_WIDTH_PX; x += 7) expect(isBlack(rows, x, y)).toBe(false);
    }
    for (const cell of cells) {
      for (let x = cell.cellX + 1; x < cell.codeX; x += 1) expect(isBlack(rows, x, cell.codeY + 10)).toBe(false);
    }
  });

  it('refuses more codes than a sheet holds', () => {
    expect(() => sheetCells(codes(CODES_PER_SHEET + 1))).toThrow('A sheet holds 12 codes');
  });
});

describe('a batch of 24', () => {
  it('makes two sheets that hold every code once, in order', () => {
    const batch = codes(24, 7);
    const sheets = sheetsOf(batch);
    expect(sheets.map((sheet) => sheet.length)).toEqual([12, 12]);
    expect(sheets.flat()).toEqual(batch);
  });

  it('puts a partial batch on as few sheets as it needs', () => {
    expect(sheetsOf(codes(13)).map((sheet) => sheet.length)).toEqual([12, 1]);
    expect(sheetsOf([])).toEqual([]);
  });
});
